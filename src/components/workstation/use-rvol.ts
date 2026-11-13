"use client";
import { useEffect, useRef, useState } from "react";
import { intersectRange, missingRanges, unionRanges, type CandleRange } from "@/lib/workstation/candle-ranges";
import { calculateRvolAsync, retrievedCoverage, rvolMode, rvolWarmupRange, type RvolPoint, type RvolSettings } from "@/lib/workstation/rvol";
import { candlePeriod } from "@/lib/workstation/execution-diagnostics";
import { IndicatorScheduler } from "@/lib/workstation/indicator-scheduler";
import { waitForHistory } from "@/lib/workstation/shared-requests";
import type { Candle, CandleResult, Interval, Trade, WorkstationAdapter } from "@/lib/workstation/types";
import { seconds } from "@/lib/workstation/types";

type Input = { settings: RvolSettings; result: CandleResult; candles: Candle[]; interval: Interval; trade: Trade; adapter: WorkstationAdapter; scheduler: IndicatorScheduler; visible: CandleRange | null; cutoff: number; paused: boolean };
type State = { key: string; points: RvolPoint[]; loading: boolean; error: string };
type Buffer = { key: string; candles: Map<number, Candle>; coverage: CandleRange[]; volumeMissing: Set<number> };
const empty: RvolPoint[] = [];
export function useRvol(input: Input) {
  const [state, setState] = useState<State>({ key: "", points: empty, loading: false, error: "" }), [retry, setRetry] = useState(0);
  const buffer = useRef<Buffer>({ key: "", candles: new Map(), coverage: [], volumeMissing: new Set() });
  const basis = `${input.trade.id}:${input.trade.timeInterpretationVersion}:${input.trade.chartSession}:${input.interval}:${input.result.identity ?? input.result.source}`;
  const key = `${basis}:${input.settings.mode}:${input.settings.lookback}:${input.cutoff}`;
  const { settings, result, candles, interval, trade, adapter, scheduler, visible, cutoff, paused } = input;
  useEffect(() => {
    if (!settings.enabled || paused || !candles.length) return;
    const controller = new AbortController(), signal = controller.signal;
    const timer = setTimeout(() => {
      void (async () => {
        await scheduler.settled(signal);
        if (buffer.current.key !== basis) buffer.current = { key: basis, candles: new Map(), coverage: [], volumeMissing: new Set() };
        const cache = buffer.current;
        const targets = visible ? candles.filter(c => c.time >= visible.from - 7200 && c.time <= visible.to + 7200) : candles.slice(-240);
        if (!targets.length) { setState({ key, points: empty, loading: false, error: "" }); return; }
        const window = { from: targets[0].time, to: Math.ceil(Math.min(candlePeriod(targets.at(-1)!.time, interval, result.session).end, cutoff, Date.now() / 1000)) };
        const maximum = rvolWarmupRange(window, interval, settings, 2);
        for (const [time] of cache.candles) if (time < maximum.from || time > window.to) { cache.candles.delete(time); cache.volumeMissing.delete(time); }
        cache.coverage = unionRanges(cache.coverage.map(r => intersectRange(r, maximum)).filter((r): r is CandleRange => !!r));
        const merge = (response: CandleResult) => {
          if (response.truncated) throw new Error("RVOL history response was truncated. Retry with a smaller lookback.");
          if (response.identity && result.identity && response.identity !== result.identity) throw new Error("History identity changed; reload the chart before retrying RVOL.");
          const missing = new Set(response.volumeMissing);
          for (const c of response.candles) if (c.time >= maximum.from && c.time <= window.to) {
            cache.candles.set(c.time, c); if (missing.has(c.time)) cache.volumeMissing.add(c.time); else cache.volumeMissing.delete(c.time);
          }
          cache.coverage = unionRanges([...cache.coverage, ...retrievedCoverage(response)].map(r => intersectRange(r, maximum)).filter((r): r is CandleRange => !!r));
          if (cache.candles.size > 100000) throw new Error("RVOL history memory limit reached. Reduce the lookback.");
        };
        merge(result);
        const calculate = async (loading: boolean) => {
          // Only candles near the boundary need expensive exchange-period checks.
          const rows = [...cache.candles.values()].filter(c => c.time <= window.to && (!Number.isFinite(cutoff) || c.time < cutoff - seconds[interval] * 2 || candlePeriod(c.time, interval, result.session).end <= cutoff)).sort((a, b) => a.time - b.time);
          const points = await calculateRvolAsync({ candles: rows, targets, interval, settings, session: result.session, coverage: cache.coverage, volumeMissing: [...cache.volumeMissing] }, signal);
          signal.throwIfAborted(); setState({ key, points, loading, error: "" }); return points;
        };
        let points = await calculate(false);
        const needsHistory = () => points.some(p => p.value === null && p.reason !== "Historical average volume is zero");
        if (!needsHistory() || rvolMode(settings.mode, interval) !== "ordinary" && (result.session?.timezone !== "America/New_York" || result.session.calendar !== "exchange")) return;
        if (!adapter.indicatorCandles) { setState(v => ({ ...v, error: "Additional RVOL history is unavailable for this data source." })); return; }
        setState(v => ({ ...v, loading: true }));
        let attempts = 0;
        for (const multiplier of [1, 2]) {
          const desired = rvolWarmupRange(window, interval, settings, multiplier);
          const gaps = missingRanges(desired, cache.coverage);
          for (const gap of gaps) for (let from = gap.from; from < gap.to;) {
            const page = { from: Math.floor(from), to: Math.ceil(Math.min(gap.to, from + 14 * 86400)) };
            let previous = "", cached = true;
            while (missingRanges(page, cache.coverage).length) {
              signal.throwIfAborted();
              if (++attempts > 60) throw new Error("RVOL history is incomplete. Retry to continue loading.");
              const response = await scheduler.run(signal, transportSignal => adapter.indicatorCandles!(trade, interval, transportSignal, page, result.identity, cached ? "cache" : "fill"));
              signal.throwIfAborted(); merge(response);
              const current = JSON.stringify(missingRanges(page, cache.coverage));
              if (!cached && current === previous) {
                if (response.cache?.retryAfterMs && !response.cache.persistencePaused) { await waitForHistory(Math.min(response.cache.retryAfterMs, 5000), signal); continue; }
                throw new Error(response.warning || "No additional verified RVOL history was available. Retry or reduce the lookback.");
              }
              previous = current; cached = false;
              if (response.cache?.persistencePaused && missingRanges(page, cache.coverage).length) throw new Error("History storage is paused. Available RVOL results are retained.");
              if (response.cache?.retryAfterMs && missingRanges(page, cache.coverage).length) await waitForHistory(Math.min(response.cache.retryAfterMs, 5000), signal);
            }
            points = await calculate(true); from = page.to;
          }
          points = await calculate(false);
          if (!needsHistory()) return;
        }
        setState(v => ({ ...v, loading: false, error: needsHistory() ? "The requested lookback has insufficient comparable history." : "" }));
      })().catch(error => { if (!signal.aborted) setState(v => ({ ...v, key, loading: false, error: error instanceof Error ? error.message : "RVOL history could not be retrieved. Retry." })); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [settings, result, candles, interval, trade, adapter, scheduler, visible, cutoff, paused, basis, key, retry]);
  return { points: settings.enabled && state.key === key ? state.points : empty, loading: settings.enabled && candles.length > 0 && (state.key !== key || state.loading), error: settings.enabled && state.key === key ? state.error : "", retry: () => setRetry(v => v + 1) };
}
