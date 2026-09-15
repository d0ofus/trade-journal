import { describe, expect, it } from "vitest";
import { chartGeometry, defaultChartSizing, restoreChartSizing } from "./chart-sizing";

describe("chart sizing", () => {
  it("repairs corrupt preferences without losing valid layouts", () => {
    const result = restoreChartSizing({ version: 1, layouts: { four: { main: NaN, first: .7, second: -100 } }, mobile: [1, 500, Infinity] });
    expect(result.layouts.four).toEqual({ main: .5, first: .7, second: .1 });
    expect(result.mobile).toEqual([240, 500, 320, 320]);
    expect(restoreChartSizing({ version: 2 })).toEqual(defaultChartSizing());
  });
  it.each([2, 3, 4])("fills the available space without overlapping charts in %i-chart layouts", count => {
    for (const arrangement of ["left", "top"] as const) {
      const preferences = defaultChartSizing(); preferences.layouts.four.first = .7; preferences.layouts.four.second = .3;
      const layout = chartGeometry(1100, 800, count, arrangement, preferences);
      expect(layout.rects).toHaveLength(count);
      for (const [i, rect] of layout.rects.entries()) {
        expect(rect.width).toBeGreaterThanOrEqual(240); expect(rect.height).toBeGreaterThanOrEqual(180);
        expect(rect.x + rect.width).toBeLessThanOrEqual(1100); expect(rect.y + rect.height).toBeLessThanOrEqual(800);
        for (const other of layout.rects.slice(i + 1)) expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true);
      }
    }
  });
  it("independently resizes four-chart column splits, and preserves row-major panel identities", () => {
    const sizing = defaultChartSizing(); sizing.layouts.four.first = .7; sizing.layouts.four.second = .3;
    const { rects } = chartGeometry(1200, 900, 4, "left", sizing);
    expect(rects[0].height).toBeGreaterThan(rects[1].height);
    expect(rects[2].x).toBe(rects[0].x); expect(rects[3].x).toBe(rects[1].x);
  });
  it("clamps visible sizes without overwriting saved proportions", () => {
    const sizing = defaultChartSizing(); sizing.layouts.threeLeft.main = .9;
    const { rects } = chartGeometry(650, 400, 3, "left", sizing);
    expect(rects[1].width).toBe(240); expect(sizing.layouts.threeLeft.main).toBe(.9);
  });
  it("uses independent mobile heights with a scrollable stack", () => {
    const sizing = defaultChartSizing(); sizing.mobile[1] = 420;
    const layout = chartGeometry(360, 650, 3, "left", sizing);
    expect(layout.stacked).toBe(true); expect(layout.rects[1].height).toBe(420); expect(layout.height).toBeGreaterThan(650);
    expect(chartGeometry(1200, 900, 3, "left", sizing).rects[1].height).toBe(447);
  });
});
