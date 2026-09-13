import { aggregateRegularHours, regularHourPeriod, regularSessionAt } from "@/lib/workstation/regular-hours";
import { intersectRange, missingRanges, unionRanges, type CandleRange } from "@/lib/workstation/candle-ranges";
import type { WorkstationCandlePolicy } from "./workstation-candle-policy";
import { readCompactCandles } from "./workstation-cache-store";
import { fetchCompactCandles } from "./workstation-cache-provider";
import { validateCandles } from "./workstation-cache-codec";
import type { Candle } from "./market-candles";

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
async function cachedSource(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy) {
  const candles: Candle[] = []; let covered: CandleRange[] = [];
  for (let from = range.from; from < range.to; from += 14 * 86400) {
    const window = { from, to: Math.min(from + 14 * 86400, range.to) };
    for (const session of ["regular", "extended"]) {
      if (sourcePeriods(window).every(r => !missingRanges(r, covered).length)) break;
      const result = await readCompactCandles({ symbol, timeframe: "5m", source: `${policy.cacheSource}:${session}` }, window, 30000);
      const valid = result.cache.covered.flatMap(r => missingRanges(r, result.cache.refresh));
      candles.push(...result.candles.filter(c => valid.some(r => c.time >= r.from && c.time < r.to)));
      covered = unionRanges([...covered, ...valid]);
    }
  }
  return { candles: validateCandles(candles), covered };
}
export async function readRegularHours(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy, cutoff: number) {
  const source = sourceWindow(range, cutoff), cached = await cachedSource(symbol, source, policy);
  const candles = aggregateRegularHours(cached.candles).filter(c => {
    const p = regularHourPeriod(c.time)!;
    return c.time >= range.from && c.time < range.to && !missingRanges({ from: p.start, to: Math.min(p.end, cutoff) }, cached.covered).length;
  });
  return candles;
}
export async function fetchRegularHours(symbol: string, range: CandleRange, policy: WorkstationCandlePolicy, cutoff: number, background: boolean, useCache = true) {
  const source = sourceWindow(range, cutoff);
  const cached = useCache ? await cachedSource(symbol, source, policy) : { candles: [] as Candle[], covered: [] as CandleRange[] };
  let candles = cached.candles;
  // Coalesce consecutive uncovered sessions into one provider window, skipping gaps
  // that contain only closed-market time. Already verified source bars are excluded.
  const gaps = missingRanges(source, cached.covered).flatMap(gap => { const periods = sourcePeriods(gap); return periods.length ? [{ from: periods[0].from, to: periods.at(-1)!.to }] : []; });
  for (const gap of gaps) {
    // Native five-minute data is transient unless it was independently requested.
    for (let from = gap.from; from < gap.to; from += 14 * 86400) {
      const window = intersectRange({ from, to: from + 14 * 86400 }, gap)!;
      const fetched = await fetchCompactCandles(symbol, "5m", window, policy.credentials!, background, useCache);
      candles = validateCandles([...candles.filter(c => c.time < window.from || c.time >= window.to), ...fetched]);
    }
  }
  return aggregateRegularHours(candles).filter(c => c.time >= range.from && c.time < range.to);
}
