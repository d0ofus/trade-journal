import { diagnoseExecution, type ExecutionDiagnostic } from "./execution-diagnostics";
import { regularSessionAt } from "./regular-hours";
import type { CandleRange } from "./candle-ranges";
import type { Candle, CandleSession, Execution, Interval, WorkspacePreferences } from "./types";

export type ExecutionVisibilityReason = "visible" | "outside-view" | "excluded-session" | "unloaded" | "unavailable" | "unresolved-time" | "outside-price-scale" | "hidden";
export const visibilityLabels: Record<ExecutionVisibilityReason, string> = {
  visible: "Visible", "outside-view": "Outside view", "excluded-session": "Excluded session",
  unloaded: "Candle not loaded", unavailable: "Candle unavailable", "unresolved-time": "Unresolved timing",
  "outside-price-scale": "Outside price scale", hidden: "Execution graphics hidden",
};
export type ExecutionVisibility = { diagnostic: ExecutionDiagnostic; index: number; reason: ExecutionVisibilityReason; x: number | null; y: number | null };
export type VisibilityInput = {
  executions: Execution[]; candles: Candle[]; interval: Interval; session?: CandleSession;
  replay: number | null; labels: WorkspacePreferences["labels"]; covered?: CandleRange[];
  visibleRange?: CandleRange | null; plotWidth: number; plotHeight: number;
  x(time: number): number | null; y(price: number): number | null;
};
/** The renderer, hit targets, status UI and image export share this decision. */
export function executionVisibility(o: VisibilityInput): ExecutionVisibility[] {
  return o.executions.flatMap((e, index) => {
    if (o.replay !== null && e.time > o.replay) return [];
    const diagnostic = diagnoseExecution(e, o.candles, o.interval, o.session);
    const x = diagnostic.candle ? o.x(diagnostic.candle.time) : null, y = o.y(e.price);
    const market = o.session?.timezone === "America/New_York" ? regularSessionAt(e.time) : null;
    const unresolved = diagnostic.timezoneUnverified;
    let reason: ExecutionVisibilityReason;
    if (o.labels === "hidden") reason = "hidden";
    else if (diagnostic.candle) reason = x === null || x < 0 || x > o.plotWidth ? "outside-view" : y === null || y < 0 || y > o.plotHeight ? "outside-price-scale" : "visible";
    else if (unresolved) reason = "unresolved-time";
    else if (o.interval !== "1d" && o.interval !== "1wk" && o.session?.marketHours === "regular" && o.session.timezone === "America/New_York" && (!market || e.time < market.open || e.time >= market.close)) reason = "excluded-session";
    else if (o.visibleRange && (e.time < o.visibleRange.from || e.time >= o.visibleRange.to)) reason = "outside-view";
    else reason = o.covered?.some(r => e.time >= r.from && e.time < r.to) ? "unavailable" : "unloaded";
    return [{ diagnostic, index, reason, x, y }];
  });
}
export function visibilitySummary(rows: ExecutionVisibility[]) {
  const counts = new Map<ExecutionVisibilityReason, number>();
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${count} ${visibilityLabels[reason].toLowerCase()}`).join(" · ");
}
