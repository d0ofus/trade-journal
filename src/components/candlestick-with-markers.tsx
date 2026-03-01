"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Marker = { time: number; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };

export function CandlestickWithMarkers({
  candles,
  markers,
  height = 460,
}: {
  candles: Candle[];
  markers: Marker[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#334155",
      },
      width: containerRef.current.clientWidth,
      height,
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

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
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

  return <div ref={containerRef} className="w-full" />;
}
