"use client";
import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, createSeriesMarkers, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { candlePeriod } from "@/lib/workstation/execution-diagnostics";
import { movingAverage, volumeMovingAverage } from "@/lib/workstation/math";
import { peerChartData, peerEntryTime, peerReplayRange, type PeerSeries, type PeerView } from "@/lib/workstation/peers";
import { volumeColor } from "@/lib/workstation/volume-style";
import type { HistoryRange } from "@/lib/workstation/history";
import type { Candle, Trade, WorkspacePreferences } from "@/lib/workstation/types";
import { assertCaptureSize, captureRenderFrame, chartBitmapRatio, type CaptureFrame } from "@/lib/workstation/capture-resolution";

export type PeerChartHandle = { capture: (scale: number) => Promise<HTMLCanvasElement>; frame: () => CaptureFrame; range: () => HistoryRange | null };
type Props = { symbol: string; trade: Trade; view: PeerView; series?: PeerSeries; preferences: WorkspacePreferences; onRange: (symbol: string, range: HistoryRange) => void; register: (symbol: string, handle: PeerChartHandle | null) => void };
const numericRange = (chart: IChartApi): HistoryRange | null => {
  const range = chart.timeScale().getVisibleRange();
  return range && typeof range.from === "number" && typeof range.to === "number" ? { from: range.from, to: range.to } : null;
};
export function PeerChart(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props);
  const model = useRef<{ update: () => void; sync: () => void } | null>(null);
  useEffect(() => { latest.current = props; });
  useEffect(() => {
    if (!host.current) return;
    const node = host.current, preferences = props.preferences;
    const light = preferences.theme === "light", bg = light ? "#f8fafc" : "#101722", text = light ? "#334155" : "#cbd5e1";
    const chart = createChart(node, { autoSize: true, layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, fontSize: 10, attributionLogo: false }, grid: { vertLines: { visible: preferences.gridlines.vertical, color: light ? "#e2e8f0" : "#1e293b" }, horzLines: { visible: preferences.gridlines.horizontal, color: light ? "#e2e8f0" : "#1e293b" } }, timeScale: { timeVisible: !["1d", "1wk"].includes(props.view.interval), secondsVisible: false, borderVisible: false }, rightPriceScale: { borderVisible: false, scaleMargins: { top: .12, bottom: preferences.volume ? .23 : .06 } } });
    const price = chart.addSeries(CandlestickSeries, { upColor: "#34d399", downColor: "#fb7185", wickUpColor: "#34d399", wickDownColor: "#fb7185", borderVisible: false, priceLineVisible: false });
    const volume = preferences.volume ? chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false }) : null;
    volume?.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    const volumeAverage = volume && preferences.volumeAverage.enabled ? chart.addSeries(LineSeries, { priceScaleId: "volume", color: volumeColor(preferences.volumeStyle, "average", light, "peer"), lineWidth: 1, lastValueVisible: false, priceLineVisible: false }) : null;
    const averages = preferences.averages.map((period, i) => ({ period, series: chart.addSeries(LineSeries, { color: ["#f59e0b", "#60a5fa", "#c084fc", "#f472b6"][i % 4], lineWidth: 1, lastValueVisible: false, priceLineVisible: false }) }));
    const markers = createSeriesMarkers(price, []);
    let applying = true, frame = 0, candles: Candle[] = [];
    const describeRange = () => { const range = numericRange(chart); if (range) { node.dataset.visibleFrom = String(range.from); node.dataset.visibleTo = String(range.to); } return range; };
    const beginSync = () => { applying = true; cancelAnimationFrame(frame); };
    const finishSync = () => { describeRange(); frame = requestAnimationFrame(() => { applying = false; }); };
    const sync = () => {
      if (!candles.length) return;
      const range = peerReplayRange(latest.current.view.range, latest.current.view.replayAt), current = numericRange(chart);
      if (current && Math.abs(current.from - range.from) < 1 && Math.abs(current.to - range.to) < 1) return;
      beginSync();
      // A sparse peer's clamped dates must never feed back into the shared viewport.
      chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
      finishSync();
    };
    const update = () => {
      const { trade, view, series } = latest.current;
      const filtered = peerChartData(series?.candles ?? [], trade, view);
      const session = filtered.session; candles = filtered.candles;
      node.dataset.lastCandleTime = String(candles.at(-1)?.time ?? "");
      node.dataset.replayAt = String(view.replayAt ?? "");
      beginSync();
      price.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
      volume?.setData(candles.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: volumeColor(preferences.volumeStyle, c.close >= c.open ? "up" : "down", light, "peer") })));
      volumeAverage?.setData(volumeMovingAverage(candles, preferences.volumeAverage.period).map(c => ({ ...c, time: c.time as UTCTimestamp })));
      averages.forEach(({ period, series }) => series.setData(movingAverage(candles, period).map(c => ({ ...c, time: c.time as UTCTimestamp }))));
      const entry = peerEntryTime(trade), entryBar = entry === null ? undefined : candles.find(c => { const p = candlePeriod(c.time, view.interval, session); return entry >= p.start && entry < p.end; });
      markers.setMarkers(entryBar ? [{ time: entryBar.time as UTCTimestamp, position: "aboveBar", shape: "arrowDown", color: "#fbbf24", text: `${trade.symbol} entry` }] : []);
      const range = peerReplayRange(view.range, view.replayAt);
      if (candles.length) chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
      finishSync();
    };
    const changed = () => {
      const range = describeRange();
      if (applying || !range || range.to <= range.from) return;
      const bounded = peerReplayRange(range, latest.current.view.replayAt);
      if (bounded.from !== range.from || bounded.to !== range.to) {
        beginSync();
        chart.timeScale().setVisibleRange({ from: bounded.from as UTCTimestamp, to: bounded.to as UTCTimestamp });
        finishSync();
      }
      latest.current.onRange(props.symbol, bounded);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(changed);
    model.current = { update, sync }; update();
    props.register(props.symbol, {
      range: () => numericRange(chart),
      frame: () => ({ width: node.clientWidth, height: node.clientHeight + 76 }),
      capture: async (scale: number) => {
        if (!candles.length) throw new Error("Wait for chart history before attaching.");
        const { view, series } = latest.current;
        // Freeze every series/range/marker before the first asynchronous yield.
        const range = numericRange(chart) ?? view.range, logical = chart.timeScale().getVisibleLogicalRange(), priceRange = price.priceScale().getVisibleRange();
        const fontFamily = chart.options().layout.fontFamily;
        const ratio = chartBitmapRatio(node, window.devicePixelRatio || 1), render = captureRenderFrame({ width: node.clientWidth, height: node.clientHeight }, scale, ratio);
        assertCaptureSize(render.width * ratio, render.height * ratio + Math.ceil(76 * scale));
        const container = document.createElement("div"); container.style.cssText = `position:fixed;left:-100000px;top:0;width:${render.width}px;height:${render.height}px;`; document.body.appendChild(container);
        const clone = createChart(container, { ...chart.options(), autoSize: false, width: render.width, height: render.height,
          layout: { ...chart.options().layout, fontSize: chart.options().layout.fontSize * render.x },
          timeScale: { ...chart.timeScale().options(), barSpacing: chart.timeScale().options().barSpacing * render.x, minBarSpacing: chart.timeScale().options().minBarSpacing * render.x },
          rightPriceScale: { ...chart.options().rightPriceScale, minimumWidth: chart.priceScale("right").width() * render.x },
        });
        let detach = () => {};
        try {
          const cs = clone.addSeries(CandlestickSeries, price.options()); cs.setData([...price.data()]);
          if (volume) { const vs = clone.addSeries(HistogramSeries, volume.options()); vs.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } }); vs.setData([...volume.data()]); }
          for (const source of [...averages.map(a => a.series), ...volumeAverage ? [volumeAverage] : []]) {
            const line = clone.addSeries(LineSeries, { ...source.options(), lineWidth: Math.min(4, Math.max(1, Math.round(render.x))) as 1 | 2 | 3 | 4 }); line.setData([...source.data()]);
          }
          const marks = createSeriesMarkers(cs, [...markers.markers()]); detach = () => marks.detach();
          if (logical) clone.timeScale().setVisibleLogicalRange(logical);
          if (priceRange) { cs.priceScale().setAutoScale(false); cs.priceScale().setVisibleRange(priceRange); }
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          const plot = clone.takeScreenshot(), canvas = document.createElement("canvas");
          assertCaptureSize(plot.width, plot.height + Math.ceil(76 * scale));
          canvas.width = plot.width; canvas.height = plot.height + Math.ceil(76 * scale);
          const ctx = canvas.getContext("2d")!; ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(plot, 0, Math.round(43 * scale)); ctx.fillStyle = text; ctx.font = `${13 * scale}px ${fontFamily}`;
          ctx.fillText(`${props.symbol} · ${view.interval} · ${view.adjustment} · ${series?.source ?? ""}`, 12 * scale, 19 * scale);
          ctx.font = `${10 * scale}px sans-serif`;
          ctx.fillText(`${new Date(range.from * 1000).toISOString().slice(0, 10)} – ${new Date(range.to * 1000).toISOString().slice(0, 10)} · ${view.session}${view.beforeEntry ? " · Before entry" : ""}`, 12 * scale, 35 * scale);
          ctx.fillText(`TradingView Lightweight Charts · Peer comparison${view.replayAt === undefined ? "" : ` · REPLAY ${new Date(view.replayAt * 1000).toISOString()}`}`, 12 * scale, canvas.height - 12 * scale);
          return canvas;
        } finally { detach(); clone.remove(); container.remove(); }
      },
    });
    return () => { cancelAnimationFrame(frame); props.register(props.symbol, null); chart.timeScale().unsubscribeVisibleTimeRangeChange(changed); markers.detach(); chart.remove(); model.current = null; };
    // Date/data updates reuse the canvas; only display configuration rebuilds it.
  }, [props.symbol, props.view.interval, props.preferences]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { model.current?.update(); }, [props.series, props.trade, props.view.session, props.view.adjustment, props.view.beforeEntry, props.view.replayAt]);
  useEffect(() => { model.current?.sync(); }, [props.view.range]);
  return <div className="ws-peer-chart" ref={host} data-peer-canvas={props.symbol} />;
}
