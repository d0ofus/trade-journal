import { candleIdentity, isRegularHour, regularHourSession } from "@/lib/workstation/regular-hours";
import { fetchRegularHours, readRegularHours, type RegularHourContext } from "./workstation-regular-hours";
import type { CandleTimeframe } from "./market-candles";
import type { WorkstationCandles } from "./workstation-candles";
import type { WorkstationCandlePolicy } from "./workstation-candle-policy";
import { isRegularUsSession } from "@/lib/workstation/chart-session";
import { missingRanges, unionRanges, type CandleRange, type CandleTimings } from "@/lib/workstation/candle-ranges";
import { validateCandles } from "./workstation-cache-codec";
import { CacheBudgetError, CachePriorityError, cacheBudgetAvailable, claimCacheLease, markForegroundRequest, persistCompactCandles, protectTradeCache, readCompactCandles, releaseCacheLease, seriesKey } from "./workstation-cache-store";
import { CacheBusyError, CacheProviderError, fetchCompactCandles } from "./workstation-cache-provider";
import { alpacaFailureSummary } from "./alpaca-candle-error";

export type CompactInput = { supplementary?: boolean; symbol: string; timeframe: CandleTimeframe; range: CandleRange; limit: number; session?: "regular" | "extended"; mode?: "cache" | "fill" | "refresh" | "complete"; background?: boolean; tradeWindow?: boolean; signal?: AbortSignal };
const days: Record<CandleTimeframe, number> = { "5m": 14, "10m": 21, "15m": 28, "1h": 90, "1d": 365, "1wk": 1825 };
export function boundedCacheRanges(range: CandleRange, timeframe: CandleTimeframe) {
  const result: CandleRange[] = [];
  for (let from = range.from; from < range.to;) { const to = Math.min(range.to, from + days[timeframe] * 86400); result.push({ from, to }); from = to; }
  return result;
}
export async function loadCompactWorkstationCandles(input: CompactInput, policy: WorkstationCandlePolicy): Promise<WorkstationCandles> {
  const timings: CandleTimings = { cacheReadMs: 0, providerFetchMs: 0, persistenceMs: 0, queueWaitMs: 0, storageCheckMs: 0, providerRequestCount: 0 };
  const context: RegularHourContext = { signal: input.signal, timings };
  const now = Math.floor(Date.now() / 1000);
  // A moving endpoint must not create a one-second cache miss on every trade selection.
  // Recent history advances in 15-minute batches, behind the configured SIP delay.
  const cutoff = Math.floor((now - policy.delaySeconds - (policy.delaySeconds ? 1 : 0)) / 900) * 900;
  // Existing API ranges include their last timestamp; the compact store uses exclusive ends.
  const derived = isRegularHour(input.timeframe, input.session);
  // Derived coverage is whole UTC days so a mid-candle request never certifies or overwrites a partial hour.
  const start = derived ? Math.floor(input.range.from / 86400) * 86400 : input.range.from;
  const end = derived ? Math.ceil((input.range.to + 0.001) / 86400) * 86400 : input.range.to + 0.001;
  const range = { from: start, to: Math.max(start, Math.min(end, cutoff)) };
  const source = candleIdentity(policy.cacheSource, input.timeframe, input.session);
  const series = { symbol: input.symbol, timeframe: input.timeframe, source };
  const warnings: string[] = [];
  if (range.to < input.range.to) warnings.push(`History through ${new Date(cutoff * 1000).toISOString()}; 15-minute cache batches behind the ${policy.delaySeconds}s configured provider delay.`);
  const read = async () => {
    input.signal?.throwIfAborted();
    const at = performance.now();
    const value = await readCompactCandles(series, range, input.limit).finally(() => { timings.cacheReadMs += performance.now() - at; });
    if (derived && value.cache.missing.length) value.candles = validateCandles([...await readRegularHours(input.symbol, range, policy, cutoff, context), ...value.candles]).slice(0, input.limit);
    return value;
  };
  const fetchRange = (window: CandleRange, background: boolean) => derived
    ? fetchRegularHours(input.symbol, window, policy, cutoff, background, true, context)
    : fetchCompactCandles(input.symbol, input.timeframe, window, policy.credentials!, background, true, context);
  let snapshot!: Awaited<ReturnType<typeof read>>;
  let fetched = false;
  const makeResult = (): WorkstationCandles => ({ symbol: input.symbol,
    candles: input.session === "regular" && !["1d", "1wk"].includes(input.timeframe) ? snapshot.candles.filter(c => isRegularUsSession(c.time)) : snapshot.candles,
    source: "alpaca", cacheKind: derived ? "derived-5m" : "native", cache: { ...snapshot.cache, timings },
    session: derived ? regularHourSession : { timezone: "America/New_York", calendar: "exchange", marketHours: input.session ?? "unknown" },
    provider: { identity: source, provider: "alpaca", feed: policy.credentials!.feed, adjustment: policy.credentials!.adjustment, delaySeconds: policy.delaySeconds, cached: !fetched, fallback: false },
    warnings: [...(derived ? ["Hourly candles aggregated from Alpaca 5m bars, aligned to the regular-session open."] : []), ...warnings, ...(snapshot.corrupt ? ["Damaged cache data was excluded and will be fetched again."] : [])] });
  const readOnly = range.to <= range.from || input.mode === "cache";
  input.signal?.throwIfAborted();
  const lease = readOnly ? null : await claimCacheLease(`series:${seriesKey(series)}`, 120_000, !input.background);
  try {
    // One authoritative read after acquiring ownership; cache probes never take a lease.
    snapshot = await read();
    if (input.tradeWindow) await protectTradeCache(series, range);
    if (readOnly) return makeResult();
    const gaps = input.mode === "refresh" ? [range] : unionRanges([...snapshot.cache.missing, ...snapshot.cache.refresh]);
    if (!gaps.length) return makeResult();
    if (!lease) { snapshot.cache.retryAfterMs = 1000; return makeResult(); }
    if (!input.background) await markForegroundRequest();
    const windows = gaps.flatMap(r => boundedCacheRanges(r, derived ? "5m" : input.timeframe));
    const limit = input.mode === "fill" || input.background && !input.supplementary ? 1 : 8;
    const deadline = Date.now() + 65_000;
    for (const window of windows.slice(0, limit)) {
      if (Date.now() > deadline) break;
      input.signal?.throwIfAborted();
      const budgetStarted = performance.now();
      // Supplementary requests must reach the foreground-aware provider queue
      // before doing expensive database-size accounting. Their persistence path
      // enforces the stricter warning/budget limits and can return temporary bars.
      const available = input.supplementary || await cacheBudgetAvailable().finally(() => { timings.storageCheckMs! += performance.now() - budgetStarted; });
      if (!available) {
        warnings.push("Storage limit reached—this history was not saved. Saved candles are preserved; automatic preparation is paused.");
        snapshot.cache.persistencePaused = true;
        // Foreground browsing remains possible without growing the database.
        if (!input.background || input.supplementary) {
          const incoming = await fetchRange(window, !!input.background);
          snapshot.candles = [...new Map([...snapshot.candles, ...incoming].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(0, input.limit);
          snapshot.cache.temporary = [window]; fetched = true;
        }
        return makeResult();
      }
      const incoming = await fetchRange(window, !!input.background);
      input.signal?.throwIfAborted();
      const persistStarted = performance.now();
      try { await persistCompactCandles(series, window, incoming, lease, !!input.tradeWindow, !!input.supplementary); }
      catch (error) {
        if (!(error instanceof CacheBudgetError)) throw error;
        if (!(error instanceof CachePriorityError)) warnings.push("Storage limit reached—this history was not saved. Saved candles are preserved; automatic preparation is paused.");
        snapshot.candles = [...new Map([...snapshot.candles, ...incoming].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time).slice(0, input.limit);
        if (!(error instanceof CachePriorityError)) snapshot.cache.persistencePaused = true;
        snapshot.cache.temporary = [window]; fetched = true; return makeResult();
      }
      finally { timings.persistenceMs += performance.now() - persistStarted; }
      fetched = true;
      // Only a committed, fenced write establishes coverage, including empty periods.
      snapshot.candles = validateCandles([...snapshot.candles.filter(c => c.time < window.from || c.time >= window.to), ...incoming])
        .filter(c => c.time >= range.from && c.time < range.to).slice(0, input.limit);
      snapshot.cache.covered = unionRanges([...snapshot.cache.covered, window]);
      snapshot.cache.missing = missingRanges(range, snapshot.cache.covered);
      snapshot.cache.refresh = snapshot.cache.refresh.flatMap(r => missingRanges(r, [window]));
      snapshot.cache.status = snapshot.cache.missing.length ? snapshot.candles.length ? "partial" : "miss" : snapshot.cache.refresh.length ? "refreshing" : "hit";
      snapshot.cache.progressed = true;
      if (!snapshot.cache.missing.length) snapshot.corrupt = false;
    }
    // Successful progress continues immediately; only contention/failure should back off.
    if (!fetched && (snapshot.cache.missing.length || snapshot.cache.refresh.length)) snapshot.cache.retryAfterMs = 1000;
    return makeResult();
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (!snapshot) throw error;
    if (error instanceof CacheBusyError) { snapshot.cache.retryAfterMs = 1000; return makeResult(); }
    if (input.background || !snapshot.candles.length) throw error;
    warnings.push(`Alpaca unavailable (${alpacaFailureSummary(error)}); cached candles are preserved.`);
    snapshot.cache.retryAfterMs = error instanceof CacheProviderError ? Math.max(5000, error.retryAfterSeconds * 1000) : 5000;
    return makeResult();
  } finally { if (lease) await releaseCacheLease(lease); }
}
