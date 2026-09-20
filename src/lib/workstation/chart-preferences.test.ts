import { describe, expect, it } from "vitest";
import { parseMovingAveragePeriods, restoreMovingAveragePeriods, restoreChartDisplay, restoreChartPanels } from "./chart-preferences";
import { volumeMovingAverage } from "./math";
import { tradeViewSchema, viewPreferences } from "./trade-view";
import { defaultPreferences, type Candle } from "./types";

describe("chart session and display preferences", () => {
  it("accepts four unique SMA periods, blank slots and safe legacy restoration", () => {
    expect(parseMovingAveragePeriods(["10", "20", "50", "200"])).toEqual({ periods: [10, 20, 50, 200] });
    expect(parseMovingAveragePeriods(["1", "", "500", " "])).toEqual({ periods: [1, 500] });
    expect(parseMovingAveragePeriods(["", "", "", ""])).toEqual({ periods: [] });
    for (const fields of [["20", "020"], ["0"], ["501"], ["1.5"], ["NaN"], ["1e2"], ["1", "2", "3", "4", "5"]]) expect(parseMovingAveragePeriods(fields).error).toBeTruthy();
    expect(restoreMovingAveragePeriods(undefined)).toEqual([20, 50]);
    expect(restoreMovingAveragePeriods([])).toEqual([]);
    expect(restoreMovingAveragePeriods([10, 20, 50, 200])).toEqual([10, 20, 50, 200]);
    expect(restoreMovingAveragePeriods([0, 20, 20, "50", 50, 200, 500, 501, 10])).toEqual([20, 50, 200, 500]);
  });
  it("migrates global sessions without overwriting independent panels", () => {
    const panels = [{ id: "chart-1", interval: "5m" }, { id: "chart-2", interval: "1h", session: "regular" }];
    expect(restoreChartPanels(panels, "extended").map(p => p.session)).toEqual(["extended", "regular"]);
    expect(restoreChartPanels(panels).map(p => p.session)).toEqual(["auto", "regular"]);
    expect(defaultPreferences().panels.every(p => p.session === "auto")).toBe(true);
    expect(restoreChartPanels(null, "extended").every(p => p.session === "extended")).toBe(true);
  });
  it("restores each saved view's session independently", () => {
    const view = tradeViewSchema.parse({ version: 1, arrangement: "left", panels: [
      { id: "chart-1", interval: "5m", session: "regular", range: null },
      { id: "chart-2", interval: "1h", session: "extended", range: null },
      { id: "chart-3", interval: "1d", session: "auto", range: null },
    ] });
    expect(viewPreferences(view).panels?.map(p => p.session)).toEqual(["regular", "extended", "auto"]);
    expect(viewPreferences(view)).not.toHaveProperty("chartSession");
  });
  it("defaults old display settings and validates average periods", () => {
    expect(restoreChartDisplay({})).toEqual({ volumeStyle: {}, capturePinNotes: false, volumeAverage: { enabled: true, period: 20 }, gridlines: { horizontal: true, vertical: true } });
    expect(restoreChartDisplay({ volumeAverage: { enabled: false, period: 500 }, gridlines: { horizontal: false, vertical: true } })).toEqual({ volumeStyle: {}, capturePinNotes: false, volumeAverage: { enabled: false, period: 500 }, gridlines: { horizontal: false, vertical: true } });
    for (const period of [0, -1, 501, 1.5, NaN, Infinity]) expect(restoreChartDisplay({ volumeAverage: { enabled: true, period } }).volumeAverage.period).toBe(20);
  });
});

describe("volume moving average", () => {
  const candles: Candle[] = [10, 0, 50, 30, 100].map((volume, i) => ({ time: 1000 + i * 300, open: 1, high: 2, low: 1, close: 2, volume }));
  it("includes zero volume and the current bar after a complete warm-up", () => {
    expect(volumeMovingAverage(candles, 3)).toEqual([{ time: 1600, value: 20 }, { time: 1900, value: 80 / 3 }, { time: 2200, value: 60 }]);
    expect(volumeMovingAverage(candles.slice(0, 2), 3)).toEqual([]);
    expect(volumeMovingAverage(candles, 1)).toEqual(candles.map(c => ({ time: c.time, value: c.volume })));
  });
  it("only uses the supplied session/replay series and updates when history is prepended", () => {
    expect(volumeMovingAverage(candles.slice(0, 4), 3)).toEqual(volumeMovingAverage(candles, 3).slice(0, 2));
    expect(volumeMovingAverage(candles.filter(c => c.volume !== 0), 3)[0]).toEqual({ time: 1900, value: 30 });
    expect(volumeMovingAverage(candles.slice(2), 3)).toEqual(volumeMovingAverage(candles, 3).slice(-1));
    expect(volumeMovingAverage([], 20)).toEqual([]);
    expect(volumeMovingAverage(candles, 0)).toEqual([]);
  });
});
