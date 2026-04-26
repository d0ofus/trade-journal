"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

function toLineData(candles: Candle[]) {
  return candles
    .filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close))
    .map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: candle.close,
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

export function BenchmarkComparisonChart({
  tickerSymbol,
  benchmarkSymbol,
  tickerCandles,
  benchmarkCandles,
  height = 220,
}: {
  tickerSymbol: string;
  benchmarkSymbol: string;
  tickerCandles: Candle[];
  benchmarkCandles: Candle[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tickerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const benchmarkSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const tickerData = useMemo(() => toLineData(tickerCandles), [tickerCandles]);
  const benchmarkData = useMemo(() => toLineData(benchmarkCandles), [benchmarkCandles]);
  const latestTicker = tickerCandles.at(-1);
  const latestBenchmark = benchmarkCandles.at(-1);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#f8fafc" },
        textColor: "#334155",
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
      leftPriceScale: {
        visible: true,
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.18, bottom: 0.18 },
      },
      rightPriceScale: {
        visible: true,
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.18, bottom: 0.18 },
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

    const tickerSeries = chart.addSeries(LineSeries, {
      color: "#0284c7",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: tickerSymbol,
      priceScaleId: "right",
    });
    const benchmarkSeries = chart.addSeries(LineSeries, {
      color: "#7c3aed",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: benchmarkSymbol,
      priceScaleId: "left",
    });

    chartRef.current = chart;
    tickerSeriesRef.current = tickerSeries;
    benchmarkSeriesRef.current = benchmarkSeries;

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
      tickerSeriesRef.current = null;
      benchmarkSeriesRef.current = null;
    };
  }, [benchmarkSymbol, height, tickerSymbol]);

  useEffect(() => {
    tickerSeriesRef.current?.setData(tickerData);
    benchmarkSeriesRef.current?.setData(benchmarkData);
    chartRef.current?.timeScale().fitContent();
  }, [benchmarkData, tickerData]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-white/80 px-3 py-3 text-xs text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <div className="flex flex-wrap items-center gap-2 font-medium">
          <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-sky-700">
            {tickerSymbol} {latestTicker ? latestTicker.close.toFixed(2) : "-"}
          </span>
          <span className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-violet-700">
            {benchmarkSymbol} {latestBenchmark ? latestBenchmark.close.toFixed(2) : "-"}
          </span>
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          Separate price scales
        </p>
      </div>
      <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.98))] p-2 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.26)]">
        <div ref={containerRef} className="w-full rounded-xl" />
      </div>
    </div>
  );
}
