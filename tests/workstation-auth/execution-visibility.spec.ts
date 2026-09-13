import { expect, test, type BrowserContext } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { previewAccountTimePolicy, saveAccountTimePolicy, prepareAccountTimePolicies } from "../../src/lib/server/execution-time-policy";
import { mkdirSync } from "node:fs";
const id = "DEMO-NVDA-TIMING-V2", url = `/trades?account=DEMO-WORKSTATION&symbol=NVDA&groupKey=${id}`;
const sec = (s: string) => Date.parse(s) / 1000;
async function login(context: BrowserContext) { const csrf = await (await context.request.get("/api/auth/csrf")).json(); await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true", callbackUrl: "http://127.0.0.1:3101/trades" } }); }
test.beforeAll(async () => {
  const account = await prisma.account.findUniqueOrThrow({ where: { ibkrAccount: "DEMO-WORKSTATION" } });
  const preview = await previewAccountTimePolicy(account.id); if (!preview.active) await saveAccountTimePolicy(account.id, preview.revision, true, preview.fingerprint); await prepareAccountTimePolicies(100, account.id);
  mkdirSync("screenshots/execution-markers-all-timeframes", { recursive: true });
});
test.beforeEach(async ({ page, context }) => {
  await login(context); const prefs = { ...defaultPreferences(), list: false, journal: false, heading: false, bottomCollapsed: true };
  const view = { version: 1, arrangement: "left", panels: prefs.panels.map((p, i) => ({ ...p, session: "regular", range: i === 0 ? { from: sec("2026-08-12T15:45Z"), to: sec("2026-08-13T17:10Z") } : i === 1 ? { from: sec("2026-08-11T16:00Z"), to: sec("2026-08-20T14:00Z") } : { from: sec("2026-07-31T04:00Z"), to: sec("2026-08-27T04:00Z") } })) };
  await prisma.workstationTradeView.upsert({ where: { groupKey: id }, create: { groupKey: id, version: 1, revision: 1, view }, update: { view, revision: { increment: 1 } } });
  await page.addInitScript(p => { localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(p)); localStorage.setItem("execution-lab:backup-reminder:snoozed:v1", String(Date.now())); }, prefs);
});
test.afterAll(async () => { await prisma.$disconnect(); });
test("restored ranges show 5/7, 7/7 and 7/7; fit, intervals, labels, fullscreen and exports retain all fills", async ({ page }) => {
  test.setTimeout(150000); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(url);
  const charts = page.locator("[data-chart-id]");
  await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "5", { timeout: 30000 });
  await expect(charts.nth(1)).toHaveAttribute("data-visible-executions", "7", { timeout: 30000 }); await expect(charts.nth(2)).toHaveAttribute("data-visible-executions", "7");
  await page.screenshot({ path: "screenshots/execution-markers-all-timeframes/after-laptop-dark.png" });
  await page.getByRole("button", { name: "Execution visibility chart-1", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Execution visibility details chart-1" }); await expect(details).toContainText("2 outside view");
  await details.getByRole("button", { name: "Show execution 6", exact: true }).click();
  await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "2", { timeout: 30000 });
  await expect(page.getByRole("dialog", { name: "Execution details" })).toContainText("2026-08-18 13:30:05 UTC"); await page.getByRole("button", { name: "Close execution details" }).click();
  await page.getByRole("button", { name: "Fit all charts to trade", exact: true }).click();
  for (const interval of ["5m", "10m", "15m", "1h", "1d", "1wk"]) {
    await page.getByLabel("Timeframe chart-1", { exact: true }).selectOption(interval);
    await expect(charts.nth(0)).toHaveAttribute("data-history-interval", interval);
    await page.getByRole("button", { name: "Fit trade chart-1", exact: true }).click();
    await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "7", { timeout: 30000 });
  }
  await page.getByLabel("Timeframe chart-1", { exact: true }).selectOption("5m"); await expect(charts.nth(0)).toHaveAttribute("data-history-interval", "5m"); await page.getByRole("button", { name: "Fit trade chart-1", exact: true }).click(); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "7");
  await page.getByRole("button", { name: "Hide execution labels", exact: true }).click(); await expect(charts.nth(0)).toHaveAttribute("data-label-mode", "compact"); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "7");
  await page.getByRole("button", { name: "Show execution labels", exact: true }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click(); await expect(charts.nth(0)).toHaveClass(/ws-chart-fullscreen/); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "7");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export chart-1", exact: true }).click(); await page.getByRole("button", { name: "Active chart PNG", exact: true }).click(); await (await download).saveAs("screenshots/execution-markers-all-timeframes/nvda-chart-export.png");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click(); await page.reload(); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "7"); expect(errors).toEqual([]);
});
test("themes, mobile, resize and replay keep visibility diagnostics usable", async ({ page }) => {
  test.setTimeout(90000); await page.goto(url); const charts = page.locator("[data-chart-id]"); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "5");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => { localStorage.setItem("execution-lab:appearance:application:v1", theme); window.dispatchEvent(new Event("execution-lab-appearance-change")); }, theme);
    for (const [size, width, height] of [["desktop",1920,1080],["laptop",1440,900],["mobile",390,844]] as const) {
      await page.setViewportSize({ width, height }); await expect(charts.nth(0)).toHaveAttribute("data-visible-executions", "5"); await page.screenshot({ path: `screenshots/execution-markers-all-timeframes/${size}-${theme}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await expect(page.getByRole("button", { name: "Execution visibility chart-1", exact: true })).not.toContainText("/7");
  await page.getByRole("button", { name: "Execution visibility chart-1", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Execution visibility details chart-1" })).not.toContainText("220.01");
});
