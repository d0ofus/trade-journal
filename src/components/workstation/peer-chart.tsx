"use client";
import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, createSeriesMarkers, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { beforeEntryBoundary, beforeEntryCandles } from "@/lib/workstation/before-entry";
import { candlePeriod } from "@/lib/workstation/execution-diagnostics";
import { movingAverage, volumeMovingAverage } from "@/lib/workstation/math";
import { peerEntryTime, type PeerSeries, type PeerView } from "@/lib/workstation/peers";
import type { HistoryRange } from "@/lib/workstation/history";
import type { Candle, Trade, WorkspacePreferences } from "@/lib/workstation/types";

export type PeerChartHandle = { capture: () => HTMLCanvasElement; range: () => HistoryRange | null };
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
    const volumeAverage = volume && preferences.volumeAverage.enabled ? chart.addSeries(LineSeries, { priceScaleId: "volume", color: "#94a3b8", lineWidth: 1, lastValueVisible: false, priceLineVisible: false }) : null;
    const averages = preferences.averages.map((period, i) => ({ period, series: chart.addSeries(LineSeries, { color: ["#f59e0b", "#60a5fa", "#c084fc", "#f472b6"][i % 4], lineWidth: 1, lastValueVisible: false, priceLineVisible: false }) }));
    const markers = createSeriesMarkers(price, []);
    let applying = true, frame = 0, candles: Candle[] = [];
    const describeRange = () => { const range = numericRange(chart); if (range) { node.dataset.visibleFrom = String(range.from); node.dataset.visibleTo = String(range.to); } return range; };
    const beginSync = () => { applying = true; cancelAnimationFrame(frame); };
    const finishSync = () => { describeRange(); frame = requestAnimationFrame(() => { applying = false; }); };
    const sync = () => {
      if (!candles.length) return;
      const range = latest.current.view.range, current = numericRange(chart);
      if (current && Math.abs(current.from - range.from) < 1 && Math.abs(current.to - range.to) < 1) return;
      beginSync();
      // A sparse peer's clamped dates must never feed back into the shared viewport.
      chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
      finishSync();
    };
    const update = () => {
      const { trade, view, series } = latest.current;
      const session = { timezone: "America/New_York", calendar: "exchange" as const, marketHours: view.session, ...(view.interval === "1h" && view.session === "regular" ? { aggregation: "session-open-5m-v1" } : {}) };
      const blocked = view.beforeEntry && beforeEntryBoundary(trade, view.interval, session) === null;
      candles = blocked ? [] : view.beforeEntry ? beforeEntryCandles(series?.candles ?? [], trade, view.interval, session) : series?.candles ?? [];
      beginSync();
      price.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
      volume?.setData(candles.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#34d39955" : "#fb718555" })));
      volumeAverage?.setData(volumeMovingAverage(candles, preferences.volumeAverage.period).map(c => ({ ...c, time: c.time as UTCTimestamp })));
      averages.forEach(({ period, series }) => series.setData(movingAverage(candles, period).map(c => ({ ...c, time: c.time as UTCTimestamp }))));
      const entry = peerEntryTime(trade), entryBar = entry === null ? undefined : candles.find(c => { const p = candlePeriod(c.time, view.interval, session); return entry >= p.start && entry < p.end; });
      markers.setMarkers(entryBar ? [{ time: entryBar.time as UTCTimestamp, position: "aboveBar", shape: "arrowDown", color: "#fbbf24", text: `${trade.symbol} entry` }] : []);
      if (candles.length) chart.timeScale().setVisibleRange({ from: view.range.from as UTCTimestamp, to: view.range.to as UTCTimestamp });
      finishSync();
    };
    const changed = () => { const range = describeRange(); if (!applying && range && range.to > range.from) latest.current.onRange(props.symbol, range); };
    chart.timeScale().subscribeVisibleTimeRangeChange(changed);
    model.current = { update, sync }; update();
    props.register(props.symbol, {
      range: () => numericRange(chart),
      capture: () => {
        if (!candles.length) throw new Error("Wait for chart history before attaching.");
        const { view, series } = latest.current;
        const plot = chart.takeScreenshot(), canvas = document.createElement("canvas"), ratio = window.devicePixelRatio || 1;
        canvas.width = plot.width; canvas.height = plot.height + Math.round(76 * ratio);
        const ctx = canvas.getContext("2d")!; ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(plot, 0, Math.round(43 * ratio)); ctx.fillStyle = text; ctx.font = `${13 * ratio}px sans-serif`;
        ctx.fillText(`${props.symbol} · ${view.interval} · ${view.adjustment} · ${series?.source ?? ""}`, 12 * ratio, 19 * ratio);
        ctx.font = `${10 * ratio}px sans-serif`; const range = numericRange(chart) ?? view.range;
        ctx.fillText(`${new Date(range.from * 1000).toISOString().slice(0, 10)} – ${new Date(range.to * 1000).toISOString().slice(0, 10)} · ${view.session}${view.beforeEntry ? " · Before entry" : ""}`, 12 * ratio, 35 * ratio);
        ctx.fillText("TradingView Lightweight Charts · Peer comparison", 12 * ratio, canvas.height - 12 * ratio);
        return canvas;
      },
    });
    return () => { cancelAnimationFrame(frame); props.register(props.symbol, null); chart.timeScale().unsubscribeVisibleTimeRangeChange(changed); markers.detach(); chart.remove(); model.current = null; };
    // Date/data updates reuse the canvas; only display configuration rebuilds it.
  }, [props.symbol, props.view.interval, props.preferences]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { model.current?.update(); }, [props.series, props.trade, props.view.session, props.view.adjustment, props.view.beforeEntry]);
  useEffect(() => { model.current?.sync(); }, [props.view.range]);
  return <div className="ws-peer-chart" ref={host} data-peer-canvas={props.symbol} />;
}
