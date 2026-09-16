import { expect, it, vi } from "vitest";
import type { IChartApi } from "lightweight-charts";
import { createBenchmarkLayer } from "./benchmark-layer";

it("isolates actual benchmark prices and autoscaling from the trade scale through range and theme changes", () => {
  const scaleOptions = vi.fn(), setData = vi.fn(), seriesOptions = vi.fn();
  let range = { from: 1, to: 2 };
  const api = { addSeries: vi.fn((...args: unknown[]) => { expect(args).toHaveLength(2); return { setData, priceScale: () => ({ applyOptions: scaleOptions }), applyOptions: seriesOptions }; }), timeScale: () => ({ getVisibleRange: () => range }), removeSeries: vi.fn() };
  const legend = { textContent: "" };
  const layer = createBenchmarkLayer(api as unknown as IChartApi, legend as HTMLElement);
  const bar = (time: number, price: number) => ({ time, open: price, high: price + 1, low: price - 1, close: price, volume: 1 });
  const primary = [bar(1, 10), bar(2, 12)], benchmark = [bar(1, 500), bar(2, 501)];
  const snapshot = structuredClone(primary);
  layer.update({ primary, benchmark, symbol: "SPY", light: false });
  expect(api.addSeries.mock.calls[0][1]).toMatchObject({ priceScaleId: "benchmark", lastValueVisible: false, priceLineVisible: false });
  expect(scaleOptions).toHaveBeenCalledWith(expect.objectContaining({ autoScale: true, visible: false }));
  expect(setData.mock.lastCall![0].map((b: { close: number }) => b.close)).toEqual([500, 501]);
  expect(legend.textContent).toContain("Independent scale");
  range = { from: 2, to: 2 }; layer.refresh();
  layer.update({ primary, benchmark, symbol: "SPY", light: true });
  expect(layer.snapshot().candles.map(c => c.close)).toEqual([500, 501]);
  expect(seriesOptions).toHaveBeenCalledWith(expect.objectContaining({ priceScaleId: "benchmark" }));
  expect(primary).toEqual(snapshot);
  layer.update({ primary, benchmark: [], symbol: "", light: true });
  expect(api.removeSeries).toHaveBeenCalledOnce(); expect(legend.textContent).toBe("");
});
