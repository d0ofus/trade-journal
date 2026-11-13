import { usEquitiesTradingSession } from "../server/market-session-calendar";
import { candlePeriod } from "./execution-diagnostics";
import { missingRanges, unionRanges, type CandleRange } from "./candle-ranges";
import { seconds, type Candle, type CandleResult, type CandleSession, type Interval } from "./types";

export type RvolMode = "ordinary" | "cumulative" | "per-bar";
export type RvolSettings = { enabled: boolean; mode: RvolMode; lookback: number };
export const defaultRvol = (): RvolSettings => ({ enabled: false, mode: "cumulative", lookback: 20 });
export function restoreRvol(value: unknown): RvolSettings {
  const v = value && typeof value === "object" ? value as Partial<RvolSettings> : {};
  return { enabled: v.enabled === true, mode: v.mode === "ordinary" || v.mode === "per-bar" ? v.mode : "cumulative", lookback: Number.isInteger(v.lookback) && v.lookback! >= 1 && v.lookback! <= 100 ? v.lookback! : 20 };
}
export const rvolPaneRatio = (value?: number) => Number.isFinite(value) ? Math.max(.15, Math.min(.4, value!)) : .2;
export const rvolMode = (mode: RvolMode, interval: Interval): RvolMode => interval === "1d" || interval === "1wk" ? "ordinary" : mode;
export const rvolTitle = (mode: RvolMode, lookback: number) => mode === "ordinary" ? `RVOL · ${lookback} candle${lookback === 1 ? "" : "s"}` : `RVOL at time · ${mode === "cumulative" ? "Cumulative" : "Per bar"} · ${lookback} session${lookback === 1 ? "" : "s"}`;
export const retrievedCoverage = (result: CandleResult) => unionRanges([...(result.retrieved ?? []), ...(result.cache?.covered ?? []), ...(result.cache?.temporary ?? [])]);

const DAY = 86400;
const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const offsets = new Map<number, number>();
function offset(time: number) {
  const hour = Math.floor(time / 3600);
  let value = offsets.get(hour);
  if (value === undefined) {
    const p = Object.fromEntries(clock.formatToParts(new Date(time * 1000)).map(p => [p.type, Number(p.value)]));
    value = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - Math.floor(time);
    if (offsets.size > 4096) offsets.clear();
    offsets.set(hour, value);
  }
  return value;
}
function local(time: number) { const shifted = time + offset(time), day = Math.floor(shifted / DAY); return { day, slot: shifted - day * DAY }; }
function midnight(day: number) { const noon = day * DAY + 17 * 3600; return day * DAY - offset(noon); }
const markets = new Map<number, ReturnType<typeof usEquitiesTradingSession>>();
function market(day: number) {
  if (markets.has(day)) return markets.get(day)!;
  const date = new Date(day * DAY * 1000);
  const result = usEquitiesTradingSession({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  if (markets.size > 4096) markets.clear(); markets.set(day, result); return result;
}
function priorDays(day: number, count: number) {
  const result: number[] = [];
  for (let d = day - 1; result.length < count && day - d < count * 3 + 30; d--) if (market(d)) result.push(d);
  return result;
}
export function rvolWarmupRange(visible: CandleRange, interval: Interval, settings: RvolSettings, multiplier = 1): CandleRange {
  if (rvolMode(settings.mode, interval) === "ordinary") {
    const padding = interval === "1wk" ? settings.lookback * 9 + 14 : interval === "1d" ? Math.ceil(settings.lookback * 1.7 + 4) : Math.ceil(settings.lookback * seconds[interval] / 23400 * 1.7 + 4);
    return { from: Math.max(1, Math.floor(visible.from - padding * DAY)), to: Math.ceil(visible.to) };
  }
  const days = priorDays(local(visible.from).day, settings.lookback * multiplier);
  return { from: Math.max(1, midnight(days.at(-1) ?? local(visible.from).day)), to: Math.ceil(visible.to) };
}

export type RvolPoint = { time: number; value: number | null; actual: number | null; average: number | null; samples: number; reason?: string; provisional: boolean };
export type RvolInput = { candles: readonly Candle[]; targets: readonly Candle[]; interval: Interval; settings: RvolSettings; session?: CandleSession; coverage: CandleRange[]; volumeMissing?: readonly number[]; now?: number };
type SessionBar = { candle: Candle; end: number; sum: number; invalid: boolean };

/** Shared generator permits browser work to yield without changing calculation semantics. */
function* calculation(input: RvolInput): Generator<RvolPoint | undefined> {
  const { interval, settings, session } = input, mode = rvolMode(settings.mode, interval), n = settings.lookback;
  const coverage = unionRanges(input.coverage), unavailable = new Set(input.volumeMissing), now = input.now ?? Date.now() / 1000;
  const covered = (from: number, to: number) => !missingRanges({ from, to }, coverage).length;
  const sessions = new Map<number, SessionBar[]>(), positions = new Map<number, number>();
  const verified = session?.calendar === "exchange" && session.timezone === "America/New_York" && (session.marketHours === "regular" || session.marketHours === "extended");
  for (let i = 0; i < input.candles.length; i++) {
    const c = input.candles[i]; positions.set(c.time, i);
    if (mode !== "ordinary" && verified) {
      const d = local(c.time).day, rows = sessions.get(d) ?? [], previous = rows.at(-1);
      const invalid = unavailable.has(c.time) || !Number.isFinite(c.volume) || c.volume < 0;
      const end = session!.marketHours === "regular" ? Math.min(c.time + seconds[interval], market(d)?.close ?? Infinity) : c.time + seconds[interval];
      rows.push({ candle: c, end, sum: (previous?.sum ?? 0) + (invalid ? 0 : c.volume), invalid: !!previous?.invalid || invalid }); sessions.set(d, rows);
    }
    if (i % 128 === 0) yield undefined;
  }
  const daysCache = new Map<number, number[]>();
  const firstReportedDay = Math.min(...sessions.keys());
  for (const c of input.targets) {
    const period = candlePeriod(c.time, interval, session), provisional = period.end > now;
    const point: RvolPoint = { time: c.time, value: null, actual: c.volume, average: null, samples: 0, provisional };
    if (unavailable.has(c.time) || !Number.isFinite(c.volume)) { yield { ...point, actual: null, reason: "Volume was not reported" }; continue; }
    if (mode === "ordinary") {
      const index = positions.get(c.time) ?? -1, start = Math.max(0, index - n);
      let sum = 0;
      for (let j = start; j < index; j++) if (!unavailable.has(input.candles[j].time) && Number.isFinite(input.candles[j].volume)) { sum += input.candles[j].volume; point.samples++; }
      if (point.samples === n) point.average = sum / n;
      else point.reason = `Incomplete history · ${point.samples}/${n} candles`;
    } else if (!verified) { if (mode === "cumulative") point.actual = null; point.reason = "Verified exchange session required; ordinary RVOL is available"; }
    else {
      const { day, slot } = local(c.time), duration = period.end - c.time;
      const start = session!.marketHours === "regular" ? market(day)?.open : midnight(day);
      const current = sessions.get(day)?.find(row => row.candle.time === c.time);
      if (mode === "cumulative") point.actual = current?.sum ?? null;
      if (!start || !current || (mode === "cumulative" && current.invalid) || !covered(mode === "cumulative" ? start : c.time, Math.min(period.end, now))) { if (mode === "cumulative") point.actual = null; point.reason = "Current session history is incomplete"; }
      else {
        let sum = 0;
        const days = daysCache.get(day) ?? priorDays(day, n * 2); daysCache.set(day, days);
        for (const d of days) {
          const m = market(d)!, time = midnight(d) + slot, end = time + duration;
          if (session!.marketHours === "regular" && (time < m.open || end > m.close || Math.min(time + seconds[interval], m.close) !== end)) continue;
          // A successful pre-listing query is empty, but is not a zero-volume trading session.
          if (d < firstReportedDay) { point.reason = "Insufficient reported trading history"; break; }
          const from = mode === "cumulative" ? session!.marketHours === "regular" ? m.open : midnight(d) : time;
          // Missing retrieval cannot be hidden by substituting an older session.
          if (!covered(from, end)) { point.reason = "Historical session coverage is incomplete"; break; }
          const rows = sessions.get(d) ?? [];
          let lo = 0, hi = rows.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].candle.time < end) lo = mid + 1; else hi = mid; }
          const last = rows[lo - 1];
          if (last && last.end > end) continue; // A truncated current bucket needs equivalent source granularity.
          if (mode === "cumulative" ? last?.invalid : last?.candle.time === time && unavailable.has(time)) { point.reason = "Historical volume was not reported"; break; }
          sum += mode === "cumulative" ? last?.sum ?? 0 : last?.candle.time === time ? last.candle.volume : 0;
          point.samples++;
          if (point.samples === n) break;
        }
        if (point.samples === n) point.average = sum / n;
        else point.reason = `${point.reason ?? "Insufficient comparable history"} · ${point.samples}/${n} sessions`;
      }
    }
    if (point.average !== null) {
      if (point.average > 0 && point.actual !== null) point.value = point.actual / point.average;
      else point.reason = "Historical average volume is zero";
    }
    yield point;
  }
}
export function calculateRvol(input: RvolInput) { return [...calculation(input)].filter((p): p is RvolPoint => !!p); }
export async function calculateRvolAsync(input: RvolInput, signal: AbortSignal): Promise<RvolPoint[]> {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workstation-rvol-calculation-started"));
  const points: RvolPoint[] = []; let at = performance.now(), maximumSlice = 0;
  for (const point of calculation(input)) {
    signal.throwIfAborted(); if (point) points.push(point);
    const elapsed = performance.now() - at;
    if (elapsed > 8) { maximumSlice = Math.max(maximumSlice, elapsed); await new Promise(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); at = performance.now(); }
  }
  maximumSlice = Math.max(maximumSlice, performance.now() - at);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workstation-rvol-calculated", { detail: { maximumSlice, points: points.length } }));
  return points;
}
const compactVolume = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
export function rvolDescription(point: RvolPoint | undefined, loading = false, error = "") {
  if (!point) return [loading ? "Loading lookback history…" : "No eligible candles", error].filter(Boolean).join(" · ");
  const format = (v: number | null) => v === null ? "unavailable" : compactVolume.format(v);
  const value = point.value === null ? point.reason ?? "Relative volume unavailable" : `${point.value.toFixed(2)}×`;
  return `${value} · Volume ${format(point.actual)} · Average ${format(point.average)} · ${point.samples} sample${point.samples === 1 ? "" : "s"}${point.provisional ? " · Provisional" : ""}${error ? ` · ${error}` : ""}`;
}
