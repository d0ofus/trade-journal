import { defaultPreferences, intervals, type ChartPanel, type ChartSessionPreference, type WorkspacePreferences } from "./types";

export function parseMovingAveragePeriods(fields: string[]): { periods: number[]; error?: never } | { error: string; periods?: never } {
  const values = fields.map(field => field.trim()).filter(Boolean);
  if (fields.length > 4 || values.some(value => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 500)) {
    return { error: "Use up to four whole-number periods from 1 to 500, or leave a field blank." };
  }
  const periods = values.map(Number);
  if (new Set(periods).size !== periods.length) return { error: "Each moving average must use a different period." };
  return { periods };
}

export function restoreMovingAveragePeriods(value: unknown): number[] {
  if (!Array.isArray(value)) return defaultPreferences().averages;
  return [...new Set(value.filter((period): period is number => typeof period === "number" && Number.isInteger(period) && period >= 1 && period <= 500))].slice(0, 4);
}

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
