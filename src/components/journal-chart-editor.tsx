"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Camera, CircleDot, Crosshair, Flag, LineChart, Minus, Save, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { JOURNAL_MARKER_TYPES, JOURNAL_TIMEFRAMES, type JournalTimeframe } from "@/lib/journal/schema";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type MarkerType = (typeof JOURNAL_MARKER_TYPES)[number];
type Tool = "cursor" | "horizontal" | "trend" | MarkerType;
type Marker = { markerType: MarkerType; time: string | null; price: number | null; label: string | null; metadataJson?: string | null };
type Annotation =
  | { id: string; type: "horizontal"; price: number; color: string }
  | { id: string; type: "trend"; fromTime: number; fromPrice: number; toTime: number; toPrice: number; color: string };

const SMA_CONFIG = [
  { period: 10, color: "#0284c7" },
  { period: 20, color: "#7c3aed" },
  { period: 50, color: "#d97706" },
  { period: 200, color: "#475569" },
];

const MARKER_META: Record<MarkerType, { label: string; color: string; shape: "arrowUp" | "arrowDown" | "circle" | "square" }> = {
  IDEAL_ENTRY: { label: "Entry", color: "#16a34a", shape: "arrowUp" },
  STOP: { label: "Stop", color: "#dc2626", shape: "arrowDown" },
  TARGET: { label: "Target", color: "#2563eb", shape: "circle" },
  IDEAL_EXIT: { label: "Exit", color: "#ea580c", shape: "arrowDown" },
  MISSED_TRIGGER: { label: "Missed", color: "#9333ea", shape: "square" },
  DECISION_POINT: { label: "Decision", color: "#0f172a", shape: "circle" },
};

function apiTimeframe(timeframe: JournalTimeframe) {
  if (timeframe === "1W") return "1wk";
  if (timeframe === "1D") return "1d";
  if (timeframe === "1H") return "1h";
  if (timeframe === "15min") return "15m";
  if (timeframe === "10min") return "10m";
  return "5m";
}

function unixToIso(time: number) {
  return new Date(time * 1000).toISOString();
}

function timeToUnix(time?: Time): number | null {
  if (typeof time === "number") return time;
  if (!time) return null;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
}

function buildSma(candles: Candle[], period: number) {
  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) sum -= candles[index - period].close;
    if (index >= period - 1) points.push({ time: candles[index].time as UTCTimestamp, value: sum / period });
  }
  return points;
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/png");
}

export function JournalChartEditor({
  entryId,
  symbol,
  initialTimeframe = "1D",
  onSaved,
}: {
  entryId: string;
  symbol: string;
  initialTimeframe?: JournalTimeframe;
  onSaved: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const trendRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const pendingTrendRef = useRef<{ time: number; price: number } | null>(null);
  const toolRef = useRef<Tool>("cursor");
  const [timeframe, setTimeframe] = useState<JournalTimeframe>(initialTimeframe);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingTrend, setPendingTrend] = useState<{ time: number; price: number } | null>(null);

  const smaData = useMemo(() => SMA_CONFIG.map((config) => ({ ...config, data: buildSma(candles, config.period) })), [candles]);
  const advancedChartsAvailable = Boolean(process.env.NEXT_PUBLIC_TRADINGVIEW_LIBRARY_PATH);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    pendingTrendRef.current = pendingTrend;
  }, [pendingTrend]);

  useEffect(() => {
    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("timeframe", apiTimeframe(timeframe));
    url.searchParams.set("limit", "1200");
    if (rangeStart) url.searchParams.set("from", String(Math.floor(new Date(`${rangeStart}T00:00:00Z`).getTime() / 1000)));
    if (rangeEnd) url.searchParams.set("to", String(Math.floor(new Date(`${rangeEnd}T23:59:59Z`).getTime() / 1000)));

    let cancelled = false;
    setStatus("Loading chart...");
    fetch(url.toString())
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Unable to load candles."))))
      .then((data) => {
        if (cancelled) return;
        setCandles((data.candles ?? []) as Candle[]);
        setStatus("");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Unable to load candles.");
      });
    return () => {
      cancelled = true;
    };
  }, [rangeEnd, rangeStart, symbol, timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#f8fafc" }, textColor: "#1e293b" },
      height: 560,
      width: containerRef.current.clientWidth,
      crosshair: { mode: CrosshairMode.Normal },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.10)" },
        horzLines: { color: "rgba(148, 163, 184, 0.14)" },
      },
      rightPriceScale: { borderColor: "#cbd5e1", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#cbd5e1", timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#059669",
      borderDownColor: "#dc2626",
      wickUpColor: "#059669",
      wickDownColor: "#dc2626",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    const smaSeries = SMA_CONFIG.map((config) =>
      chart.addSeries(LineSeries, { color: config.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }),
    );
    chartRef.current = chart;
    seriesRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    smaRefs.current = smaSeries;
    markerPluginRef.current = createSeriesMarkers(candleSeries);

    const clickHandler = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.point || !seriesRef.current) return;
      const currentTool = toolRef.current;
      if (currentTool === "cursor") return;
      const time = timeToUnix(param.time);
      if (!time) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (typeof price !== "number" || !Number.isFinite(price)) return;
      if (currentTool === "horizontal") {
        setAnnotations((current) => [...current, { id: crypto.randomUUID(), type: "horizontal", price, color: "#2563eb" }]);
        return;
      }
      if (currentTool === "trend") {
        const pending = pendingTrendRef.current;
        if (!pending) {
          setPendingTrend({ time, price });
          return;
        }
        setAnnotations((current) => [
          ...current,
          { id: crypto.randomUUID(), type: "trend", fromTime: pending.time, fromPrice: pending.price, toTime: time, toPrice: price, color: "#f59e0b" },
        ]);
        setPendingTrend(null);
        return;
      }
      const meta = MARKER_META[currentTool];
      setMarkers((current) => [
        ...current,
        {
          markerType: currentTool,
          time: unixToIso(time),
          price,
          label: `${meta.label} ${price.toFixed(2)}`,
          metadataJson: JSON.stringify({ source: "journal-chart-editor" }),
        },
      ]);
    };
    chart.subscribeClick(clickHandler);
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      smaRefs.current = [];
      markerPluginRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    volumeRef.current?.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume ?? 0,
        color: candle.close >= candle.open ? "rgba(16,185,129,0.42)" : "rgba(239,68,68,0.38)",
      })),
    );
    smaData.forEach((sma, index) => smaRefs.current[index]?.setData(sma.data));
    chartRef.current?.timeScale().fitContent();
  }, [candles, smaData]);

  useEffect(() => {
    const pluginMarkers: Array<SeriesMarker<Time>> = markers.flatMap((marker) => {
      if (!marker.time) return [];
      const time = Math.floor(new Date(marker.time).getTime() / 1000) as UTCTimestamp;
      const meta = MARKER_META[marker.markerType];
      return [{
        time,
        color: meta.color,
        shape: meta.shape,
        position: marker.markerType === "STOP" || marker.markerType === "IDEAL_EXIT" ? "aboveBar" : "belowBar",
        text: marker.label ?? meta.label,
      }];
    });
    markerPluginRef.current?.setMarkers(pluginMarkers);
  }, [markers]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    for (const trend of trendRefs.current) chart.removeSeries(trend);
    priceLinesRef.current = [];
    trendRefs.current = [];
    for (const annotation of annotations) {
      if (annotation.type === "horizontal") {
        priceLinesRef.current.push(series.createPriceLine({ price: annotation.price, color: annotation.color, lineWidth: 2, lineStyle: 2, axisLabelVisible: true }));
      } else {
        const trend = chart.addSeries(LineSeries, { color: annotation.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        trend.setData([
          { time: annotation.fromTime as UTCTimestamp, value: annotation.fromPrice },
          { time: annotation.toTime as UTCTimestamp, value: annotation.toPrice },
        ]);
        trendRefs.current.push(trend);
      }
    }
  }, [annotations]);

  async function saveChart() {
    if (!chartRef.current) return;
    setSaving(true);
    setStatus("Saving chart...");
    try {
      const screenshot = canvasToDataUrl(chartRef.current.takeScreenshot(true));
      const res = await fetch(`/api/journal/${entryId}/charts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          rangeStart: rangeStart ? `${rangeStart}T00:00:00.000Z` : null,
          rangeEnd: rangeEnd ? `${rangeEnd}T23:59:59.000Z` : null,
          caption,
          screenshotDataUrl: screenshot,
          width: containerRef.current?.clientWidth ?? null,
          height: 560,
          mimeType: "image/png",
          markers,
          tradingViewLayoutJson: JSON.stringify({ annotations, markers, source: advancedChartsAvailable ? "advanced-charts-ready" : "lightweight-capture" }),
        }),
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        const errorMessage =
          typeof errorPayload?.error === "string"
            ? errorPayload.error
            : errorPayload?.error
              ? JSON.stringify(errorPayload.error)
              : "Failed to save chart.";
        throw new Error(errorMessage);
      }
      setCaption("");
      setMarkers([]);
      setAnnotations([]);
      setPendingTrend(null);
      setStatus("Saved chart.");
      onSaved();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save chart.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-white/85 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {JOURNAL_TIMEFRAMES.map((option) => (
            <Button key={option} size="sm" variant={timeframe === option ? "default" : "outline"} onClick={() => setTimeframe(option)}>
              {option}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            From
            <input className="mt-1 h-9 rounded-xl border border-slate-200 px-3 text-sm" type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
          </label>
          <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            To
            <input className="mt-1 h-9 rounded-xl border border-slate-200 px-3 text-sm" type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-slate-200/80 bg-white/85 p-3">
        <Button size="sm" variant={tool === "cursor" ? "default" : "outline"} onClick={() => setTool("cursor")} title="Cursor">
          <Crosshair className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={tool === "horizontal" ? "default" : "outline"} onClick={() => setTool("horizontal")} title="Horizontal line">
          <Minus className="h-4 w-4" />
        </Button>
        <Button size="sm" variant={tool === "trend" ? "default" : "outline"} onClick={() => setTool("trend")} title="Trend line">
          <LineChart className="h-4 w-4" />
        </Button>
        {JOURNAL_MARKER_TYPES.map((markerType) => (
          <Button key={markerType} size="sm" variant={tool === markerType ? "default" : "outline"} onClick={() => setTool(markerType)} title={MARKER_META[markerType].label}>
            {markerType === "TARGET" ? <Target className="h-4 w-4" /> : markerType === "MISSED_TRIGGER" ? <Flag className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => { setMarkers([]); setAnnotations([]); setPendingTrend(null); }} title="Clear">
          <X className="h-4 w-4" />
        </Button>
        <Button size="sm" className="ml-auto" disabled={saving || candles.length === 0} onClick={saveChart}>
          {saving ? <Save className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
          Save Chart
        </Button>
      </div>
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-2 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.28)]">
        <div ref={containerRef} className="w-full rounded-xl" />
      </div>
      <Textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Chart caption" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{status || `${symbol} ${timeframe} | ${candles.length} bars`}</span>
        <span>{pendingTrend ? "Select second trend point" : `${markers.length} markers | ${annotations.length} drawings`}</span>
      </div>
    </div>
  );
}
