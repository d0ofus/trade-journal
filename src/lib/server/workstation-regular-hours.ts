import { aggregateRegularHours, regularHourPeriod, regularSessionAt } from "@/lib/workstation/regular-hours";
import { intersectRange, missingRanges, unionRanges, type CandleRange } from "@/lib/workstation/candle-ranges";
import type { WorkstationCandlePolicy } from "./workstation-candle-policy";
import { readCompactSeries } from "./workstation-cache-store";
import { fetchCompactCandles, type ProviderRequestContext } from "./workstation-cache-provider";
import { validateCandles } from "./workstation-cache-codec";
import type { Candle } from "./market-candles";

type SourceSnapshot = { candles: Candle[]; covered: CandleRange[] };
export type RegularHourContext = ProviderRequestContext & { sources?: { range: CandleRange; value: Promise<SourceSnapshot> }[] };

function sourceWindow(range: CandleRange, cutoff: number) {
  return { from: Math.floor(range.from / 86400) * 86400, to: Math.min(Math.ceil(range.to / 86400) * 86400, cutoff) };
}
function sourcePeriods(range: CandleRange) {
  const result: CandleRange[] = [];
  for (let day = Math.floor(range.from / 86400) * 86400; day < range.to; day += 86400) {
    const market = regularSessionAt(day + 18 * 3600);
    if (market) { const part = intersectRange({ from: market.open, to: market.close }, range); if (part) result.push(part); }
  }
  return result;
}
async function cachedSource(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy, context: RegularHourContext) {
  const candles: Candle[] = []; let covered: CandleRange[] = [];
  const sources = context.sources ??= [];
  for (let from = range.from; from < range.to; from += 14 * 86400) {
    context.signal?.throwIfAborted();
    const window = { from, to: Math.min(from + 14 * 86400, range.to) };
    let saved = sources.find(s => s.range.from <= window.from && s.range.to >= window.to);
    if (!saved) {
      const value = (async () => {
        const at = performance.now();
        try {
          const results = await readCompactSeries(["regular", "extended"].map(session => ({ symbol, timeframe: "5m", source: `${policy.cacheSource}:${session}` })), window, 30000, Date.now() / 1000, true);
          const rows: Candle[] = []; let coverage: CandleRange[] = [];
          for (const result of results) {
            const valid = result.cache.covered.flatMap(r => missingRanges(r, result.cache.refresh));
            rows.push(...result.candles.filter(c => valid.some(r => c.time >= r.from && c.time < r.to) && !coverage.some(r => c.time >= r.from && c.time < r.to)));
            coverage = unionRanges([...coverage, ...valid]);
          }
          return { candles: validateCandles(rows), covered: coverage };
        } finally { if (context.timings) context.timings.cacheReadMs += performance.now() - at; }
      })();
      saved = { range: window, value }; sources.push(saved);
    }
    const result = await saved.value;
    candles.push(...result.candles.filter(c => c.time >= window.from && c.time < window.to));
    covered = unionRanges([...covered, ...result.covered.flatMap(r => { const part = intersectRange(r, window); return part ? [part] : []; })]);
  }
  return { candles: validateCandles(candles), covered };
}
export async function readRegularHours(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy, cutoff: number, context: RegularHourContext = {}) {
  const source = sourceWindow(range, cutoff), cached = await cachedSource(symbol, source, policy, context);
  const candles = aggregateRegularHours(cached.candles).filter(c => {
    const p = regularHourPeriod(c.time)!;
    return c.time >= range.from && c.time < range.to && !missingRanges({ from: p.start, to: Math.min(p.end, cutoff) }, cached.covered).length;
  });
  return candles;
}
export async function fetchRegularHours(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy, cutoff: number, background: boolean, useCache = true, context: RegularHourContext = {}) {
  const source = sourceWindow(range, cutoff);
  const cached = useCache ? await cachedSource(symbol, source, policy, context) : { candles: [] as Candle[], covered: [] as CandleRange[] };
  let candles = cached.candles;
  // Coalesce consecutive uncovered sessions into one provider window, skipping gaps
  // that contain only closed-market time. Already verified source bars are excluded.
  const gaps = missingRanges(source, cached.covered).flatMap(gap => { const periods = sourcePeriods(gap); return periods.length ? [{ from: periods[0].from, to: periods.at(-1)!.to }] : []; });
  for (const gap of gaps) {
    // Native five-minute data is transient unless it was independently requested.
    for (let from = gap.from; from < gap.to; from += 14 * 86400) {
      const window = intersectRange({ from, to: from + 14 * 86400 }, gap)!;
      const fetched = await fetchCompactCandles(symbol, "5m", window, policy.credentials!, background, useCache, context);
      candles = validateCandles([...candles.filter(c => c.time < window.from || c.time >= window.to), ...fetched]);
    }
  }
  return aggregateRegularHours(candles).filter(c => c.time >= range.from && c.time < range.to);
}
