import { describe, expect, it } from "vitest";
import { chartLabelMode, restoreChartLabels } from "./chart-labels";
import { defaultPreferences } from "./types";
import { viewPreferences } from "./trade-view";

describe("device-local chart labels", () => {
  it.each(["labels", "compact", "hidden"] as const)("migrates legacy %s into every slot", mode => {
    expect(Object.values(restoreChartLabels(undefined, mode))).toEqual([mode, mode, mode, mode]);
  });
  it("preserves valid slots and repairs invalid saved values", () => {
    expect(restoreChartLabels({ "chart-1": "hidden", "chart-2": "invalid", "chart-3": "compact" }, "labels"))
      .toEqual({ "chart-1": "hidden", "chart-2": "labels", "chart-3": "compact", "chart-4": "labels" });
  });
  it("restoring a trade's panel configuration does not overwrite slot settings", () => {
    const pref = { ...defaultPreferences(), chartLabels: restoreChartLabels({ "chart-1": "compact", "chart-2": "hidden" }) };
    const restored = { ...pref, ...viewPreferences({ version: 1, panels: [{ id: "chart-1", interval: "1d", session: "regular", range: null }], arrangement: "top", sizing: pref.chartSizing! }) };
    expect(chartLabelMode(restored, "chart-1")).toBe("compact");
    expect(chartLabelMode(restored, "chart-2")).toBe("hidden");
  });
});
