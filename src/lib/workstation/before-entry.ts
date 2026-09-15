import { candlePeriod } from "./execution-diagnostics";
import { executionTimeResolved } from "./execution-time-provenance";
import type { Candle, CandleSession, Drawing, Interval, Trade } from "./types";

export function firstExecution(trade: Trade) {
  return trade.executions.reduce<Trade["executions"][number] | undefined>((first, fill) => !first || fill.time < first.time ? fill : first, undefined);
}

export function beforeEntryBoundary(trade: Trade, interval: Interval, session?: CandleSession): number | null {
  const first = firstExecution(trade);
  if (!first || !executionTimeResolved(first) || ["pending", "stale", "unresolved"].includes(first.provenance?.interpretationStatus ?? "")) return null;
  // A time boundary, rather than subtracting an interval, also handles absent bars,
  // hourly buckets aligned to the exchange open, and shortened final sessions.
  if (interval === "1d" || interval === "1wk") {
    const period = candlePeriod(first.time, interval, session);
    return period.verified ? period.start : null;
  }
  return first.time;
}

export function beforeEntryCandles(candles: Candle[], trade: Trade, interval: Interval, session?: CandleSession) {
  const cutoff = beforeEntryBoundary(trade, interval, session);
  return cutoff === null ? candles : candles.filter(bar => candlePeriod(bar.time, interval, session).end <= cutoff);
}

export function beforeEntryDrawings(drawings: Drawing[], candles: Candle[], interval: Interval, session?: CandleSession) {
  if (!candles.length) return [];
  const end = candlePeriod(candles[candles.length - 1].time, interval, session).end;
  return drawings.filter(d => d.points.every(p => p.time < end));
}
