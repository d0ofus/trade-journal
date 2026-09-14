import { expect, test } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { listWorkstationTrades } from "../../src/lib/server/trade-workstation";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { initialHistoryRange, preloadHistoryRange } from "../../src/lib/workstation/history";

test.afterAll(() => prisma.$disconnect());
test("default hourly preload reaches 30 days while zoom and saved-view requests stay bounded", async ({ page, context }) => {
  test.setTimeout(180000);
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "DEMOC" }))[0];
  await prisma.workstationTradeView.deleteMany({ where: { groupKey: trade.id } });
  await prisma.workstationCandleChunk.deleteMany({ where: { symbol: trade.symbol, timeframe: "1h" } });
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  expect((await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } })).ok()).toBe(true);
  await page.addInitScript(prefs => {
    localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs));
    localStorage.setItem("execution-lab:backup-reminder:snoozed:v1", String(Date.now()));
  }, { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "1h" }], chartSession: "regular" });
  const requested: { from: number; to: number }[] = [];
  let completeFrom = Infinity;
  page.on("response", async response => {
    const url = new URL(response.url());
    if (url.pathname !== "/api/workstation/candles" || url.searchParams.get("symbol") !== trade.symbol || url.searchParams.get("timeframe") !== "1h") return;
    requested.push({ from: Number(url.searchParams.get("from")), to: Number(url.searchParams.get("to")) });
    const cache = (await response.json().catch(() => null))?.metadata?.cache;
    if (cache && !cache.missing.length && !cache.refresh.length) completeFrom = Math.min(completeFrom, cache.effectiveRange.from);
  });
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(trade.id)}`);
  const chart = page.locator('[data-chart-id="chart-1"]');
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/, { timeout: 60000 });
  const viewport = { from: await chart.getAttribute("data-visible-from"), to: await chart.getAttribute("data-visible-to") };
  const initial = initialHistoryRange(trade, "1h"), wanted = preloadHistoryRange(trade, "1h");
  expect(requested[0]).toEqual(initial);
  await expect.poll(() => completeFrom, { timeout: 90000 }).toBeLessThanOrEqual(wanted.from);
  await expect(chart.locator(".ws-history-progress")).toHaveCount(0);
  await expect(chart).toHaveAttribute("data-visible-from", viewport.from!);
  await expect(chart).toHaveAttribute("data-visible-to", viewport.to!);
  expect(requested.every(r => r.to - r.from <= 14 * 86400)).toBe(true);
  await page.waitForTimeout(1600);
  requested.length = 0;
  await page.reload();
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  await expect(chart.locator(".ws-history-progress")).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every(r => r.from === Number(viewport.from) && r.to === Number(viewport.to))).toBe(true);
  await expect(chart).toHaveAttribute("data-visible-from", viewport.from!);
  await expect(chart).toHaveAttribute("data-visible-to", viewport.to!);
});
