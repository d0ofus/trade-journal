import { expect, test, type BrowserContext } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../src/lib/prisma";
import { listWorkstationTrades } from "../../src/lib/server/trade-workstation";
import { confirmBatchTimestamps, inspectBatchTimestamps } from "../../src/lib/server/execution-time-interpretation";
import { initialHistoryRange, preloadHistoryRange } from "../../src/lib/workstation/history";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { refreshMaterializedClosedTrades } from "../../src/lib/server/closed-trades-materialized";
import { observePngExport } from "../workstation-png";

const providerLog = path.join(process.env.TEMP!, "trade-workstation-phase2", "cache-provider.log");
const providerCalls = () => existsSync(providerLog) ? readFileSync(providerLog, "utf8").trim().split("\n").filter(Boolean).length : 0;
let previewId: string;
const previewUrl = () => `/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(previewId)}`;
const source = "workstation:v1:alpaca:sip:raw:extended";
const metrics: Record<string, number> = {};
async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  const response = await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true", callbackUrl: "http://127.0.0.1:3101/trades" } });
  expect(response.ok()).toBe(true);
}
test.beforeAll(async () => {
  if (existsSync(providerLog + ".offline")) unlinkSync(providerLog + ".offline");
  const preview = await inspectBatchTimestamps("DEMO-TIMESTAMP-PREVIEW");
  if (!preview.active) await confirmBatchTimestamps("DEMO-TIMESTAMP-PREVIEW", { timezone: "America/New_York", fingerprint: preview.fingerprint, expectedRevision: preview.revision });
  // Canonicalize the hand-authored seed before legacy navigation materializes it.
  await refreshMaterializedClosedTrades();
  previewId = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "MU" }))[0].id;
  mkdirSync("screenshots/cache-first-history", { recursive: true });
});
test.afterAll(async () => { writeFileSync("screenshots/cache-first-history/timings.json", JSON.stringify(metrics, null, 2)); await prisma.$disconnect(); });

test("cache paints before gap fill; reload, resize and Fit make zero upstream requests", async ({ page, context }) => {
  await login(context);
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION" })).find(t => t.id === previewId)!;
  const range = initialHistoryRange(trade, "5m");
  const demoIds = (await listWorkstationTrades({ account: "DEMO-WORKSTATION" })).map(t => t.id);
  await prisma.workstationTradeView.deleteMany({ where: { groupKey: { in: demoIds } } });
  await prisma.workstationCandleChunk.deleteMany({ where: { symbol: "MU", timeframe: "5m" } });
  const partial = new URLSearchParams({ symbol: "MU", timeframe: "5m", from: String(range.from), to: String(Math.floor((range.from + range.to) / 2)), session: "extended", mode: "fill" });
  expect((await context.request.get(`/api/workstation/candles?${partial}`)).ok()).toBe(true);
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs)), { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m" }] });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const firstVisit = performance.now();
  await page.goto(previewUrl());
  const chart = page.getByRole("region", { name: "MU 5m chart", exact: true });
  await expect(chart.locator(".ws-history-progress")).toBeVisible();
  await expect.poll(async () => Number(await chart.getAttribute("data-visible-bars"))).toBeGreaterThan(0);
  metrics.firstBrowserPaintMs = performance.now() - firstVisit;
  await page.screenshot({ path: "screenshots/cache-first-history/partial-cache.png" });
  await expect(chart.locator(".ws-history-progress")).toHaveCount(0, { timeout: 15000 });
  await expect(chart.getByText("Loading candles…", { exact: true })).toHaveCount(0);
  const count = providerCalls(); const start = performance.now();
  await page.reload(); await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  metrics.warmPageReloadMs = performance.now() - start;
  await page.waitForTimeout(1600); expect(providerCalls()).toBe(count);
  const before = { from: await chart.getAttribute("data-visible-from"), to: await chart.getAttribute("data-visible-to") };
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByRole("button", { name: "Fit all charts to trade", exact: true }).click(); await page.waitForTimeout(800);
  expect(providerCalls()).toBe(count); expect(before.from).not.toBeNull();
  await page.locator(".ws-trade-card-main").filter({ hasText: "DEMOC" }).click();
  const other = page.getByRole("region", { name: "DEMOC 5m chart", exact: true });
  await expect(other).toHaveAttribute("data-visible-bars", /[1-9]/); await expect(other.locator(".ws-history-progress")).toHaveCount(0, { timeout: 15000 });
  const selectedAt = performance.now(), callsBeforeSelection = providerCalls();
  await page.locator(".ws-trade-card-main").filter({ hasText: "MU" }).click(); await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  metrics.warmSelectionMs = performance.now() - selectedAt; expect(metrics.warmSelectionMs).toBeLessThan(1000); expect(providerCalls()).toBe(callsBeforeSelection);
  await page.screenshot({ path: "screenshots/cache-first-history/laptop-dark.png" });
  await page.getByTitle("Appearance", { exact: true }).click(); await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await page.screenshot({ path: "screenshots/cache-first-history/laptop-light.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/cache-first-history/mobile-light.png" });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-dark/);
  await page.screenshot({ path: "screenshots/cache-first-history/mobile-dark.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
test("cache-only prefetch and covered endpoint reads never call the provider; offline panes keep Alpaca bars", async ({ context }) => {
  await login(context);
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION" })).find(t => t.id === previewId)!;
  const range = initialHistoryRange(trade, "5m");
  const params = new URLSearchParams({ symbol: "MU", timeframe: "5m", from: String(range.from), to: String(range.to), session: "extended", mode: "cache" });
  const count = providerCalls(), start = performance.now();
  const cached = await (await context.request.get(`/api/workstation/candles?${params}`)).json();
  metrics.warmCacheEndpointMs = performance.now() - start; metrics.databaseCacheReadMs = cached.metadata.cache.timings.cacheReadMs;
  expect(cached.metadata.cache.missing).toEqual([]); expect(cached.provider.identity).toBe(source); expect(providerCalls()).toBe(count);
  params.set("symbol", "NOTCACHED"); await context.request.get(`/api/workstation/candles?${params}`); expect(providerCalls()).toBe(count);
  params.set("symbol", "MU"); params.set("mode", "fill"); params.set("to", String(range.to + 86400));
  writeFileSync(providerLog + ".offline", "offline");
  try {
    const result = await (await context.request.get(`/api/workstation/candles?${params}`)).json();
    expect(result.candles.length).toBe(cached.candles.length); expect(result.provider.identity).toBe(source); expect(result.provider.fallback).toBe(false); expect(result.metadata.warnings.join(" ")).toContain("preserved");
  } finally { unlinkSync(providerLog + ".offline"); }
});
test("market-data settings and endpoints stay authenticated and explain preparation state", async ({ page, context, browser }) => {
  test.setTimeout(90000); // Branch-wide storage accounting can be slow on local PostgreSQL.
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get("http://127.0.0.1:3101/api/workstation/market-data")).status()).toBe(401); await anonymous.close();
  await login(context);
  const status = page.waitForResponse(response => new URL(response.url()).pathname === "/api/workstation/market-data", { timeout: 60000 });
  await page.goto("/settings#market-data"); expect((await status).ok()).toBe(true);
  const card = page.locator("#market-data"); await expect(card.getByText(/^Cache:/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Queue all trade windows" })).toBeDisabled();
  const forbidden = await context.request.post("/api/workstation/market-data", { headers: { Origin: "https://other.example" }, data: { action: "run" } }); expect(forbidden.status()).toBe(403);
  await card.screenshot({ path: "screenshots/cache-first-history/market-data-settings.png" });
});

test("cached multichart resizing, fullscreen, replay and PNG export preserve chart data without downloads", async ({ page, context }) => {
  test.setTimeout(120000); // Three cold fixture intervals are seeded before exercising the UI.
  await login(context);
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION" })).find(t => t.id === previewId)!;
  await prisma.workstationTradeView.deleteMany({ where: { groupKey: previewId } });
  for (const interval of ["5m", "1h", "1d"] as const) {
    const range = preloadHistoryRange(trade, interval);
    // Preparation may include a stale recent segment and a new 15-minute tail.
    // Complete mode fills both; the UI deliberately uses progressive single-window fills.
    const params = new URLSearchParams({ symbol: "MU", timeframe: interval, from: String(range.from), to: String(range.to), session: "extended", mode: "complete" });
    const response = await (await context.request.get(`/api/workstation/candles?${params}`)).json(); expect(response.metadata.cache.missing).toEqual([]);
  }
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs)), { ...defaultPreferences(), journal: false });
  await page.goto(previewUrl()); const charts = page.locator(".ws-chart"); await expect(charts).toHaveCount(3);
  for (const chart of await charts.all()) await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  await expect(page.locator(".ws-history-progress")).toHaveCount(0, { timeout: 15000 });
  const count = providerCalls();
  const divider = page.locator(".ws-chart-divider").first(); await divider.focus(); await divider.press("ArrowRight");
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await expect(page.locator('[data-chart-id="chart-1"]')).toHaveClass(/ws-chart-fullscreen/);
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  // Let the ordinary navigation save settle before measuring a label-only change.
  await page.waitForTimeout(1500);
  const labelRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/workstation/candles?") || (request.method() !== "GET" && request.url().includes("/workstation"))) labelRequests.push(request.url()); });
  await page.getByRole("button", { name: "Hide execution labels", exact: true }).click();
  await expect(charts.first()).toHaveAttribute("data-label-mode", "compact");
  for (const chart of (await charts.all()).slice(1)) await expect(chart).toHaveAttribute("data-label-mode", "labels");
  await page.getByRole("button", { name: "Show execution labels", exact: true }).click();
  await page.waitForTimeout(1200);
  expect(labelRequests).toEqual([]);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.screenshot({ path: "screenshots/cache-first-history/multichart-replay.png" });
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  await page.screenshot({ path: "screenshots/cache-first-history/desktop-multichart-dark.png" });
  const exportedPng = await observePngExport(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "All charts PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  const png = await exportedPng(); expect(png.subarray(1, 4).toString()).toBe("PNG");
  writeFileSync("screenshots/cache-first-history/multichart-export.png", png);
  expect(providerCalls()).toBe(count);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.screenshot({ path: "screenshots/cache-first-history/desktop-multichart-light.png" });
});
