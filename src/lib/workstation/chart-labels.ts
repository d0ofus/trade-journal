import type { WorkspacePreferences } from "./types";

export const chartSlots = ["chart-1", "chart-2", "chart-3", "chart-4"] as const;
export type ChartSlot = typeof chartSlots[number];
export type LabelMode = "labels" | "compact" | "hidden";
export type ChartLabels = Record<ChartSlot, LabelMode>;
const isMode = (value: unknown): value is LabelMode => value === "labels" || value === "compact" || value === "hidden";

/** Slot preferences deliberately live outside saved per-trade panel documents. */
export function restoreChartLabels(value: unknown, legacy: unknown = "labels"): ChartLabels {
  const fallback = isMode(legacy) ? legacy : "labels";
  const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(chartSlots.map(id => [id, isMode(saved[id]) ? saved[id] : fallback])) as ChartLabels;
}

export function chartLabelMode(preferences: Pick<WorkspacePreferences, "chartLabels" | "labels">, id: string): LabelMode {
  return restoreChartLabels(preferences.chartLabels, preferences.labels)[id as ChartSlot] ?? "labels";
}
