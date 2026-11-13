import { HistogramSeries, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { rvolDescription, rvolPaneRatio, rvolTitle, type RvolMode, type RvolPoint } from "@/lib/workstation/rvol";

const registeredSeries = new WeakSet<object>();
export const isRvolSeries = (series: object) => registeredSeries.has(series);
export const rvolSeriesOptions = (light: boolean) => ({
  priceScaleId: "right", priceLineVisible: false, lastValueVisible: false,
  priceFormat: { type: "custom" as const, minMove: .01, formatter: (v: number) => `${v.toFixed(2)}×` },
  color: light ? "#0f766e" : "#38bfa6",
  autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => { const info = original(); return info ? { ...info, priceRange: { minValue: 0, maxValue: Math.max(1.2, info.priceRange.maxValue) } } : null; },
});
export function addRvolSeries(api: IChartApi, points: readonly RvolPoint[], light: boolean) {
  const series = api.addSeries(HistogramSeries, rvolSeriesOptions(light), api.panes().length);
  registeredSeries.add(series);
  series.priceScale().applyOptions({ visible: true, borderVisible: false, scaleMargins: { top: .35, bottom: .03 } });
  series.createPriceLine({ price: 1, color: light ? "#64748b" : "#94a3b8", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "1.0×" });
  setRvolData(series, points, light);
  return series;
}
export function setRvolData(series: ISeriesApi<"Histogram">, points: readonly RvolPoint[], light: boolean) {
  series.setData(points.map(p => p.value === null ? { time: p.time as UTCTimestamp } : { time: p.time as UTCTimestamp, value: p.value, color: p.value >= 1 ? light ? "#0f766e" : "#38bfa6" : light ? "#b45309" : "#d4a45a" }));
}

/** Ratios are semantic: the index fraction applies only to price + index. */
export function sizeWorkspacePanes(api: IChartApi, price: ISeriesApi<"Candlestick">, benchmark: ISeriesApi<"Candlestick"> | undefined, rvol: ISeriesApi<"Histogram"> | undefined, indexRatio = .25, volumeRatio = .2) {
  const index = benchmark && benchmark.getPane() !== price.getPane() ? benchmark : undefined;
  if (index) index.getPane().moveTo(1);
  if (rvol) rvol.getPane().moveTo(api.panes().length - 1);
  const v = rvol ? rvolPaneRatio(volumeRatio) : 0, b = index ? Math.max(.15, Math.min(.5, indexRatio)) : 0;
  price.getPane().setStretchFactor((1 - v) * (1 - b));
  index?.getPane().setStretchFactor((1 - v) * b);
  rvol?.getPane().setStretchFactor(v);
}

export function paintRvolLegend(ctx: CanvasRenderingContext2D, top: number, width: number, mode: RvolMode, lookback: number, point: RvolPoint | undefined, light: boolean, loading: boolean, error: string) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, width, 44); ctx.clip();
  ctx.fillStyle = light ? "#243149" : "#dde5f3"; ctx.font = "600 11px system-ui";
  ctx.fillText(rvolTitle(mode, lookback), 9, top + 15, Math.max(0, width - 18));
  ctx.font = "10px system-ui"; ctx.fillStyle = light ? "#526077" : "#a0adc2";
  ctx.fillText(rvolDescription(point, loading, error), 9, top + 30, Math.max(0, width - 18)); ctx.restore();
}
