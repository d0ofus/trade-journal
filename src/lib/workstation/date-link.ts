import { Candle, Execution, Interval, seconds } from "./types";
import type { HistoryRange } from "./history";

/** A clicked candle selects its period; an execution/date entry selects an exact time. */
export type ChartDateTarget = { time: number; end?: number };

export function dateTargetIsVisible(
  target: ChartDateTarget,
  visible: HistoryRange | null,
  interval: Interval,
): boolean {
  if (!visible) return false;
  // getVisibleRange() reports candle start times, including its final visible candle.
  const end = visible.to + seconds[interval];
  return target.end === undefined
    ? target.time >= visible.from && target.time < end
    : target.time < end && target.end > visible.from;
}

export function dateTargetAnchor(
  target: ChartDateTarget,
  candles: Candle[],
  executions: Execution[],
): number {
  if (target.end === undefined) return target.time;
  const execution = executions.find(
    (fill) => fill.time >= target.time && fill.time < target.end!,
  );
  if (execution) return execution.time;
  const session = candles.filter(
    (bar) => bar.time >= target.time && bar.time < target.end!,
  );
  // Prefer an actual session bar to midnight on a daily candle.
  return session.length
    ? session[Math.floor(session.length / 2)].time
    : (target.time + target.end) / 2;
}

export function restoredDateLink(value: unknown): "target" | "independent" {
  // Retire the old pan/zoom window lock without resetting any other saved preferences.
  return value === "independent" ? "independent" : "target";
}
