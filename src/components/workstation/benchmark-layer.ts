import { CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { rebaseComparison, type Comparison } from "@/lib/workstation/comparison";
import type { Candle } from "@/lib/workstation/types";

export const benchmarkStyle = (light: boolean) => ({ upColor: "transparent", downColor: light ? "#2563eb40" : "#60a5fa40", borderUpColor: light ? "#2563eb" : "#60a5fa", borderDownColor: light ? "#2563eb" : "#60a5fa", wickUpColor: light ? "#2563eb" : "#60a5fa", wickDownColor: light ? "#2563eb" : "#60a5fa", borderVisible: true, priceLineVisible: false, lastValueVisible: false });

export function createBenchmarkLayer(api: IChartApi, legend: HTMLElement) {
  let series: ISeriesApi<"Candlestick"> | null = null, primary: Candle[] = [], benchmark: Candle[] = [], symbol = "", light = false;
  let comparison: Comparison = rebaseComparison([], [], null), updating = false, lastAnchor: number | null = null, dirty = true, inspected: Candle | undefined, written = "";
  const display = (candle?: Candle) => {
    if (candle) inspected = candle;
    const c = inspected;
    const value = symbol ? c && comparison.benchmarkOpen ? `${symbol} · O ${c.open.toFixed(2)} H ${c.high.toFixed(2)} L ${c.low.toFixed(2)} C ${c.close.toFixed(2)} · ${((c.close / comparison.benchmarkOpen - 1) * 100).toFixed(2)}% · visible-range comparison` : `${symbol} · No matching candles` : "";
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
      comparison = rebaseComparison(primary, benchmark, range);
      lastAnchor = comparison.anchor; dirty = false;
      series.setData(comparison.candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
      if (inspected && (!primary.some(c => c.time === inspected!.time) || !comparison.originals.has(inspected.time))) inspected = undefined;
      const fallback = primary.findLast(c => (!range || c.time <= range.to) && comparison.originals.has(c.time));
      display(inspected ? comparison.originals.get(inspected.time) : fallback ? comparison.originals.get(fallback.time) : undefined);
    } finally { updating = false; }
  };
  return {
    update(next: { primary: Candle[]; benchmark: Candle[]; symbol: string; light: boolean }) {
      dirty = primary !== next.primary || benchmark !== next.benchmark || symbol !== next.symbol;
      if (symbol !== next.symbol) inspected = undefined;
      primary = next.primary; benchmark = next.benchmark; symbol = next.symbol;
      if (!symbol) { if (series) api.removeSeries(series); series = null; comparison = rebaseComparison([], [], null); inspected = undefined; display(); return; }
      if (!series) { series = api.addSeries(CandlestickSeries, benchmarkStyle(next.light)); dirty = true; }
      else if (light !== next.light) series.applyOptions(benchmarkStyle(next.light));
      light = next.light;
      refresh();
    },
    refresh,
    inspect(time: number) { const candle = comparison.originals.get(time); if (candle && primary.length && time <= primary[primary.length - 1].time && time >= primary[0].time && candle !== inspected) display(candle); },
    snapshot: () => ({ ...comparison, symbol, legend: written }),
    dispose() { if (series) api.removeSeries(series); series = null; legend.textContent = ""; },
  };
}
