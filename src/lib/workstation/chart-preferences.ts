import { defaultPreferences, intervals, type ChartPanel, type ChartSessionPreference, type WorkspacePreferences } from "./types";

export function chartSessionPreference(value: unknown): ChartSessionPreference {
  return value === "regular" || value === "extended" ? value : "auto";
}

export function restoreChartPanels(value: unknown, legacySession?: unknown): ChartPanel[] {
  if (!Array.isArray(value) || !value.length || value.length > 4 || value.some((panel, index) =>
    !panel || panel.id !== `chart-${index + 1}` || !intervals.includes(panel.interval),
  )) return defaultPreferences().panels.map(panel => ({ ...panel, session: chartSessionPreference(legacySession) }));
  return value.map(panel => ({ ...panel, session: chartSessionPreference(panel.session ?? legacySession) }));
}

export function restoreChartDisplay(value: Partial<WorkspacePreferences>) {
  const period = value.volumeAverage?.period;
  return {
    volumeAverage: {
      enabled: value.volumeAverage?.enabled !== false,
      period: typeof period === "number" && Number.isInteger(period) && period >= 1 && period <= 500 ? period : 20,
    },
    gridlines: { horizontal: value.gridlines?.horizontal !== false, vertical: value.gridlines?.vertical !== false },
  };
}
