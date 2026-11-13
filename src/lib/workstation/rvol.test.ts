import { describe, expect, it } from "vitest";
import { adjustSplitCandle } from "./split-adjustment";
import { calculateRvol, calculateRvolAsync, defaultRvol, restoreRvol, rvolDescription, rvolMode, rvolPaneRatio, rvolWarmupRange, type RvolInput, type RvolMode } from "./rvol";
import { tradeViewSchema, viewPreferences } from "./trade-view";
import { restoreChartDisplay } from "./chart-preferences";
import { CandleMemory } from "./candle-memory";
import type { Candle, CandleSession, Interval } from "./types";

const regular: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "regular" };
const time = (value: string) => Date.parse(value) / 1000;
const bar = (date: string, volume: number): Candle => ({ time: time(date), open: 10, high: 11, low: 9, close: 10, volume });
const days = ["2026-09-21", "2026-09-22", "2026-09-23"];
const candles = days.flatMap((d, i) => [bar(`${d}T13:30:00Z`, (i + 1) * 100), bar(`${d}T13:35:00Z`, (i + 1) * 200)]);
const coverage = days.map(d => ({ from: time(`${d}T13:30:00Z`), to: time(`${d}T20:00:00Z`) }));
const input = (mode: RvolMode, changes: Partial<RvolInput> = {}): RvolInput => ({ candles, targets: candles.slice(-2), interval: "5m", settings: { enabled: true, mode, lookback: 2 }, session: regular, coverage, now: time("2026-09-24T00:00:00Z"), ...changes });

describe("RVOL arithmetic and availability", () => {
  it("excludes the current candle and distinguishes the three modes", () => {
    expect(calculateRvol(input("ordinary")).map(p => p.value)).toEqual([1, 600 / 350]);
    expect(calculateRvol(input("cumulative")).at(-1)).toMatchObject({ value: 2, actual: 900, average: 450, samples: 2 });
    expect(calculateRvol(input("per-bar")).at(-1)).toMatchObject({ value: 2, actual: 600, average: 300, samples: 2 });
  });
  it("only treats missing buckets as zero with verified retrieval coverage", () => {
    const sparse = candles.filter((_, i) => i !== 1);
    expect(calculateRvol(input("per-bar", { candles: sparse })).at(-1)).toMatchObject({ value: 3, average: 200 });
    expect(calculateRvol(input("per-bar", { candles: sparse, coverage: coverage.slice(1) })).at(-1)).toMatchObject({ value: null, samples: 1 });
  });
  it("does not hide incomplete recent sessions by substituting older sessions", () => {
    const older = [bar("2026-09-18T13:35:00Z", 5), ...candles];
    const p = calculateRvol(input("per-bar", { candles: older, coverage: [{ from: time("2026-09-18T13:30:00Z"), to: time("2026-09-18T20:00:00Z") }, ...coverage.slice(1)] })).at(-1)!;
    expect(p.value).toBeNull(); expect(p.samples).toBe(1); expect(p.reason).toContain("coverage is incomplete");
  });
  it("does not present a partial current-session sum as a known accumulated volume", () => {
    expect(calculateRvol(input("cumulative", { volumeMissing: [candles[4].time] })).at(-1)).toMatchObject({ value: null, actual: null });
    expect(calculateRvol(input("cumulative", { coverage: coverage.slice(0, 2) })).at(-1)).toMatchObject({ value: null, actual: null });
  });
  it("does not turn empty pre-listing queries into zero-volume baseline sessions", () => {
    const points = calculateRvol(input("per-bar", { settings: { enabled: true, mode: "per-bar", lookback: 20 }, coverage: [{ from: candles[0].time - 90 * 86400, to: candles.at(-1)!.time + 300 }] }));
    expect(points.at(-1)).toMatchObject({ value: null, samples: 2 }); expect(points.at(-1)?.reason).toContain("Insufficient reported trading history");
  });
  it("distinguishes unreported volume, reported zero, and a zero denominator", () => {
    expect(calculateRvol(input("per-bar", { volumeMissing: [candles[1].time] })).at(-1)?.value).toBeNull();
    const zero = candles.map((c, i) => ({ ...c, volume: i < 4 ? 0 : c.volume }));
    expect(calculateRvol(input("ordinary", { candles: zero, targets: [zero[4]] }))[0]).toMatchObject({ value: null, average: 0, reason: "Historical average volume is zero" });
    const currentZero = candles.map((c, i) => i === 5 ? { ...c, volume: 0 } : c);
    expect(calculateRvol(input("per-bar", { candles: currentZero, targets: [currentZero[5]] }))[0].value).toBe(0);
  });
  it("does not include future bars in the current session's accumulation", () => {
    const before = calculateRvol(input("cumulative")), future = [...candles, bar("2026-09-23T13:40:00Z", 999999), bar("2026-09-24T13:30:00Z", 999999)];
    expect(calculateRvol(input("cumulative", { candles: future }))).toEqual(before);
  });
  it("marks forming bars provisional without extrapolating", () => {
    const p = calculateRvol(input("per-bar", { now: candles.at(-1)!.time + 60 })).at(-1)!;
    expect(p).toMatchObject({ value: 2, actual: 600, provisional: true });
  });
  it("preserves available values alongside retrieval warnings and reports unavailable sample details", () => {
    const point = calculateRvol(input("per-bar")).at(-1)!;
    expect(rvolDescription(point, false, "Retry history")).toContain("2.00× · Volume 600 · Average 300 · 2 samples · Retry history");
    expect(rvolDescription({ ...point, value: null, average: 0, reason: "Historical average volume is zero" })).toContain("Average 0 · 2 samples");
  });
  it("falls back to ordinary RVOL for daily and weekly without changing preferences", () => {
    for (const interval of ["1d", "1wk"] as Interval[]) {
      expect(rvolMode("cumulative", interval)).toBe("ordinary");
      expect(calculateRvol(input("cumulative", { interval, session: undefined }))[0].value).toBe(1);
    }
    expect(calculateRvol(input("cumulative", { session: undefined }))[0].reason).toContain("Verified exchange session");
  });
  it("consumes adjusted volume directly without another adjustment", () => {
    const raw = [bar("2026-09-21T13:30:00Z", 100), bar("2026-09-22T13:30:00Z", 200)];
    const adjusted = raw.map(c => adjustSplitCandle(c, { version: 1, asOf: "2026-09-23", splits: [{ time: time("2026-09-22T00:00:00Z"), ratio: 2 }] }));
    expect(calculateRvol(input("ordinary", { candles: adjusted, targets: [adjusted[1]], settings: { enabled: true, mode: "ordinary", lookback: 1 } }))[0].value).toBe(1);
  });
});

describe("RVOL exchange periods", () => {
  it("matches the regular open across daylight saving changes and weekends", () => {
    const rows = [bar("2026-10-30T13:30:00Z", 100), bar("2026-11-02T14:30:00Z", 300)];
    const p = calculateRvol(input("per-bar", { candles: rows, targets: [rows[1]], settings: { enabled: true, mode: "per-bar", lookback: 1 }, coverage: [{ from: rows[0].time, to: rows[1].time + 300 }], now: rows[1].time + 3600 }))[0];
    expect(p.value).toBe(3);
  });
  it("skips holidays and incompatible early closes within the bounded search", () => {
    const rows = [bar("2026-11-24T19:00:00Z", 100), bar("2026-11-25T19:00:00Z", 200), bar("2026-11-30T19:00:00Z", 450)];
    const p = calculateRvol(input("per-bar", { candles: rows, targets: rows.slice(-1), coverage: [{ from: rows[0].time, to: rows[2].time + 300 }], now: rows[2].time + 3600 }))[0];
    expect(p).toMatchObject({ value: 3, samples: 2 });
  });
  it("keeps extended accumulation across the regular open and resets by local date", () => {
    const rows = [bar("2026-09-22T12:00:00Z", 100), bar("2026-09-22T13:30:00Z", 100), bar("2026-09-23T12:00:00Z", 300), bar("2026-09-23T13:30:00Z", 300)];
    const p = calculateRvol(input("cumulative", { candles: rows, targets: rows.slice(-1), settings: { enabled: true, mode: "cumulative", lookback: 1 }, session: { ...regular, marketHours: "extended" }, coverage: [{ from: time("2026-09-22T04:00:00Z"), to: time("2026-09-24T04:00:00Z") }] }))[0];
    expect(p).toMatchObject({ value: 3, actual: 600, average: 200 });
  });
  it("requires equivalent source granularity for shortened hourly buckets", () => {
    const rows = [bar("2026-11-25T17:30:00Z", 100), bar("2026-11-27T17:30:00Z", 300)];
    expect(calculateRvol(input("per-bar", { interval: "1h", candles: rows, targets: rows.slice(-1), settings: { enabled: true, mode: "per-bar", lookback: 1 }, coverage: [{ from: rows[0].time - 86400, to: rows[1].time + 86400 }], now: rows[1].time + 7200 }))[0].value).toBeNull();
  });
});

describe("RVOL preferences and bounded work", () => {
  it("does not advertise cached coverage outside the returned candle window or lose unreported volume", () => {
    const memory = new CandleMemory(), cache = { enabled: true, status: "hit" as const, covered: [{ from: 100, to: 1000 }], missing: [], refresh: [], effectiveRange: { from: 100, to: 1000 } };
    memory.put("stock", { candles: [bar("1970-01-01T00:05:00Z", 0), bar("1970-01-01T00:10:00Z", 100)], retrieved: cache.covered, volumeMissing: [300], cache, identity: "same", source: "fixture", warning: "" });
    memory.put("stock", { candles: [bar("1970-01-01T00:11:40Z", 100)], cache: { ...cache, covered: [{ from: 700, to: 800 }] }, identity: "same", source: "fixture", warning: "" });
    const result = memory.get("stock", { from: 200, to: 400 })!;
    expect(result.candles.map(c => c.time)).toEqual([300]); expect(result.volumeMissing).toContain(300);
    expect(result.retrieved!.every(r => r.from >= 200 && r.to <= 400)).toBe(true);
    expect(result.cache?.covered).toEqual([{ from: 200, to: 400 }]);
  });
  it("defaults hidden, validates imports, and retains independent mode/visibility", () => {
    expect(restoreRvol(undefined)).toEqual(defaultRvol());
    expect(restoreChartDisplay({}).rvol.enabled).toBe(false);
    expect(restoreRvol({ enabled: true, mode: "per-bar", lookback: 100 })).toEqual({ enabled: true, mode: "per-bar", lookback: 100 });
    for (const lookback of [0, 101, NaN, "20", 1.5]) expect(restoreRvol({ lookback }).lookback).toBe(20);
    expect(rvolPaneRatio()).toBe(.2); expect(rvolPaneRatio(.8)).toBe(.4); expect(rvolPaneRatio(.01)).toBe(.15);
  });
  it("round trips new pane heights in version-one views and accepts old views", () => {
    const old = { version: 1, arrangement: "left", panels: [{ id: "chart-1", interval: "5m", session: "regular", range: null }] };
    expect(tradeViewSchema.safeParse(old).success).toBe(true);
    const next = tradeViewSchema.parse({ ...old, panels: [{ ...old.panels[0], rvolPaneRatio: .3 }] });
    expect(viewPreferences(next).panels?.[0].rvolPaneRatio).toBe(.3);
    expect(tradeViewSchema.safeParse({ ...old, panels: [{ ...old.panels[0], rvolPaneRatio: .9 }] }).success).toBe(false);
  });
  it("requests prior trading sessions without moving the requested right edge", () => {
    const window = { from: candles[4].time, to: candles[5].time + 300 }, range = rvolWarmupRange(window, "5m", { enabled: true, mode: "cumulative", lookback: 2 });
    expect(range.to).toBe(window.to); expect(range.from).toBe(time("2026-09-21T04:00:00Z"));
  });
  it("cancels asynchronous calculation and agrees with synchronous fixtures", async () => {
    expect(await calculateRvolAsync(input("cumulative"), new AbortController().signal)).toEqual(calculateRvol(input("cumulative")));
    const controller = new AbortController(); controller.abort(); await expect(calculateRvolAsync(input("cumulative"), controller.signal)).rejects.toBeTruthy();
  });
});
