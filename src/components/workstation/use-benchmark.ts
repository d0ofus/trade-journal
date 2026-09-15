"use client";
import { useEffect, useState } from "react";
import type { Candle, CandleResult, ChartPanel, Trade, WorkstationAdapter } from "@/lib/workstation/types";
import { initialHistoryRange } from "@/lib/workstation/history";
import { missingRanges } from "@/lib/workstation/candle-ranges";

const empty: Candle[] = [];
export function useBenchmark(adapter: WorkstationAdapter, trade: Trade, panel: ChartPanel, range: { from: number; to: number } | null) {
  const [result, setResult] = useState<{ key: string; result: CandleResult } | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const symbol = panel.benchmark && panel.benchmark !== "off" ? panel.benchmark : null;
  const key = `${trade.id}:${trade.timeInterpretationVersion}:${trade.chartSession}:${symbol}:${panel.interval}`;
  const initial = initialHistoryRange(trade, panel.interval);
  const from = Math.floor(range?.from ?? initial.from), to = Math.ceil(range?.to ?? initial.to);
  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();
    setError("");
    if (!adapter.benchmarkCandles) { setError("Benchmark unavailable"); return; }
    void (async () => {
      const cached = await adapter.benchmarkCandles!(symbol, trade, panel.interval, controller.signal, { from, to }, "cache");
      if (controller.signal.aborted) return;
      if (cached.candles.length) setResult({ key, result: cached });
      const fill = async () => {
        if (controller.signal.aborted || cached.cache?.status === "hit") return;
        const loaded = await adapter.benchmarkCandles!(symbol, trade, panel.interval, controller.signal, { from, to }, "fill");
        if (!controller.signal.aborted) {
          setResult({ key, result: loaded });
          if (!loaded.candles.length || loaded.cache?.missing.some(gap => missingRanges(gap, loaded.cache?.temporary ?? []).length)) setError("Benchmark incomplete; retry");
        }
      };
      // The shared server limiter reserves foreground capacity. Start this work
      // independently so cache hits and free provider slots can be used concurrently.
      await fill();
    })().catch(() => { if (!controller.signal.aborted) setError("Benchmark unavailable; retry"); });
    return () => controller.abort();
    // Trade identity includes its timestamp interpretation; primary data never depends on this hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, key, from, to, retry]);
  return { candles: result?.key === key ? result.result.candles : empty, error, retry: () => setRetry(n => n + 1) };
}
