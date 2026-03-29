"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type HistogramData,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesMarkerBarPosition,
  type SeriesMarkerPricePosition,
  type SeriesMarkerShape,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type BaseMarker = {
  time: number;
  color: string;
  shape: SeriesMarkerShape;
  text: string;
};
type BarMarker = BaseMarker & {
  position: SeriesMarkerBarPosition;
  price?: number;
};
type PriceMarker = BaseMarker & {
  position: SeriesMarkerPricePosition;
  price: number;
};
type Marker = BarMarker | PriceMarker;
type AnnotationTool = "none" | "horizontal" | "trend";
type HorizontalAnnotation = { id: string; type: "horizontal"; price: number; color: string };
type TrendAnnotation = { id: string; type: "trend"; fromTime: number; fromPrice: number; toTime: number; toPrice: number; color: string };
type ChartAnnotation = HorizontalAnnotation | TrendAnnotation;
type HoverOhlc = { time: number; open: number; high: number; low: number; close: number; volume?: number };
type TrendAnchor = { time: number; price: number };
type SmaPeriod = 10 | 20 | 50 | 200;

const SMA_SERIES_CONFIG: Array<{ period: SmaPeriod; color: string }> = [
  { period: 10, color: "#2563eb" },
  { period: 20, color: "#7c3aed" },
  { period: 50, color: "#d97706" },
  { period: 200, color: "#475569" },
];

function buildSimpleMovingAverage(
  candles: Candle[],
  period: SmaPeriod,
): Array<{ time: UTCTimestamp; value: number }> {
  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  let rollingSum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    rollingSum += candles[index].close;

    if (index >= period) {
      rollingSum -= candles[index - period].close;
    }

    if (index >= period - 1) {
      points.push({
        time: candles[index].time as UTCTimestamp,
        value: rollingSum / period,
      });
    }
  }

  return points;
}

function toUnixSeconds(time?: Time): number | null {
  if (typeof time === "number") return time;
  if (!time) return null;
  if (typeof time === "string") {
    const ts = Date.parse(time);
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
  }
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
}

export function CandlestickWithMarkers({
  candles,
  markers,
  height = 460,
  annotationStorageKey,
  readOnly = false,
}: {
  candles: Candle[];
  markers: Marker[];
  height?: number;
  annotationStorageKey?: string;
  readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const smaSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLineRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const toolRef = useRef<AnnotationTool>("none");
  const pendingTrendAnchorRef = useRef<TrendAnchor | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("none");
  const [pendingTrendAnchor, setPendingTrendAnchor] = useState<TrendAnchor | null>(null);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [hoverOhlc, setHoverOhlc] = useState<HoverOhlc | null>(null);

  function resetView() {
    seriesRef.current?.priceScale().applyOptions({ autoScale: true });
    chartRef.current?.timeScale().fitContent();
  }

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    pendingTrendAnchorRef.current = pendingTrendAnchor;
  }, [pendingTrendAnchor]);

  useEffect(() => {
    if (!annotationStorageKey || typeof window === "undefined") {
      setAnnotations([]);
      return;
    }
    const raw = window.localStorage.getItem(`chart-annotations:${annotationStorageKey}`);
    if (!raw) {
      setAnnotations([]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ChartAnnotation[];
      if (Array.isArray(parsed)) {
        setAnnotations(parsed);
      } else {
        setAnnotations([]);
      }
    } catch {
      setAnnotations([]);
    }
  }, [annotationStorageKey]);

  useEffect(() => {
    if (!annotationStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(`chart-annotations:${annotationStorageKey}`, JSON.stringify(annotations));
  }, [annotationStorageKey, annotations]);

  const latestBar = useMemo(() => candles.at(-1) ?? null, [candles]);
  const statusBar = hoverOhlc ?? latestBar;
  const candleByTime = useMemo(() => new Map(candles.map((candle) => [candle.time, candle])), [candles]);
  const volumeBars = useMemo(
    () =>
      candles
        .map((candle, index): HistogramData<Time> | null => {
          if (!Number.isFinite(candle.volume)) return null;
          const previousClose = index > 0 ? candles[index - 1]?.close : undefined;
          const isPositive =
            typeof previousClose === "number" && Number.isFinite(previousClose)
              ? candle.close >= previousClose
              : candle.close >= candle.open;

          return {
            time: candle.time as UTCTimestamp,
            value: Number(candle.volume),
            color: isPositive ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)",
          };
        })
        .filter((bar): bar is HistogramData<Time> => bar !== null),
    [candles],
  );
  const simpleMovingAverages = useMemo(
    () =>
      SMA_SERIES_CONFIG.map(({ period, color }) => ({
        period,
        color,
        data: buildSimpleMovingAverage(candles, period),
      })),
    [candles],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#f8fafc" },
        textColor: "#1e293b",
      },
      width: containerRef.current.clientWidth,
      height,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#94a3b8",
          width: 1,
          style: 3,
          labelBackgroundColor: "#0f172a",
        },
        horzLine: {
          color: "#94a3b8",
          width: 1,
          style: 3,
          labelBackgroundColor: "#0f172a",
        },
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.10)" },
        horzLines: { color: "rgba(148, 163, 184, 0.14)" },
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#cbd5e1",
        rightOffset: 6,
        barSpacing: 10,
        minBarSpacing: 0.5,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#059669",
      borderDownColor: "#dc2626",
      borderVisible: true,
      wickUpColor: "#059669",
      wickDownColor: "#dc2626",
      priceLineVisible: true,
      lastValueVisible: true,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      priceLineVisible: false,
      lastValueVisible: false,
      color: "rgba(148, 163, 184, 0.4)",
      base: 0,
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    const smaSeries = SMA_SERIES_CONFIG.map(({ color }) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    smaSeriesRef.current = smaSeries;
    markerPluginRef.current = createSeriesMarkers(series);

    const clickHandler = (param: MouseEventParams<Time>) => {
      if (!seriesRef.current) return;
      if (readOnly) return;
      if (toolRef.current === "none") return;
      if (!param.point) return;
      const time = toUnixSeconds(param.time);
      if (!time) return;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      if (typeof price !== "number" || !Number.isFinite(price)) return;

      if (toolRef.current === "horizontal") {
        setAnnotations((prev) => [
          ...prev,
          { id: crypto.randomUUID(), type: "horizontal", price, color: "#2563eb" },
        ]);
        return;
      }

      const anchor = pendingTrendAnchorRef.current;
      if (!anchor) {
        setPendingTrendAnchor({ time, price });
        return;
      }

      setAnnotations((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "trend",
          fromTime: anchor.time,
          fromPrice: anchor.price,
          toTime: time,
          toPrice: price,
          color: "#f59e0b",
        },
      ]);
      setPendingTrendAnchor(null);
    };

    const crosshairMoveHandler = (param: MouseEventParams<Time>) => {
      const raw = param.seriesData.get(series);
      if (!raw || typeof raw !== "object") {
        setHoverOhlc(null);
        return;
      }
      const typed = raw as { open?: number; high?: number; low?: number; close?: number };
      const time = toUnixSeconds(param.time);
      if (
        !time ||
        !Number.isFinite(typed.open) ||
        !Number.isFinite(typed.high) ||
        !Number.isFinite(typed.low) ||
        !Number.isFinite(typed.close)
      ) {
        setHoverOhlc(null);
        return;
      }

      setHoverOhlc({
        time,
        open: Number(typed.open),
        high: Number(typed.high),
        low: Number(typed.low),
        close: Number(typed.close),
        volume: candleByTime.get(time)?.volume,
      });
    };

    chart.subscribeClick(clickHandler);
    chart.subscribeCrosshairMove(crosshairMoveHandler);

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.unsubscribeCrosshairMove(crosshairMoveHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = [];
      markerPluginRef.current = null;
    };
  }, [candleByTime, height, readOnly]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    volumeSeriesRef.current?.setData(volumeBars);
    simpleMovingAverages.forEach((movingAverage, index) => {
      smaSeriesRef.current[index]?.setData(movingAverage.data);
    });
    markerPluginRef.current?.setMarkers(
      markers.map(
        (marker): SeriesMarker<Time> => ({ ...marker, time: marker.time as UTCTimestamp }),
      ),
    );
    resetView();
  }, [candles, markers, simpleMovingAverages, volumeBars]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      resetView();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    for (const line of priceLineRef.current) {
      series.removePriceLine(line);
    }
    priceLineRef.current = [];

    for (const trendSeries of trendSeriesRef.current) {
      chart.removeSeries(trendSeries);
    }
    trendSeriesRef.current = [];

    for (const annotation of annotations) {
      if (annotation.type === "horizontal") {
        const line = series.createPriceLine({
          price: annotation.price,
          color: annotation.color,
          lineStyle: 2,
          lineWidth: 2,
          axisLabelVisible: true,
          title: "H-Line",
        });
        priceLineRef.current.push(line);
      } else {
        const trendSeries = chart.addSeries(LineSeries, {
          color: annotation.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        trendSeries.setData([
          { time: annotation.fromTime as UTCTimestamp, value: annotation.fromPrice },
          { time: annotation.toTime as UTCTimestamp, value: annotation.toPrice },
        ]);
        trendSeriesRef.current.push(trendSeries);
      }
    }
  }, [annotations]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-white/80 px-3 py-3 text-xs text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <Button size="sm" variant={tool === "none" ? "default" : "outline"} className="h-8" onClick={() => setTool("none")}>
                Cursor
              </Button>
              <Button
                size="sm"
                variant={tool === "horizontal" ? "default" : "outline"}
                className="h-8"
                onClick={() => {
                  setPendingTrendAnchor(null);
                  setTool("horizontal");
                }}
              >
                Horizontal
              </Button>
              <Button
                size="sm"
                variant={tool === "trend" ? "default" : "outline"}
                className="h-8"
                onClick={() => setTool("trend")}
              >
                Trend
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  setPendingTrendAnchor(null);
                  setAnnotations([]);
                }}
              >
                Clear Drawings
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-8" onClick={resetView}>
            Reset View (Alt+R)
          </Button>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 shadow-sm">
          {statusBar ? (
            `O ${statusBar.open.toFixed(2)} H ${statusBar.high.toFixed(2)} L ${statusBar.low.toFixed(2)} C ${statusBar.close.toFixed(2)} V ${
              Number.isFinite(statusBar.volume) ? Number(statusBar.volume).toLocaleString() : "-"
            }`
          ) : (
            "O - H - L - C - V -"
          )}
          {!readOnly && tool === "trend" && pendingTrendAnchor ? " | Select second point" : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
          {SMA_SERIES_CONFIG.map((average) => (
            <span
              key={average.period}
              className="rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm"
              style={{ color: average.color }}
            >
              SMA {average.period}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.98))] p-2 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.28)]">
        <div ref={containerRef} className="w-full rounded-xl" />
      </div>
    </div>
  );
}
