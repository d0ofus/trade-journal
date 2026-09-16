import { Candle, CandleSession, Drawing, Execution, Interval, Point, seconds } from "./types";
import { candlePeriod, containingExecutionCandle } from "./execution-diagnostics";

export function percentageChange(start: number, end: number): number | null { return start > 0 ? ((end - start) / start) * 100 : null; }
export function measureText(a: Point, b: Point, bars?: number) {
  const pct = percentageChange(a.price, b.price);
  const change = b.price - a.price;
  const hours = Math.abs(b.time - a.time) / 3600;
  const duration = hours >= 24 ? `${(hours / 24).toFixed(1)}d` : hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(hours * 60)}m`;
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct === null ? "N/A" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}) · ${duration}${bars === undefined ? "" : ` · ${bars} bars`}`;
}
export function bucket(time: number, interval: Interval) {
  // Weekly bars begin on Monday, in UTC. Intraday demo bars use UTC bucket boundaries.
  return interval === "1wk" ? Math.floor((time - 345600) / seconds[interval]) * seconds[interval] + 345600 : Math.floor(time / seconds[interval]) * seconds[interval];
}
export function aggregateCandles(candles: Candle[], interval: Interval): Candle[] {
  const map = new Map<number, Candle>();
  for (const bar of candles) {
    const time = bucket(bar.time, interval), found = map.get(time);
    if (found) { found.high = Math.max(found.high, bar.high); found.low = Math.min(found.low, bar.low); found.close = bar.close; found.volume += bar.volume; }
    else map.set(time, { ...bar, time });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}
export function executionBar(execution: Execution, candles: Candle[], interval: Interval, session?: CandleSession): Candle | undefined {
  return containingExecutionCandle(execution.time, candles, interval, session);
}
export function logicalTimeIndex(time: number, candles: Candle[], interval: Interval) {
  if (!candles.length) return 0;
  let lo = 0, hi = candles.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].time < time) lo = mid + 1; else hi = mid - 1; }
  if (candles[lo]?.time === time) return lo;
  if (!lo) return (time - candles[0].time) / seconds[interval];
  if (lo === candles.length) return lo - 1 + (time - candles[lo - 1].time) / seconds[interval];
  return lo - 1 + (time - candles[lo - 1].time) / (candles[lo].time - candles[lo - 1].time);
}
export function completedCandles(candles: Candle[], interval: Interval, cursor: number | null, session?: CandleSession) { return cursor === null ? candles : candles.filter(bar => candlePeriod(bar.time, interval, session).end <= cursor); }
export function visibleDrawings(drawings: Drawing[], panelId: string, replay: number | null) { return drawings.filter(d => !d.hidden && (!d.panel || d.panel === panelId) && (replay === null || d.createdAt <= replay)); }
export function movingAverage(candles: Candle[], period: number) {
  let sum = 0;
  return candles.flatMap((c, i) => { sum += c.close; if (i >= period) sum -= candles[i - period].close; return i >= period - 1 ? [{ time: c.time, value: sum / period }] : []; });
}
export function volumeMovingAverage(candles: Candle[], period: number) {
  if (!Number.isInteger(period) || period < 1 || period > 500) return [];
  let sum = 0;
  return candles.flatMap((c, i) => {
    sum += c.volume;
    if (i >= period) sum -= candles[i - period].volume;
    return i >= period - 1 ? [{ time: c.time, value: sum / period }] : [];
  });
}
export function riskReward(drawing: Drawing) {
  const [entry, end, stopPoint] = drawing.points;
  if (!entry || !end) return null;
  const direction = drawing.tool === "short" ? -1 : 1;
  const target = end.price, stop = stopPoint?.price ?? entry.price - direction * Math.abs(target - entry.price) / 2;
  const risk = direction * (entry.price - stop), reward = direction * (target - entry.price);
  return { entry: entry.price, stop, target, ratio: risk > 0 && reward > 0 ? reward / risk : null };
}
