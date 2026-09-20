import { logicalTimeIndex } from "./math";
import { seconds, type Candle, type Interval, type Point } from "./types";

export function timeAtLogical(index: number, candles: Candle[], interval: Interval): number {
  if (!candles.length) throw new Error("No chart candles available");
  if (index < 0) return candles[0].time + index * seconds[interval];
  if (index >= candles.length - 1) return candles.at(-1)!.time + (index - candles.length + 1) * seconds[interval];
  const floor = Math.floor(index);
  return candles[floor].time + (index - floor) * (candles[floor + 1].time - candles[floor].time);
}

/** Translate in chart space, using a single price delta and logical-bar delta. */
export function translateMeasurement(points: Point[], candles: Candle[], interval: Interval, logicalDelta: number, priceDelta: number, maximumTime?: number): Point[] {
  const indexes = points.map(p => logicalTimeIndex(p.time, candles, interval));
  const minimum = logicalTimeIndex(0, candles, interval) - Math.min(...indexes);
  const maximum = maximumTime === undefined ? Infinity : logicalTimeIndex(maximumTime, candles, interval) - Math.max(...indexes);
  const delta = Math.max(minimum, Math.min(maximum, logicalDelta));
  return points.map((p, i) => ({ time: Math.max(0, timeAtLogical(indexes[i] + delta, candles, interval)), price: p.price + priceDelta }));
}
