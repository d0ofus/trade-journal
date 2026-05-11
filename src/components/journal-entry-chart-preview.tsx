"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { BarChart3, Loader2 } from "lucide-react";
import type { JournalTimeframe } from "@/lib/journal/schema";
import { cn } from "@/lib/utils";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type ChartPoint = Candle & { key: string; label: string };
type ChartSelection = { startKey: string; endKey: string; barCount: number };
type DragMode = "new" | "resize-start" | "resize-end" | "move";
type DragState = {
  mode: DragMode;
  anchorIndex: number;
  initialStartIndex?: number;
  initialEndIndex?: number;
};
type CandleResponse = { symbol?: string; candles?: Candle[]; error?: string };

const CHART_HEIGHT = 500;
const DEFAULT_SELECTION_LENGTH = 40;
const QUICK_LENGTHS = [20, 40, 60, 80, 120] as const;
const DRAG_ATTRIBUTE = "data-journal-chart-drag";

function apiTimeframe(timeframe: JournalTimeframe) {
  if (timeframe === "1W") return "1wk";
  if (timeframe === "1D") return "1d";
  if (timeframe === "1H") return "1h";
  if (timeframe === "15min") return "15m";
  if (timeframe === "10min") return "10m";
  return "5m";
}

function formatPointLabel(time: number, timeframe: JournalTimeframe) {
  const iso = new Date(time * 1000).toISOString();
  if (timeframe === "1D" || timeframe === "1W") return iso.slice(0, 10);
  return iso.slice(0, 16).replace("T", " ");
}

function isValidCandle(value: Candle) {
  return [value.time, value.open, value.high, value.low, value.close].every(Number.isFinite);
}

function toChartPoints(candles: Candle[], timeframe: JournalTimeframe) {
  return candles
    .filter(isValidCandle)
    .sort((left, right) => left.time - right.time)
    .map((candle) => ({
      ...candle,
      key: String(candle.time),
      label: formatPointLabel(candle.time, timeframe),
    }));
}

function normalizeIndexes(points: ChartPoint[], startIndex: number, endIndex: number) {
  const boundedStart = Math.max(0, Math.min(points.length - 1, startIndex));
  const boundedEnd = Math.max(0, Math.min(points.length - 1, endIndex));
  return {
    startIndex: Math.min(boundedStart, boundedEnd),
    endIndex: Math.max(boundedStart, boundedEnd),
  };
}

function selectionFromIndexes(points: ChartPoint[], startIndex: number, endIndex: number): ChartSelection | null {
  if (points.length === 0) return null;
  const normalized = normalizeIndexes(points, startIndex, endIndex);
  return {
    startKey: points[normalized.startIndex].key,
    endKey: points[normalized.endIndex].key,
    barCount: normalized.endIndex - normalized.startIndex + 1,
  };
}

function moveWindowByIndex(points: ChartPoint[], startIndex: number, endIndex: number, anchorIndex: number, targetIndex: number) {
  if (points.length === 0) return null;
  const normalized = normalizeIndexes(points, startIndex, endIndex);
  const length = Math.max(1, normalized.endIndex - normalized.startIndex + 1);
  const delta = targetIndex - anchorIndex;
  const maxStart = Math.max(0, points.length - length);
  const nextStart = Math.max(0, Math.min(maxStart, normalized.startIndex + delta));
  return selectionFromIndexes(points, nextStart, Math.min(points.length - 1, nextStart + length - 1));
}

function selectionLabels(points: ChartPoint[], selection: ChartSelection | null) {
  const start = selection ? points.find((point) => point.key === selection.startKey) : null;
  const end = selection ? points.find((point) => point.key === selection.endKey) : null;
  return { start: start?.label ?? "-", end: end?.label ?? "-" };
}

export function JournalEntryChartPreview({
  className,
  requestKey,
  symbol,
  timeframe,
}: {
  symbol: string;
  timeframe: JournalTimeframe;
  requestKey: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loadedSymbol, setLoadedSymbol] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const [rangeEditKeyDown, setRangeEditKeyDown] = useState(false);
  const [rangeDragActive, setRangeDragActive] = useState(false);

  const rangeEditActive = rangeEditKeyDown || rangeDragActive;
  const labels = useMemo(() => selectionLabels(points, selection), [points, selection]);
  const firstLabel = points[0]?.label ?? "-";
  const lastLabel = points[points.length - 1]?.label ?? "-";

  useEffect(() => {
    const requestedSymbol = symbol.trim().toUpperCase();
    if (!requestedSymbol) {
      return;
    }

    const controller = new AbortController();
    const url = new URL("/api/market/candles", window.location.origin);
    url.searchParams.set("symbol", requestedSymbol);
    url.searchParams.set("timeframe", apiTimeframe(timeframe));
    url.searchParams.set("limit", "260");

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setStatus("Loading chart...");
      setPoints([]);
      setSelection(null);
      setLoadedSymbol(requestedSymbol);
    });

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as CandleResponse;
        if (!res.ok) throw new Error(payload.error || "Unable to load candles.");
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const nextPoints = toChartPoints(payload.candles ?? [], timeframe);
        if (nextPoints.length === 0) throw new Error("No candle data found.");
        const endIndex = nextPoints.length - 1;
        const startIndex = Math.max(0, nextPoints.length - DEFAULT_SELECTION_LENGTH);
        setLoadedSymbol(payload.symbol ?? requestedSymbol);
        setPoints(nextPoints);
        setSelection(selectionFromIndexes(nextPoints, startIndex, endIndex));
        setStatus("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPoints([]);
        setSelection(null);
        setStatus(error instanceof Error ? error.message : "Unable to load candles.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [requestKey, symbol, timeframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length === 0) return;

    const chart = createChart(container, {
      height: CHART_HEIGHT,
      width: container.clientWidth,
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.18)",
        rightOffset: 4,
        timeVisible: timeframe !== "1D" && timeframe !== "1W",
      },
      crosshair: { mode: 0 },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#86efac",
      wickDownColor: "#fca5a5",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    candleSeries.setData(
      points.map((point) => ({
        time: point.time as UTCTimestamp,
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      })),
    );
    volumeSeries.setData(
      points.map((point) => ({
        time: point.time as UTCTimestamp,
        value: point.volume ?? 0,
        color: point.close >= point.open ? "rgba(34, 197, 94, 0.28)" : "rgba(239, 68, 68, 0.25)",
      })),
    );
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (width > 0) chart.resize(width, CHART_HEIGHT);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [points, timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !selection) {
      queueMicrotask(() => setRect(null));
      return;
    }

    const updateRect = () => {
      const start = chart.timeScale().timeToCoordinate(Number(selection.startKey) as UTCTimestamp);
      const end = chart.timeScale().timeToCoordinate(Number(selection.endKey) as UTCTimestamp);
      if (start == null || end == null) {
        setRect(null);
        return;
      }
      const left = Math.min(start, end);
      setRect({ left, width: Math.max(2, Math.abs(end - start)) });
    };

    updateRect();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateRect);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateRect);
  }, [selection, points]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setRangeEditKeyDown(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") setRangeEditKeyDown(false);
    };
    const handleBlur = () => setRangeEditKeyDown(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const setChartDragPanEnabled = (enabled: boolean) => {
    chartRef.current?.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: enabled,
        horzTouchDrag: enabled,
        vertTouchDrag: enabled,
      },
    });
  };

  const indexFromPointer = (clientX: number) => {
    const chart = chartRef.current;
    const overlay = overlayRef.current;
    if (!chart || !overlay || points.length === 0) return null;
    const bounds = overlay.getBoundingClientRect();
    const x = clientX - bounds.left;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < points.length; index += 1) {
      const coordinate = chart.timeScale().timeToCoordinate(points[index].time as UTCTimestamp);
      if (coordinate == null || !Number.isFinite(coordinate)) continue;
      const distance = Math.abs(coordinate - x);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    const logical = chart.timeScale().coordinateToLogical(x);
    if (logical == null || !Number.isFinite(logical)) return null;
    return Math.max(0, Math.min(points.length - 1, Math.round(Number(logical))));
  };

  const dragModeFromTarget = (target: EventTarget | null): DragMode | null => {
    if (!(target instanceof HTMLElement)) return null;
    const element = target.closest(`[${DRAG_ATTRIBUTE}]`);
    const mode = element?.getAttribute(DRAG_ATTRIBUTE);
    if (mode === "move" || mode === "resize-start" || mode === "resize-end") return mode;
    return null;
  };

  const selectLast = (length: number) => {
    if (points.length === 0) return;
    const endIndex = points.length - 1;
    setSelection(selectionFromIndexes(points, Math.max(0, endIndex - length + 1), endIndex));
  };

  if (loading) {
    return (
      <div className={cn("flex min-h-[24rem] items-center justify-center rounded-[28px] border border-slate-200/80 bg-white/85 p-8 text-sm text-slate-500", className)}>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading chart...
      </div>
    );
  }

  if (status && points.length === 0) {
    return (
      <div className={cn("flex min-h-[24rem] flex-col items-center justify-center rounded-[28px] border border-red-200 bg-red-50/80 p-8 text-center text-sm text-red-700", className)}>
        <BarChart3 className="mb-2 h-5 w-5" />
        {status}
      </div>
    );
  }

  if (points.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-[28px] border border-slate-200/80 bg-white/85 p-4 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.28)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">{loadedSymbol || symbol}</div>
          <div className="text-xs text-slate-500">{firstLabel} to {lastLabel}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_LENGTHS.map((length) => (
            <button
              key={length}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              onClick={() => selectLast(length)}
              type="button"
            >
              {length}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950">
        <div ref={containerRef} className="relative z-0 w-full" style={{ height: CHART_HEIGHT }} />
        <div
          ref={overlayRef}
          aria-label="Chart date range selector"
          className={cn("absolute inset-0 z-50", rangeEditActive ? "cursor-crosshair" : "pointer-events-none")}
          role="application"
          style={{ touchAction: rangeEditActive ? "none" : "auto" }}
          onPointerDown={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            const pointerIndex = indexFromPointer(event.clientX);
            if (pointerIndex == null) return;

            const startIndex = selection ? points.findIndex((point) => point.key === selection.startKey) : -1;
            const endIndex = selection ? points.findIndex((point) => point.key === selection.endKey) : -1;
            const mode = selection ? (dragModeFromTarget(event.target) ?? "new") : "new";
            dragRef.current = {
              mode,
              anchorIndex: pointerIndex,
              initialStartIndex: startIndex >= 0 ? startIndex : undefined,
              initialEndIndex: endIndex >= 0 ? endIndex : undefined,
            };
            setRangeDragActive(true);
            setChartDragPanEnabled(false);
            event.currentTarget.setPointerCapture(event.pointerId);
            if (mode === "new") setSelection(selectionFromIndexes(points, pointerIndex, pointerIndex));
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            event.preventDefault();
            event.stopPropagation();
            const targetIndex = indexFromPointer(event.clientX);
            if (targetIndex == null) return;

            if (drag.mode === "move" && drag.initialStartIndex != null && drag.initialEndIndex != null) {
              setSelection(moveWindowByIndex(points, drag.initialStartIndex, drag.initialEndIndex, drag.anchorIndex, targetIndex));
              return;
            }
            if (drag.mode === "resize-start" && drag.initialEndIndex != null) {
              setSelection(selectionFromIndexes(points, targetIndex, drag.initialEndIndex));
              return;
            }
            if (drag.mode === "resize-end" && drag.initialStartIndex != null) {
              setSelection(selectionFromIndexes(points, drag.initialStartIndex, targetIndex));
              return;
            }
            setSelection(selectionFromIndexes(points, drag.anchorIndex, targetIndex));
          }}
          onPointerUp={(event) => {
            dragRef.current = null;
            setRangeDragActive(false);
            setChartDragPanEnabled(true);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setRangeDragActive(false);
            setChartDragPanEnabled(true);
          }}
        >
          {rect ? (
            <div
              className={cn("absolute bottom-0 top-0 border-x border-sky-300/90 bg-sky-400/15", rangeEditActive ? "cursor-grab active:cursor-grabbing" : "pointer-events-none")}
              data-journal-chart-drag="move"
              style={{ left: rect.left, width: rect.width }}
            >
              <div className="absolute inset-y-0 left-3 right-3 cursor-grab active:cursor-grabbing" data-journal-chart-drag="move" />
              <div className="absolute -left-2 top-0 h-full w-4 cursor-ew-resize bg-sky-300/70" data-journal-chart-drag="resize-start" />
              <div className="absolute -right-2 top-0 h-full w-4 cursor-ew-resize bg-sky-300/70" data-journal-chart-drag="resize-end" />
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
        <div>Start <span className="font-mono text-slate-800">{labels.start}</span></div>
        <div>End <span className="font-mono text-slate-800">{labels.end}</span></div>
        <div>Bars <span className="font-mono text-slate-800">{selection?.barCount ?? "-"}</span></div>
      </div>
    </div>
  );
}
