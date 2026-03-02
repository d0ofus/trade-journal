"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  CrosshairMode,
  ColorType,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Marker = { time: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };
type AnnotationTool = "none" | "horizontal" | "trend";
type HorizontalAnnotation = { id: string; type: "horizontal"; price: number; color: string };
type TrendAnnotation = { id: string; type: "trend"; fromTime: number; fromPrice: number; toTime: number; toPrice: number; color: string };
type ChartAnnotation = HorizontalAnnotation | TrendAnnotation;
type HoverOhlc = { time: number; open: number; high: number; low: number; close: number };
type TrendAnchor = { time: number; price: number };

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
}: {
  candles: Candle[];
  markers: Marker[];
  height?: number;
  annotationStorageKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLineRef = useRef<IPriceLine[]>([]);
  const trendSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const toolRef = useRef<AnnotationTool>("none");
  const pendingTrendAnchorRef = useRef<TrendAnchor | null>(null);
  const [tool, setTool] = useState<AnnotationTool>("none");
  const [pendingTrendAnchor, setPendingTrendAnchor] = useState<TrendAnchor | null>(null);
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [hoverOhlc, setHoverOhlc] = useState<HoverOhlc | null>(null);

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

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#334155",
      },
      width: containerRef.current.clientWidth,
      height,
      crosshair: { mode: CrosshairMode.Normal },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" },
      },
      rightPriceScale: { borderColor: "#cbd5e1" },
      timeScale: { borderColor: "#cbd5e1" },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markerPluginRef.current = createSeriesMarkers(series);

    const clickHandler = (param: MouseEventParams<Time>) => {
      if (!seriesRef.current) return;
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
      markerPluginRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    markerPluginRef.current?.setMarkers(markers.map((marker) => ({ ...marker, time: marker.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();
  }, [candles, markers]);

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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={tool === "none" ? "default" : "outline"} onClick={() => setTool("none")}>
            Cursor
          </Button>
          <Button
            size="sm"
            variant={tool === "horizontal" ? "default" : "outline"}
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
            onClick={() => setTool("trend")}
          >
            Trend
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPendingTrendAnchor(null);
              setAnnotations([]);
            }}
          >
            Clear Drawings
          </Button>
        </div>
        <div>
          {statusBar
            ? `O ${statusBar.open.toFixed(2)} H ${statusBar.high.toFixed(2)} L ${statusBar.low.toFixed(2)} C ${statusBar.close.toFixed(2)}`
            : "O - H - L - C -"}
          {tool === "trend" && pendingTrendAnchor ? " | Select second point" : ""}
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
