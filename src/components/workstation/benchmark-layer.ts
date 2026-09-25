import { CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { alignComparison, benchmarkColor, benchmarkTransparency, benchmarkPaneRatio, type Comparison } from "@/lib/workstation/comparison";
import type { Candle } from "@/lib/workstation/types";

export const benchmarkStyle = (light: boolean, value?: string, transparency = 0, mode: "overlay" | "pane" = "overlay") => {
  const color = benchmarkColor(light, value);
  const alpha = 1 - benchmarkTransparency(transparency) / 100;
  const stroke = alpha === 1 ? color : `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
  return { priceScaleId: mode === "pane" ? "right" : "benchmark", upColor: "transparent", downColor: `${color}${Math.round(alpha * 64).toString(16).padStart(2, "0")}`, borderUpColor: stroke, borderDownColor: stroke, wickUpColor: stroke, wickDownColor: stroke, borderVisible: true, priceLineVisible: false, lastValueVisible: false };
};

export const benchmarkScale = { autoScale: true, visible: false, scaleMargins: { top: 0.16, bottom: 0.22 } };
export const benchmarkPaneScale = { autoScale: true, visible: true, borderVisible: false, scaleMargins: { top: .12, bottom: .12 } };
export function sizeBenchmarkPanes(api: IChartApi, ratio = .25) {
  const panes = api.panes(), fraction = benchmarkPaneRatio(ratio);
  if (panes.length > 1) { panes[0].setStretchFactor(1 - fraction); panes[1].setStretchFactor(fraction); }
}

export function createBenchmarkLayer(api: IChartApi, legend: HTMLElement) {
  let series: ISeriesApi<"Candlestick"> | null = null, primary: Candle[] = [], benchmark: Candle[] = [], symbol = "", light = false, color: string | undefined;
  let mode: "overlay" | "pane" = "overlay", transparency = 0, ratio = .25;
  let comparison: Comparison = alignComparison([], [], null), updating = false, lastAnchor: number | null = null, dirty = true, inspected: Candle | undefined, written = "";
  const display = (candle?: Candle) => {
    if (candle) inspected = candle;
    const c = inspected;
    const value = symbol ? c && comparison.benchmarkOpen ? `${symbol} · O ${c.open.toFixed(2)} H ${c.high.toFixed(2)} L ${c.low.toFixed(2)} C ${c.close.toFixed(2)} · ${((c.close / comparison.benchmarkOpen - 1) * 100).toFixed(2)}% · Independent scale` : `${symbol} · No matching candles` : "";
    if (value !== written) { legend.textContent = value; written = value; }
  };
  const refresh = () => {
    if (updating || !series) return;
    const visible = api.timeScale().getVisibleRange();
    const range = visible && typeof visible.from === "number" && typeof visible.to === "number" ? { from: visible.from, to: visible.to } : null;
    const first = primary.find(c => (!range || c.time >= range.from && c.time <= range.to) && comparison.originals.has(c.time));
    if (!dirty && first?.time === lastAnchor) return;
    updating = true;
    try {
      comparison = alignComparison(primary, benchmark, range);
      lastAnchor = comparison.anchor; dirty = false;
      series.setData(comparison.candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
      if (inspected && (!primary.some(c => c.time === inspected!.time) || !comparison.originals.has(inspected.time))) inspected = undefined;
      const fallback = primary.findLast(c => (!range || c.time <= range.to) && comparison.originals.has(c.time));
      display(inspected ? comparison.originals.get(inspected.time) : fallback ? comparison.originals.get(fallback.time) : undefined);
    } finally { updating = false; }
  };
  return {
    update(next: { primary: Candle[]; benchmark: Candle[]; symbol: string; light: boolean; color?: string; mode?: "overlay" | "pane"; transparency?: number; paneRatio?: number }) {
      dirty = primary !== next.primary || benchmark !== next.benchmark || symbol !== next.symbol;
      if (symbol !== next.symbol) inspected = undefined;
      primary = next.primary; benchmark = next.benchmark; symbol = next.symbol;
      if (!symbol) { if (series) api.removeSeries(series); series = null; comparison = alignComparison([], [], null); inspected = undefined; display(); return; }
      const nextMode = next.mode ?? "overlay", nextTransparency = benchmarkTransparency(next.transparency), nextRatio = benchmarkPaneRatio(next.paneRatio);
      const resized = !series || mode !== nextMode || ratio !== nextRatio;
      if (series && mode !== nextMode) { api.removeSeries(series); series = null; }
      if (!series) { series = api.addSeries(CandlestickSeries, benchmarkStyle(next.light, next.color, nextTransparency, nextMode), nextMode === "pane" ? 1 : 0); series.priceScale().applyOptions(nextMode === "pane" ? benchmarkPaneScale : benchmarkScale); dirty = true; }
      else if (light !== next.light || color !== next.color || transparency !== nextTransparency) series.applyOptions(benchmarkStyle(next.light, next.color, nextTransparency, nextMode));
      mode = nextMode; transparency = nextTransparency; ratio = nextRatio;
      if (mode === "pane" && resized) sizeBenchmarkPanes(api, ratio);
      light = next.light; color = next.color;
      refresh();
    },
    refresh,
    inspect(time: number) { const candle = comparison.originals.get(time); if (candle && primary.length && time <= primary[primary.length - 1].time && time >= primary[0].time && candle !== inspected) display(candle); },
    snapshot: () => ({ ...comparison, symbol, legend: written, mode, priceRange: series?.priceScale().getVisibleRange?.() ?? null }),
    dispose() { if (series) api.removeSeries(series); series = null; legend.textContent = ""; },
  };
}
