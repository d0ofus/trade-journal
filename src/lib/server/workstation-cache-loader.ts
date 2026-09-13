import type { CandleTimeframe } from "./market-candles";
import type { WorkstationCandles } from "./workstation-candles";
import type { WorkstationCandlePolicy } from "./workstation-candle-policy";
import { isRegularUsSession } from "@/lib/workstation/chart-session";
import { unionRanges, type CandleRange } from "@/lib/workstation/candle-ranges";
import { CacheBudgetError, cacheBudgetAvailable, claimCacheLease, markForegroundRequest, persistCompactCandles, protectTradeCache, readCompactCandles, releaseCacheLease, seriesKey } from "./workstation-cache-store";
import { CacheBusyError, CacheProviderError, fetchCompactCandles } from "./workstation-cache-provider";
import { alpacaFailureSummary } from "./alpaca-candle-error";

export type CompactInput = { symbol: string; timeframe: CandleTimeframe; range: CandleRange; limit: number; session?: "regular" | "extended"; mode?: "cache" | "fill" | "refresh" | "complete"; background?: boolean; tradeWindow?: boolean; signal?: AbortSignal };
const days: Record<CandleTimeframe, number> = { "5m": 14, "10m": 21, "15m": 28, "1h": 90, "1d": 365, "1wk": 1825 };
export function boundedCacheRanges(range: CandleRange, timeframe: CandleTimeframe) {
  const result: CandleRange[] = [];
  for (let from = range.from; from < range.to;) { const to = Math.min(range.to, from + days[timeframe] * 86400); result.push({ from, to }); from = to; }
  return result;
}
export async function loadCompactWorkstationCandles(input: CompactInput, policy: WorkstationCandlePolicy): Promise<WorkstationCandles> {
  const timings = { cacheReadMs: 0, providerFetchMs: 0, persistenceMs: 0 };
  const now = Math.floor(Date.now() / 1000);
  // A moving endpoint must not create a one-second cache miss on every trade selection.
  // Recent history advances in 15-minute batches, behind the configured SIP delay.
  const cutoff = Math.floor((now - policy.delaySeconds - (policy.delaySeconds ? 1 : 0)) / 900) * 900;
  // Existing API ranges include their last timestamp; the compact store uses exclusive ends.
  const range = { from: input.range.from, to: Math.max(input.range.from, Math.min(input.range.to + 0.001, cutoff)) };
  const source = input.session ? `${policy.cacheSource}:${input.session}` : policy.cacheSource;
  const series = { symbol: input.symbol, timeframe: input.timeframe, source };
  const warnings: string[] = [];
  if (range.to < input.range.to) warnings.push(`History through ${new Date(cutoff * 1000).toISOString()}; 15-minute cache batches behind the ${policy.delaySeconds}s configured provider delay.`);
  const read = async () => { const at = performance.now(); try { return await readCompactCandles(series, range, input.limit); } finally { timings.cacheReadMs += performance.now() - at; } };
  const fetchRange = async (window: CandleRange, background: boolean) => { const at = performance.now(); try { return await fetchCompactCandles(input.symbol, input.timeframe, window, policy.credentials!, background); } finally { timings.providerFetchMs += performance.now() - at; } };
  let snapshot = await read();
  if (input.tradeWindow) await protectTradeCache(series, range);
  let fetched = false;
  const makeResult = (): WorkstationCandles => ({ symbol: input.symbol,
    candles: input.session === "regular" && !["1d", "1wk"].includes(input.timeframe) ? snapshot.candles.filter(c => isRegularUsSession(c.time)) : snapshot.candles,
    source: "alpaca", cacheKind: "native", cache: { ...snapshot.cache, timings },
    session: { timezone: "America/New_York", calendar: "exchange", marketHours: input.session ?? "unknown" },
    provider: { identity: source, provider: "alpaca", feed: policy.credentials!.feed, adjustment: "raw", delaySeconds: policy.delaySeconds, cached: !fetched, fallback: false },
    warnings: [...warnings, ...(snapshot.corrupt ? ["Damaged cache data was excluded and will be fetched again."] : [])] });
  if (range.to <= range.from || input.mode === "cache") return makeResult();
  const requested = input.mode === "refresh" ? [range] : unionRanges([...snapshot.cache.missing, ...snapshot.cache.refresh]);
  if (!requested.length) return makeResult();
  if (!input.background) await markForegroundRequest();
  const lease = await claimCacheLease(`series:${seriesKey(series)}`, 120_000);
  if (!lease) { snapshot.cache.retryAfterMs = 1000; return makeResult(); }
  try {
    // Another request may have completed between our initial read and lease acquisition.
    snapshot = await read();
    const gaps = input.mode === "refresh" ? [range] : unionRanges([...snapshot.cache.missing, ...snapshot.cache.refresh]);
    const windows = gaps.flatMap(r => boundedCacheRanges(r, input.timeframe));
    const limit = input.mode === "fill" || input.background ? 1 : 8;
    const deadline = Date.now() + 65_000;
    for (const window of windows.slice(0, limit)) {
      if (Date.now() > deadline) break;
      input.signal?.throwIfAborted();
      if (!(await cacheBudgetAvailable())) {
        warnings.push("Storage limit reached—this history was not saved. Saved candles are preserved; automatic preparation is paused.");
        snapshot.cache.persistencePaused = true;
        // Foreground browsing remains possible without growing the database.
        if (!input.background) {
          const incoming = await fetchRange(window, false);
          snapshot.candles = [...new Map([...snapshot.candles, ...incoming].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(0, input.limit);
          snapshot.cache.temporary = [window]; fetched = true;
        }
        return makeResult();
      }
      const incoming = await fetchRange(window, !!input.background);
      const persistStarted = performance.now();
      try { await persistCompactCandles(series, window, incoming, lease, !!input.tradeWindow); }
      catch (error) {
        if (!(error instanceof CacheBudgetError)) throw error;
        warnings.push("Storage limit reached—this history was not saved. Saved candles are preserved; automatic preparation is paused.");
        snapshot.candles = [...new Map([...snapshot.candles, ...incoming].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(0, input.limit);
        snapshot.cache.persistencePaused = true;
        snapshot.cache.temporary = [window]; fetched = true; return makeResult();
      }
      timings.persistenceMs += performance.now() - persistStarted;
      fetched = true;
    }
    snapshot = await read();
    if (snapshot.cache.missing.length || snapshot.cache.refresh.length) snapshot.cache.retryAfterMs = 1000;
    return makeResult();
  } catch (error) {
    if (error instanceof CacheBusyError) { snapshot.cache.retryAfterMs = 1000; return makeResult(); }
    if (input.signal?.aborted) throw error;
    snapshot = await read();
    if (input.background || !snapshot.candles.length) throw error;
    warnings.push(`Alpaca unavailable (${alpacaFailureSummary(error)}); cached candles are preserved.`);
    snapshot.cache.retryAfterMs = error instanceof CacheProviderError ? Math.max(5000, error.retryAfterSeconds * 1000) : 5000;
    return makeResult();
  } finally { await releaseCacheLease(lease); }
}
