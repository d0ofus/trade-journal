import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../src/lib/prisma";
import { listWorkstationTrades } from "../../src/lib/server/trade-workstation";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { tradeViewSchema } from "../../src/lib/workstation/trade-view";

// Opt-in: this clears candle fixtures in the guarded disposable browser database.
test.skip(process.env.WORKSTATION_HISTORY_BENCHMARK !== "1", "Opt-in isolated browser benchmark");
test.setTimeout(600_000); // Includes cold setup writes plus all three separately isolated scenarios.
const root = path.join(process.env.TEMP!, "trade-workstation-phase2");
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).length : 0;
test.afterAll(() => prisma.$disconnect());

test("frozen 30-day hourly history: cold, partial and warm browser baselines", async ({ browser }) => {
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "DEMOC" }))[0];
  expect(trade).toBeTruthy();
  const to = Math.floor(trade.closeTime / 86400) * 86400 + 86400 - 1, from = to + 1 - 30 * 86400;
  const view = tradeViewSchema.parse({ version: 1, panels: [{ id: "chart-1", interval: "1h", session: "regular", range: { from, to } }], arrangement: "left" });
  for (const scenario of ["cold", "partial", "warm"]) {
    const context = await browser.newContext();
    const csrf = await (await context.request.get("/api/auth/csrf")).json();
    expect((await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } })).ok()).toBe(true);
    await prisma.workstationCandleChunk.deleteMany();
    await prisma.workstationCandleLease.deleteMany();
    await prisma.workstationTradeView.upsert({ where: { groupKey: trade.id }, create: { groupKey: trade.id, view }, update: { view, revision: { increment: 1 } } });
    if (scenario !== "cold") {
      const params = new URLSearchParams({ symbol: trade.symbol, timeframe: "1h", session: "regular", from: String(from), to: String(scenario === "warm" ? to : from + 14 * 86400 - 1), mode: "complete" });
      let covered = false;
      for (let i = 0; i < 8 && !covered; i++) {
        const result = await (await context.request.get(`/api/workstation/candles?${params}`, { timeout: 120000 })).json();
        covered = result.metadata?.cache?.missing.length === 0;
      }
      expect(covered).toBe(true);
    }
    const page = await context.newPage();
    await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs)), { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "1h" }], journal: false });
    let httpRequests = 0, completeCoverageMs: number | null = null;
    const providerBefore = lines(path.join(root, "cache-provider.log"));
    const queryBefore = process.env.WORKSTATION_TEST_QUERY_LOG ? lines(process.env.WORKSTATION_TEST_QUERY_LOG) : null;
    const at = performance.now();
    page.on("request", request => { if (request.url().includes("/api/workstation/candles?")) httpRequests++; });
    page.on("response", async response => {
      const url = new URL(response.url());
      if (!url.pathname.endsWith("/api/workstation/candles") || url.searchParams.get("symbol") !== trade.symbol || url.searchParams.get("timeframe") !== "1h") return;
      const cache = (await response.json().catch(() => null))?.metadata?.cache;
      if (cache && !cache.missing.length && !cache.refresh.length && cache.effectiveRange.from <= from && cache.effectiveRange.to >= to && completeCoverageMs === null) completeCoverageMs = performance.now() - at;
    });
    await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(trade.id)}`);
    const chart = page.locator('[data-chart-id="chart-1"]');
    await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/, { timeout: 120000 });
    const firstChartPaintMs = performance.now() - at;
    await expect.poll(() => completeCoverageMs, { timeout: 120000 }).not.toBeNull();
    await expect(chart.locator(".ws-history-progress")).toHaveCount(0);
    const row = { version: process.env.WORKSTATION_BENCHMARK_VERSION ?? "local", scenario, firstChartPaintMs, completeCoverageMs, httpRequests, providerCalls: lines(path.join(root, "cache-provider.log")) - providerBefore, databaseQueries: queryBefore === null ? null : lines(process.env.WORKSTATION_TEST_QUERY_LOG!) - queryBefore };
    console.log(JSON.stringify(row));
    await test.info().attach(`${scenario}-metrics`, { body: JSON.stringify(row, null, 2), contentType: "application/json" });
    if (scenario === "warm") expect(row.providerCalls).toBe(0);
    await context.close();
  }
});
