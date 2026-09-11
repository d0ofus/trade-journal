import {
  aggregateCandles, CandleRange, CandleTimeframe, isCandleRequestAbort,
  loadAlpacaCandlesForSymbol, loadCandlesForSymbol, LoadedCandles,
  normalizedYahooRange, parseYahooRows, readCachedCandlesWithRetry,
  trimTrailingDuplicateDailyCandle,
} from "./market-candles";
import { evaluateUsEquitiesCandleCoverage, isSessionAwareTimeframe } from "./market-session-calendar";
import { workstationCandlePolicy } from "./workstation-candle-policy";

export type ChartProviderMetadata = { identity: string; provider: string; feed: string | null; adjustment: string; delaySeconds: number; cached: boolean; fallback: boolean };
export type WorkstationCandles = LoadedCandles & { provider: ChartProviderMetadata };
type Input = { symbol: string; timeframe: CandleTimeframe; range: CandleRange; limit: number; signal?: AbortSignal; identity?: string | null };
const yahooIdentity = "workstation:v1:yahoo:unverified";
const day = 86400;
const defaults: Record<CandleTimeframe, number> = { "5m": 60, "10m": 60, "15m": 60, "1h": 730, "1d": 3650, "1wk": 3650 };

async function yahoo(input: Input, warnings: string[], fallback: boolean): Promise<WorkstationCandles> {
  const intervals: Record<CandleTimeframe, string> = { "5m": "5m", "10m": "5m", "15m": "15m", "1h": "60m", "1d": "1d", "1wk": "1wk" };
  const range = input.range ?? { from: Math.floor(Date.now() / 1000) - defaults[input.timeframe] * day, to: Math.floor(Date.now() / 1000) };
  const normalized = normalizedYahooRange(range.from, range.to, input.timeframe);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(input.symbol)}`);
  url.searchParams.set("interval", intervals[input.timeframe]);
  url.searchParams.set("period1", String(normalized.period1));
  url.searchParams.set("period2", String(normalized.period2));
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, { cache: "no-store", signal: input.signal });
  if (!response.ok) throw new Error(`Yahoo history unavailable (HTTP ${response.status}). Existing chart history is preserved.`);
  const parsed = parseYahooRows(await response.json());
  input.signal?.throwIfAborted();
  const candles = (input.timeframe === "10m" ? aggregateCandles(parsed, 600) : input.timeframe === "1d" || input.timeframe === "1wk" ? trimTrailingDuplicateDailyCandle(parsed) : parsed)
    .filter(c => c.time >= range.from && c.time <= range.to).slice(-input.limit);
  return { symbol: input.symbol, candles, source: "yahoo", warnings: [...warnings, "Yahoo price adjustment basis is unverified; check execution prices around corporate actions. Yahoo bars are kept separate from Alpaca history."], provider: { identity: yahooIdentity, provider: "yahoo", feed: null, adjustment: "unverified", delaySeconds: 0, cached: false, fallback } };
}

/** Only the authenticated workstation endpoint uses this policy. Ingestion and outcomes keep their existing loader. */
export async function loadWorkstationCandles(input: Input): Promise<WorkstationCandles> {
  input.signal?.throwIfAborted();
  const policy = workstationCandlePolicy();
  if (policy.provider === "legacy") {
    const loaded = await loadCandlesForSymbol(input);
    return { ...loaded, provider: { identity: `legacy:${loaded.source ?? "none"}:unverified`, provider: loaded.source ?? "none", feed: null, adjustment: "unverified", delaySeconds: 0, cached: loaded.source === "cache", fallback: false } };
  }
  if (policy.provider === "yahoo" || (input.identity === yahooIdentity && policy.fallback)) return yahoo(input, [], policy.provider === "alpaca");
  const credentials = policy.credentials!;
  const provider: ChartProviderMetadata = { identity: policy.cacheSource, provider: "alpaca", feed: credentials.feed, adjustment: credentials.adjustment, delaySeconds: policy.delaySeconds, cached: false, fallback: false };
  const now = Math.floor(Date.now() / 1000);
  const requested = input.range ?? { from: now - defaults[input.timeframe] * day, to: now };
  // One extra second avoids straddling the subscription cutoff while requests travel.
  const range = { from: requested.from, to: Math.min(requested.to, now - policy.delaySeconds - (policy.delaySeconds ? 1 : 0)) };
  const warnings = range.to < requested.to ? [`Alpaca ${credentials.feed.toUpperCase()} history is capped at ${new Date(range.to * 1000).toISOString()} (${policy.delaySeconds}s configured delay).`] : [];
  if (range.to <= range.from) return { symbol: input.symbol, candles: [], source: "alpaca", provider, warnings };
  let cached: Awaited<ReturnType<typeof readCachedCandlesWithRetry>> = [];
  try {
    cached = await readCachedCandlesWithRetry({ ...input, range, sources: [policy.cacheSource] });
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    warnings.push("Workstation candle cache unavailable; requesting provider history.");
  }
  const coverage = isSessionAwareTimeframe(input.timeframe) ? evaluateUsEquitiesCandleCoverage({ candleTimes: cached.map(c => c.time), timeframe: input.timeframe, from: range.from, to: range.to, limit: input.limit }) : undefined;
  if (cached.length && coverage?.status === "complete") return { symbol: input.symbol, candles: cached, source: "cache", cacheKind: "native", provider: { ...provider, cached: true }, coverage, warnings };
  try {
    const loaded = await loadAlpacaCandlesForSymbol({ ...input, range, credentials, cacheSource: policy.cacheSource });
    if (!loaded) throw new Error("Alpaca did not return chart data.");
    return { ...loaded, provider, warnings: [...warnings, ...(loaded.warnings ?? [])] };
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    if (cached.length) return { symbol: input.symbol, candles: cached, source: "cache", cacheKind: "native", provider: { ...provider, cached: true }, coverage, warnings: [...warnings, "Alpaca unavailable; showing incomplete cached history from the same feed and price basis."] };
    if (policy.fallback) return yahoo(input, [...warnings, "Alpaca unavailable; Yahoo fallback is active."], true);
    throw new Error("Alpaca history unavailable. Yahoo fallback is disabled; existing chart history is preserved.");
  }
}
