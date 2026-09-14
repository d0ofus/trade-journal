import { aggregateRegularHours, candleIdentity, isRegularHour, regularHourSession, REGULAR_HOUR_BASIS } from "@/lib/workstation/regular-hours";
import { fetchRegularHours } from "./workstation-regular-hours";
import {
  aggregateCandles, CandleRange, CandleTimeframe, Candle, isCandleRequestAbort,
  loadAlpacaCandlesForSymbol, loadCandlesForSymbol, LoadedCandles,
  normalizedYahooRange, parseYahooRows, readCachedCandlesWithRetry,
  trimTrailingDuplicateDailyCandle,
} from "./market-candles";
import { evaluateUsEquitiesCandleCoverage, isSessionAwareTimeframe } from "./market-session-calendar";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { isRegularUsSession } from "@/lib/workstation/chart-session";
import type { CandleSession } from "@/lib/workstation/types";
import { alpacaFailureSummary } from "./alpaca-candle-error";
import { cacheEnabled } from "./workstation-cache-store";
import { loadCompactWorkstationCandles } from "./workstation-cache-loader";
import type { CandleCacheMetadata } from "@/lib/workstation/candle-ranges";

export type ChartProviderMetadata = { identity: string; provider: string; feed: string | null; adjustment: string; delaySeconds: number; cached: boolean; fallback: boolean };
export type WorkstationCandles = LoadedCandles & { provider: ChartProviderMetadata; session?: CandleSession; cache?: CandleCacheMetadata };
type Input = { symbol: string; timeframe: CandleTimeframe; range: CandleRange; limit: number; signal?: AbortSignal; identity?: string | null; session?: "regular" | "extended"; mode?: "cache" | "fill" | "refresh" | "complete" };
const yahooIdentity = "workstation:v1:yahoo:unverified";
const day = 86400;
const defaults: Record<CandleTimeframe, number> = { "5m": 60, "10m": 60, "15m": 60, "1h": 730, "1d": 3650, "1wk": 3650 };

async function yahoo(input: Input, warnings: string[], fallback: boolean): Promise<WorkstationCandles> {
  const extended = input.session === "extended" && input.timeframe !== "1d" && input.timeframe !== "1wk";
  const derived = isRegularHour(input.timeframe, input.session);
  const identity = derived ? `${yahooIdentity}:regular:${REGULAR_HOUR_BASIS}` : extended ? `${yahooIdentity}:extended` : yahooIdentity;
  const intervals: Record<CandleTimeframe, string> = { "5m": "5m", "10m": "5m", "15m": "15m", "1h": "60m", "1d": "1d", "1wk": "1wk" };
  const range = input.range ?? { from: Math.floor(Date.now() / 1000) - defaults[input.timeframe] * day, to: Math.floor(Date.now() / 1000) };
  const normalized = normalizedYahooRange(derived ? Math.floor(range.from / day) * day : range.from, range.to, derived ? "5m" : input.timeframe);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(input.symbol)}`);
  url.searchParams.set("interval", derived ? "5m" : intervals[input.timeframe]);
  url.searchParams.set("period1", String(normalized.period1));
  url.searchParams.set("period2", String(normalized.period2));
  url.searchParams.set("includePrePost", String(extended));
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, { cache: "no-store", signal: input.signal });
  if (!response.ok) throw new Error(`Yahoo history unavailable (HTTP ${response.status}). Existing chart history is preserved.`);
  const payload = await response.json();
  const parsed = parseYahooRows(payload);
  const zone = payload?.chart?.result?.[0]?.meta?.exchangeTimezoneName;
  input.signal?.throwIfAborted();
  const candles = (derived ? aggregateRegularHours(parsed) : input.timeframe === "10m" ? aggregateCandles(parsed, 600) : input.timeframe === "1d" || input.timeframe === "1wk" ? trimTrailingDuplicateDailyCandle(parsed) : parsed)
    .filter(c => c.time >= range.from && c.time <= range.to).slice(-input.limit);
  return { symbol: input.symbol, candles, source: "yahoo", ...(typeof zone === "string" ? { session: { ...(derived ? regularHourSession : {}), timezone: zone, calendar: "exchange" as const, marketHours: extended ? "extended" as const : "regular" as const } } : {}), warnings: [...warnings, extended ? "Extended-hours intraday candles; some periods may have no eligible trades." : "Regular-session candles.", "Yahoo price adjustment basis is unverified; check execution prices around corporate actions. Yahoo bars are kept separate from Alpaca history."], provider: { identity, provider: "yahoo", feed: null, adjustment: "unverified", delaySeconds: 0, cached: false, fallback } };
}

/** Only the authenticated workstation endpoint uses this policy. Ingestion and outcomes keep their existing loader. */
export async function loadWorkstationCandles(input: Input): Promise<WorkstationCandles> {
  input.signal?.throwIfAborted();
  const policy = workstationCandlePolicy();
  const pinnedYahoo = [yahooIdentity, `${yahooIdentity}:extended`, `${yahooIdentity}:regular:${REGULAR_HOUR_BASIS}`].includes(input.identity ?? "");
  if (input.mode === "cache" && (!cacheEnabled() || policy.provider !== "alpaca" || pinnedYahoo)) {
    const range = input.range ?? { from: 1, to: 1 };
    return { symbol: input.symbol, candles: [], source: null, provider: { identity: input.identity ?? "", provider: policy.provider, feed: null, adjustment: "unverified", delaySeconds: 0, cached: false, fallback: false }, cache: { enabled: false, status: "miss", covered: [], missing: [range], refresh: [], effectiveRange: range } };
  }
  if (cacheEnabled() && policy.provider === "alpaca" && !pinnedYahoo && input.range) {
    const expected = candleIdentity(policy.cacheSource, input.timeframe, input.session);
    if (input.identity && input.identity !== expected) throw new Error("Chart provider identity changed. Reload to start a separate series.");
    try { return await loadCompactWorkstationCandles({ ...input, range: input.range }, policy); }
    catch (error) {
      if (isCandleRequestAbort(error, input.signal) || input.mode === "cache" || input.identity || !policy.fallback) throw error;
      return yahoo(input, [`Alpaca unavailable (${alpacaFailureSummary(error)}); Yahoo fallback is active.`], true);
    }
  }
  // Extended Yahoo requests are workstation-only and never reuse the shared regular-session cache.
  if (policy.provider === "legacy" && input.session === "extended") return yahoo(input, [], false);
  if (policy.provider === "legacy") {
    const loaded = await loadCandlesForSymbol(input);
    return { ...loaded, provider: { identity: `legacy:${loaded.source ?? "none"}:unverified`, provider: loaded.source ?? "none", feed: null, adjustment: "unverified", delaySeconds: 0, cached: loaded.source === "cache", fallback: false } };
  }
  if (policy.provider === "yahoo" || ([yahooIdentity, `${yahooIdentity}:extended`, `${yahooIdentity}:regular:${REGULAR_HOUR_BASIS}`].includes(input.identity ?? "") && policy.fallback)) return yahoo(input, [], policy.provider === "alpaca");
  const credentials = policy.credentials!;
  const cacheSource = candleIdentity(policy.cacheSource, input.timeframe, input.session);
  const provider: ChartProviderMetadata = { identity: cacheSource, provider: "alpaca", feed: credentials.feed, adjustment: credentials.adjustment, delaySeconds: policy.delaySeconds, cached: false, fallback: false };
  const now = Math.floor(Date.now() / 1000);
  const requested = input.range ?? { from: now - defaults[input.timeframe] * day, to: now };
  // One extra second avoids straddling the subscription cutoff while requests travel.
  const range = { from: requested.from, to: Math.min(requested.to, now - policy.delaySeconds - (policy.delaySeconds ? 1 : 0)) };
  const warnings = range.to < requested.to ? [`Alpaca ${credentials.feed.toUpperCase()} history is capped at ${new Date(range.to * 1000).toISOString()} (${policy.delaySeconds}s configured delay).`] : [];
  if (range.to <= range.from) return { symbol: input.symbol, candles: [], source: "alpaca", provider, warnings };
  if (isRegularHour(input.timeframe, input.session)) {
    try {
      const candles = await fetchRegularHours(input.symbol, { from: range.from, to: range.to + .001 }, policy, range.to, false, false, { signal: input.signal });
      return { symbol: input.symbol, candles: candles.slice(-input.limit), source: "alpaca", provider, session: regularHourSession, warnings: [...warnings, "Hourly candles aggregated from Alpaca 5m bars at the regular-session open."] };
    } catch (error) { if (isCandleRequestAbort(error, input.signal) || !policy.fallback) throw error; return yahoo(input, ["Alpaca unavailable; separate Yahoo session-open hourly fallback."], true); }
  }
  let cached: Awaited<ReturnType<typeof readCachedCandlesWithRetry>> = [];
  try {
    cached = await readCachedCandlesWithRetry({ ...input, range, sources: [cacheSource] });
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    warnings.push("Workstation candle cache unavailable; requesting provider history.");
  }
  const coverage = isSessionAwareTimeframe(input.timeframe) ? evaluateUsEquitiesCandleCoverage({ candleTimes: cached.map(c => c.time), timeframe: input.timeframe, from: range.from, to: range.to, limit: input.limit }) : undefined;
  const visibleCandles = (candles: Candle[]) => input.session === "regular" && input.timeframe !== "1d" && input.timeframe !== "1wk" ? candles.filter(c => isRegularUsSession(c.time)) : candles;
  if (input.session !== "extended" && cached.length && coverage?.status === "complete") return { symbol: input.symbol, candles: visibleCandles(cached), source: "cache", cacheKind: "native", provider: { ...provider, cached: true }, coverage, warnings };
  try {
    const loaded = await loadAlpacaCandlesForSymbol({ ...input, range, credentials, cacheSource });
    if (!loaded) throw new Error("Alpaca did not return chart data.");
    return { ...loaded, candles: visibleCandles(loaded.candles), provider, session: { timezone: "America/New_York", calendar: "exchange", marketHours: input.session ?? "unknown" }, warnings: [...warnings, ...(loaded.warnings ?? [])] };
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    const failure = `Alpaca unavailable (${alpacaFailureSummary(error)})`;
    if (cached.length) return { symbol: input.symbol, candles: visibleCandles(cached), source: "cache", cacheKind: "native", provider: { ...provider, cached: true }, coverage, warnings: [...warnings, `${failure}; showing incomplete cached history from the same feed and price basis.`] };
    if (policy.fallback) return yahoo(input, [...warnings, `${failure}; Yahoo fallback is active.`], true);
    throw new Error(`${failure}. Yahoo fallback is disabled; existing chart history is preserved.`);
  }
}
