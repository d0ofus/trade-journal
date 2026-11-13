import { expect, type Page } from "@playwright/test";
import { usEquitiesTradingSession } from "../../src/lib/server/market-session-calendar";
import { intersectRange, missingRanges, unionRanges, type CandleRange } from "../../src/lib/workstation/candle-ranges";
import { defaultPreferences, seconds, type Candle, type Interval } from "../../src/lib/workstation/types";

export const rvolPrefKey = "execution-lab:workstation:preferences:demo:v1";
export type RvolMetrics = { started: number | null; clickedAt?: number; symbol?: string; paints: Record<string, number>; paneStarts: number[]; calculationStarts: number[]; indicatorStarts: number[]; calculations: { maximumSlice: number; points: number }[]; longTasks: number[] };
declare global { interface Window { rvolMetrics: RvolMetrics } }
export function fixtureCandles(from: number, to: number, interval: Interval, extended: boolean, symbol = "NVDA") {
  const rows: Candle[] = [], step = seconds[interval];
  for (let day = Math.floor(from / 86400) * 86400; day <= to; day += 86400) {
    const date = new Date(day * 1000), market = usEquitiesTradingSession({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
    if (!market) continue;
    if (interval === "1wk" && date.getUTCDay() !== 1) continue;
    const coarse = interval === "1d" || interval === "1wk", start = coarse || !extended ? market.open : market.open - 5.5 * 3600, end = coarse ? start + 1 : extended ? market.open + 10.5 * 3600 : market.close;
    for (let time = start, slot = 0; time < end; time += step, slot++) {
      if (time < from || time > to) continue;
      const price = (symbol === "SPY" ? 500 : symbol === "QQQ" ? 450 : symbol === "AAPL" ? 200 : 175) + Math.sin(day / 86400) * 2 + slot * .02;
      rows.push({ time, open: price, high: price + .5, low: price - .5, close: price + .15, volume: (Math.abs(day / 86400) % 7 + 1) * 10000 + slot * 100 });
    }
  }
  return rows;
}
export async function openRvol(page: Page, options: { enabled?: boolean; mode?: "ordinary" | "cumulative" | "per-bar"; lookback?: number; panels?: number; cache?: "warm" | "cold" | "partial"; extended?: boolean; index?: boolean; theme?: "dark" | "light"; failure?: boolean; delay?: number; volumeSpike?: boolean } = {}) {
  const errors: string[] = [], requests: { purpose: string | null; mode: string; timeframe: string; from: number; to: number }[] = [], fills: string[] = [], covered = new Map<string, CandleRange[]>();
  page.on("pageerror", e => errors.push(e.stack ?? e.message));
  await page.addInitScript(() => {
    window.rvolMetrics = { started: null, paints: {}, paneStarts: [], calculationStarts: [], indicatorStarts: [], calculations: [], longTasks: [] };
    const request = window.fetch;
    window.fetch = function(input, init) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === "/api/workstation/candles" && !url.searchParams.has("purpose") && window.rvolMetrics.started === null) window.rvolMetrics.started = performance.now();
      if (url.pathname === "/api/workstation/candles" && url.searchParams.get("purpose") === "indicator") window.rvolMetrics.indicatorStarts.push(performance.now());
      return request.call(this, input, init);
    };
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
      const id = this.canvas.closest("[data-chart-id]")?.getAttribute("data-chart-id");
      if (id && (!window.rvolMetrics.symbol || this.canvas.closest("[data-history-identity]")?.getAttribute("data-history-identity")?.includes(window.rvolMetrics.symbol)) && this.canvas.closest(".ws-chart-canvas") && typeof this.fillStyle === "string" && ["#38bfa6", "#e47886"].includes(this.fillStyle.toLowerCase()) && w > 0 && h > 0 && !window.rvolMetrics.paints[id]) window.rvolMetrics.paints[id] = performance.now();
      fill.call(this, x, y, w, h);
    };
    window.addEventListener("workstation-rvol-calculated", event => window.rvolMetrics.calculations.push((event as CustomEvent).detail));
    window.addEventListener("workstation-rvol-calculation-started", () => window.rvolMetrics.calculationStarts.push(performance.now()));
    window.addEventListener("workstation-rvol-pane-started", () => window.rvolMetrics.paneStarts.push(performance.now()));
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) new PerformanceObserver(list => { window.rvolMetrics.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ type: "longtask", buffered: true });
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/workstation/candles") return route.abort();
    const q = url.searchParams, interval = q.get("timeframe") as Interval, symbol = q.get("symbol")!, mode = q.get("mode")!, purpose = q.get("purpose"), from = Number(q.get("from")), to = Number(q.get("to")) + .001, extended = q.get("session") === "extended", key = `${symbol}:${interval}:${extended}`;
    requests.push({ purpose, mode, timeframe: interval, from, to });
    if (purpose === "indicator" && options.failure && mode !== "cache") return route.fulfill({ status: 503, json: { error: "Fixture history temporarily unavailable" } });
    if (options.delay && purpose === "indicator") await new Promise(resolve => setTimeout(resolve, options.delay));
    const window = { from, to };
    let ranges = covered.get(key) ?? (options.cache === "cold" ? [] : options.cache === "partial" ? [{ from: Date.parse("2026-08-28T00:00:00Z") / 1000, to: Date.parse("2026-09-12T00:00:00Z") / 1000 }] : [window]);
    if (!options.cache || options.cache === "warm") ranges = unionRanges([...ranges, window]);
    if (mode !== "cache") { fills.push(purpose ?? "price"); ranges = unionRanges([...ranges, window]); }
    covered.set(key, ranges);
    ranges = unionRanges(ranges);
    const missing = missingRanges(window, ranges), rows = fixtureCandles(from, to, interval, extended, symbol).filter(c => ranges.some(r => c.time >= r.from && c.time < r.to));
    if (options.volumeSpike) for (const row of rows) if (row.time >= Date.parse("2026-09-09T00:00:00Z") / 1000 && row.time < Date.parse("2026-09-10T00:00:00Z") / 1000) row.volume *= 1e8;
    await route.fulfill({ json: { symbol, timeframe: interval, candles: rows, source: "alpaca", provider: { identity: `fixture:${key}`, provider: "alpaca", feed: "sip", adjustment: "split", delaySeconds: 0, cached: mode === "cache", fallback: false }, metadata: { session: { timezone: "America/New_York", calendar: "exchange", marketHours: extended ? "extended" : "regular" }, cache: { enabled: true, status: missing.length ? rows.length ? "partial" : "miss" : "hit", covered: ranges.map(r => intersectRange(r, window)).filter(Boolean), missing, refresh: [], effectiveRange: window }, warnings: [], truncated: false } } });
  });
  await page.addInitScript(({ key, prefs }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(prefs)); }, { key: rvolPrefKey, prefs: { ...defaultPreferences(), theme: options.theme ?? "dark", journal: false, rvol: { enabled: options.enabled ?? false, mode: options.mode ?? "cumulative", lookback: options.lookback ?? 20 }, panels: ["5m", "15m", "1h", "1d"].slice(0, options.panels ?? 1).map((interval, i) => ({ id: `chart-${i + 1}`, interval, session: options.extended ? "extended" : "regular", benchmark: options.index ? "SPY" : "off", benchmarkMode: "pane", benchmarkPaneRatio: .3 })) } });
  await page.goto("/preview/trades?scenario=rvol&groupKey=demo-nvda");
  await expect(page.locator('[data-chart-id="chart-1"]')).toHaveAttribute("data-visible-bars", /[1-9]/);
  return { errors, requests, fills };
}
