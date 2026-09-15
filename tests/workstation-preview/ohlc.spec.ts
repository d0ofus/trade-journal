import { expect, test, type Page, type Locator } from "@playwright/test";
import { demoCandles, demoTrades } from "../../src/lib/workstation/demo";
import { aggregateCandles, executionBar } from "../../src/lib/workstation/math";
import { defaultPreferences, type Candle, type Interval } from "../../src/lib/workstation/types";
import { readFileSync } from "node:fs";
import ts from "typescript";

const key = "execution-lab:workstation:preferences:demo:v1";
const format = (bar: Candle) => [bar.open, bar.high, bar.low, bar.close].map(n => n.toFixed(2));
const values = (chart: Locator) => chart.locator(".ws-ohlc b").allTextContents();
const fixture = (interval: Interval, trade = demoTrades[0]) => aggregateCandles(demoCandles(trade), interval);

async function open(page: Page, count = 3) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ key, count, prefs }) => {
    const intervals = ["5m", "1h", "1d", "1wk"];
    localStorage.setItem(key, JSON.stringify({ ...prefs, panels: intervals.slice(0, count).map((interval, i) => ({ id: `chart-${i + 1}`, interval })) }));
    const state = window as unknown as { ohlcTime: number; ohlcCommits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    state.ohlcCommits = 0;
    const renderers = new Map();
    type Fiber = { type?: { name?: string }; flags: number; child: Fiber | null; sibling: Fiber | null };
    state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers,
      inject: (renderer: unknown) => { renderers.set(1, renderer); return 1; },
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const visit = (fiber: Fiber | null) => {
          if (!fiber) return;
          // Ignore Next's development overlay and unrelated review/save commits.
          if (fiber.type?.name === "TradeChart" && (fiber.flags & 1)) state.ohlcCommits++;
          visit(fiber.child); visit(fiber.sibling);
        };
        visit(root.current);
      },
      onCommitFiberUnmount() {}, checkDCE() {},
    };
    window.addEventListener("workstation-crosshair", event => { state.ohlcTime = (event as CustomEvent).detail.time; });
  }, { key, count, prefs: defaultPreferences() });
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(count);
  for (const chart of await page.locator(".ws-chart").all()) {
    await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
    await expect(chart.locator('[data-ohlc="close"]')).toBeVisible();
  }
  return { errors, requests };
}

async function hover(page: Page, chart: Locator, fraction = .4, height = .4) {
  const box = (await chart.locator(".ws-chart-canvas").boundingBox())!;
  await page.mouse.move(box.x + (box.width - 65) * fraction, box.y + (box.height - 25) * height);
  return page.evaluate(() => (window as unknown as { ohlcTime: number }).ohlcTime);
}

for (const count of [1, 2, 3, 4]) test(`${count} panels show fixture OHLC immediately and retain their linked selections`, async ({ page }) => {
  const { errors, requests } = await open(page, count);
  const charts = page.locator(".ws-chart"), first = charts.first();
  const to = Number(await first.getAttribute("data-visible-to"));
  expect(await values(first)).toEqual(format(fixture("5m").findLast(bar => bar.time <= to)!));
  const intervals: Interval[] = ["5m", "1h", "1d", "1wk"];
  const seen = new Set<string>();
  for (const fraction of [.2, .35, .55, .75]) {
    const time = await hover(page, first, fraction);
    for (let i = 0; i < count; i++) {
      const bar = executionBar({ time } as never, fixture(intervals[i]), intervals[i], { timezone: "UTC", calendar: "utc", marketHours: "regular" });
      if (bar) expect(await values(charts.nth(i))).toEqual(format(bar));
    }
    seen.add((await values(first)).join(","));
  }
  expect(seen.size).toBeGreaterThan(1);
  const remembered = await Promise.all((await charts.all()).map(values));
  await page.mouse.move(0, 0);
  expect(await Promise.all((await charts.all()).map(values))).toEqual(remembered);
  // No candle at the linked time: all destinations keep their last inspected values.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("workstation-crosshair", { detail: { source: "absent-panel", time: 1 } })));
  expect(await Promise.all((await charts.all()).map(values))).toEqual(remembered);
  if (count > 1) {
    await page.getByRole("button", { name: "Link chart crosshairs", exact: true }).click();
    const others = await Promise.all((await charts.all()).slice(1).map(values));
    await hover(page, first, .1);
    expect(await values(first)).not.toEqual(remembered[0]);
    expect(await Promise.all((await charts.all()).slice(1).map(values))).toEqual(others);
  }
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("retained OHLC survives unrelated renders, history merging and fullscreen; new contexts reset it", async ({ page }) => {
  const { errors, requests } = await open(page, 1);
  const first = page.locator(".ws-chart").first();
  await hover(page, first, .3);
  const remembered = await values(first);
  await page.mouse.move(0, 0);
  await page.getByTitle("Appearance", { exact: true }).click();
  expect(await values(first)).toEqual(remembered);
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(first).toHaveAttribute("data-visible-bars", /[1-9]/);
  expect(await values(first)).toEqual(remembered);
  await first.getByRole("button", { name: "Focus chart-1", exact: true }).focus();
  await page.keyboard.press("Enter");
  expect(await values(first)).toEqual(remembered);
  await first.getByRole("button", { name: "Focus chart-1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(first.getByRole("button", { name: "Focus chart-1", exact: true })).toHaveAttribute("aria-pressed", "false");
  await first.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  const status = first.getByRole("status").first();
  const previous = await status.innerText();
  await first.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(status).not.toHaveText(previous);
  expect(await values(first)).toEqual(remembered);
  await first.getByRole("button", { name: "Close history chart-1", exact: true }).click();
  await page.getByLabel("Timeframe chart-1", { exact: true }).selectOption("1h");
  await expect(first.locator('[data-ohlc="close"]')).toBeVisible();
  await expect.poll(() => values(first)).not.toEqual(remembered);
  const daily = await values(first);
  await page.locator(".ws-trade-card-main").filter({ hasText: "TSLA" }).click();
  await expect.poll(() => values(first)).not.toEqual(daily);
  await hover(page, first, .4);
  const tsla = await values(first);
  await page.getByLabel("Chart session", { exact: true }).selectOption("extended");
  await expect(first.locator('[data-ohlc="close"]')).toBeVisible();
  await expect.poll(() => values(first)).not.toEqual(tsla);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("replay removes a future inspection and does not restore it on exit", async ({ page }) => {
  await open(page, 1);
  const first = page.locator(".ws-chart").first();
  await hover(page, first, .8);
  const future = await values(first);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await expect.poll(() => values(first)).not.toEqual(future);
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  await expect(first.locator('[data-ohlc="close"]')).toBeVisible();
  const to = Number(await first.getAttribute("data-visible-to"));
  await expect.poll(() => values(first)).toEqual(format(fixture("5m").findLast(bar => bar.time <= to)!));
});

test("pointer sweeps do not render React, write storage or repaint candle layers; same-candle movement writes no values", async ({ page }) => {
  const { requests } = await open(page, 4);
  const first = page.locator(".ws-chart").first();
  await hover(page, first, .4);
  // Let the existing viewport/save timers finish before measuring pointer-only work.
  await page.waitForTimeout(2200);
  expect(await page.evaluate(() => (window as unknown as { ohlcCommits: number }).ohlcCommits)).toBeGreaterThan(0);
  await page.evaluate(() => {
    const state = window as unknown as { ohlcCommits: number; ohlcStartCommits: number; ohlcWrites: number; ohlcStorage: number; ohlcCandlePaints: number };
    state.ohlcStartCommits = state.ohlcCommits;
    state.ohlcWrites = state.ohlcStorage = state.ohlcCandlePaints = 0;
    for (const el of document.querySelectorAll(".ws-ohlc b")) new MutationObserver(list => { state.ohlcWrites += list.length; }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(...args) { state.ohlcStorage++; return set.apply(this, args); };
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(...args) {
      if (this.canvas.closest(".ws-chart-canvas") && this.canvas.style.zIndex === "1") state.ohlcCandlePaints++;
      return fill.apply(this, args);
    };
  });
  await hover(page, first, .4, .6);
  expect(await page.evaluate(() => (window as unknown as { ohlcWrites: number }).ohlcWrites)).toBe(0);
  for (let i = 0; i < 30; i++) await hover(page, first, .15 + i * .02);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const result = await page.evaluate(() => {
    const s = window as unknown as { ohlcCommits: number; ohlcStartCommits: number; ohlcWrites: number; ohlcStorage: number; ohlcCandlePaints: number };
    return { commits: s.ohlcCommits - s.ohlcStartCommits, writes: s.ohlcWrites, storage: s.ohlcStorage, candlePaints: s.ohlcCandlePaints };
  });
  expect(result.writes).toBeGreaterThan(0);
  expect(result).toMatchObject({ commits: 0, storage: 0, candlePaints: 0 });
  expect(requests).toEqual([]);
});

test("real DOM OHLC updates finish synchronously within the interaction budget", async ({ page }, info) => {
  const source = ts.transpileModule(readFileSync("src/components/workstation/ohlc-legend.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  await page.setContent('<div id="legend"><span hidden>O <b data-ohlc="open"></b></span><span hidden>H <b data-ohlc="high"></b></span><span hidden>L <b data-ohlc="low"></b></span><span hidden>C <b data-ohlc="close"></b></span><span data-ohlc-empty>No completed candles</span></div>');
  const result = await page.evaluate(source => {
    const { createOhlcLegend } = new Function(`const exports = {}; ${source}; return exports;`)();
    const controller = createOhlcLegend(document.querySelector("#legend"));
    const times: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const start = performance.now();
      controller.inspect({ time: i, open: i / 7, high: i / 7 + 5, low: i / 7 - 5, close: i / 7 + (i % 2 ? 1 : -1) });
      times.push(performance.now() - start);
      if (document.querySelector('[data-ohlc="open"]')!.textContent !== (i / 7).toFixed(2)) throw new Error("OHLC write was deferred");
    }
    times.sort((a, b) => a - b);
    return { samples: times.length, p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1) };
  }, source);
  await info.attach("ohlc-interaction-timing", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.p95Ms).toBeLessThan(1);
});
