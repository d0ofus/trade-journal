import { expect, test, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { prisma } from "../../src/lib/prisma";
import snapshot from "../../src/lib/workstation/timing-candles.json";
import { aggregateCandles } from "../../src/lib/workstation/math";
import type { Interval } from "../../src/lib/workstation/types";
const batchId = "DEMO-TIMESTAMP-PREVIEW", endpoint = "/api/workstation/timestamp-interpretations";
async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true", callbackUrl: "http://127.0.0.1:3101/settings" } });
}
async function clearAccountPolicy(accountId: string) {
  await prisma.executionTimePolicyApplication.deleteMany({ where: { policy: { accountId } } });
  await prisma.accountExecutionTimePolicy.deleteMany({ where: { accountId } });
}
test.beforeAll(() => { execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-timestamp-preview.ts"], { env: process.env, stdio: "pipe" }); });
test.afterAll(async () => {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (batch?.accountId) await clearAccountPolicy(batch.accountId);
  const links = await prisma.journalLink.findMany({ where: { targetId: batchId, targetType: "CLOSED_TRADE" } });
  await prisma.journalEntry.deleteMany({ where: { id: { in: links.map(l => l.journalEntryId) } } });
  await prisma.closedTradeNote.deleteMany({ where: { groupKey: batchId } });
  await prisma.closedTrade.deleteMany({ where: { groupKey: batchId } });
  await prisma.execution.deleteMany({ where: { importBatchId: batchId } });
  await prisma.importBatch.deleteMany({ where: { id: batchId } });
  await prisma.instrument.deleteMany({ where: { id: batchId } });
  if (batch?.rawStorageKey) await prisma.importArtifact.deleteMany({ where: { storageKey: batch.rawStorageKey } });
  await prisma.$disconnect();
});

test("Account confirmation plots legacy Flex executions like MU and removes stale timing warnings", async ({ page, context }) => {
  test.setTimeout(90000);
  await login(context);
  await prisma.executionTimeInterpretation.deleteMany({ where: { importBatchId: batchId } });
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  await prisma.importBatch.update({ where: { id: batchId }, data: { rawStorageKey: null, rawSha256: null, parserVersion: null } });
  const records = await prisma.execution.findMany({ where: { importBatchId: batchId }, orderBy: { id: "asc" } });
  try {
    await page.goto("/settings#timestamp-interpretation");
    const settings = page.getByRole("region", { name: "Account timestamp defaults", exact: true });
    await settings.getByLabel("Account timestamp mode").selectOption("confirmed-flex-new-york");
    const account = settings.getByText("DEMO-WORKSTATION", { exact: true }).locator("../..");
    await account.getByRole("button", { name: "Preview account", exact: true }).click();
    await expect(settings).toContainText("user-confirmed");
    await settings.getByRole("button", { name: "Confirm New York time for this account’s Flex imports", exact: true }).click();
    await expect(settings.getByRole("status")).toContainText("Account policy saved");
    await account.getByRole("button", { name: "Resume preparation", exact: true }).click();
    await expect(account).toContainText("1 user-confirmed");
    await page.route("**/api/workstation/candles?**", async route => {
      const url = new URL(route.request().url()), interval = url.searchParams.get("timeframe") as Interval;
      const candles = aggregateCandles(snapshot.candles, interval).filter(c => c.time >= Number(url.searchParams.get("from")) && c.time <= Number(url.searchParams.get("to")));
      await route.fulfill({ json: { candles, source: "Frozen bars", metadata: { warnings: [], session: { timezone: "America/New_York", calendar: "exchange", marketHours: "extended" } } } });
    });
    await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${batchId}`);
    await expect(page.locator(".ws-chart-state")).toHaveCount(0);
    await expect(page.getByLabel("Chart session")).toContainText("Auto (extended)");
    await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
    await page.locator(".ws-diagnostic-list").getByRole("button", { name: /SELL 6 @ 1008.71/ }).click();
    const details = page.getByRole("dialog", { name: "Execution details", exact: true });
    await expect(details).toContainText("New York time — user-confirmed");
    await expect(details).toContainText("2026-09-08 19:09:25 UTC");
    await expect(details).not.toContainText("no longer matches its source");
    expect(await prisma.execution.findMany({ where: { importBatchId: batchId }, orderBy: { id: "asc" } })).toEqual(records);
  } finally {
    if (batch.accountId) await clearAccountPolicy(batch.accountId);
    await prisma.importBatch.update({ where: { id: batchId }, data: { rawStorageKey: batch.rawStorageKey, rawSha256: batch.rawSha256, parserVersion: batch.parserVersion } });
  }
});
test("Settings confirms and disables a batch while preserving imported records and open review drafts", async ({ page, context }) => {
  test.setTimeout(90000);
  await login(context);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const records = await prisma.execution.findMany({ where: { importBatchId: batchId }, orderBy: { id: "asc" } });
  expect(records).toHaveLength(8);
  const initial = await (await context.request.get(`${endpoint}?batchId=${batchId}`)).json();
  if (initial.active) expect((await context.request.patch(endpoint, { data: { batchId, expectedRevision: initial.revision, action: "disable" } })).ok()).toBe(true);
  const tradePage = await context.newPage();
  await tradePage.route("**/api/workstation/candles?**", async route => {
    const url = new URL(route.request().url()), interval = url.searchParams.get("timeframe") as Interval;
    const candles = aggregateCandles(snapshot.candles, interval).filter(c => c.time >= Number(url.searchParams.get("from")) && c.time <= Number(url.searchParams.get("to")));
    await route.fulfill({ json: { candles, source: "Yahoo snapshot", metadata: { warnings: [], session: { timezone: "America/New_York", calendar: "exchange", marketHours: "extended" } } } });
  });
  await tradePage.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${batchId}`);
  await expect(tradePage.locator(".ws-chart-state")).toHaveCount(0);
  await tradePage.getByPlaceholder("What will you repeat or change?").fill("Keep this review across timezone confirmation.");
  await expect(tradePage.locator(".ws-journal-save")).toContainText("All changes saved");
  const chart = tradePage.locator('[data-chart-id="chart-1"]');
  await expect(chart).toHaveAttribute("data-visible-from", /[0-9]/);
  const viewport = { from: await chart.getAttribute("data-visible-from"), to: await chart.getAttribute("data-visible-to") };
  await page.goto("/settings#timestamp-interpretation");
  const settings = page.getByRole("region", { name: "Timestamp interpretation", exact: true });
  const batch = settings.locator(".border-b").filter({ hasText: "DEMO-timestamp-review.csv" }).filter({ hasText: "8 executions" });
  await batch.getByRole("button", { name: "Preview times", exact: true }).click();
  await expect(settings).toContainText("8 of 8");
  await expect(settings).toContainText("2026-09-08 19:09:25 UTC");
  await settings.getByRole("button", { name: "Confirm this report uses US Eastern", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Imported records are unchanged");
  await page.locator("#timestamp-interpretation").screenshot({ path: "screenshots/timestamp-interpretation/settings-confirmed.png" });
  await tradePage.bringToFront();
  await expect(tradePage.getByLabel("Chart session")).toContainText("Auto (extended)", { timeout: 30000 });
  await expect(chart).toHaveAttribute("data-visible-from", viewport.from!);
  await expect(chart).toHaveAttribute("data-visible-to", viewport.to!);
  await expect(tradePage.getByPlaceholder("What will you repeat or change?")).toHaveValue("Keep this review across timezone confirmation.");
  await tradePage.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  await tradePage.locator(".ws-diagnostic-list").getByRole("button", { name: /SELL 6 @ 1008.71/ }).click();
  await expect(tradePage.getByRole("dialog", { name: "Execution details", exact: true })).toContainText("2026-09-08 19:09:25 UTC");
  await batch.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("Interpretation disabled");
  await tradePage.bringToFront();
  await expect(tradePage.getByLabel("Chart session")).toContainText("Auto (regular)", { timeout: 30000 });
  expect(await prisma.execution.findMany({ where: { importBatchId: batchId }, orderBy: { id: "asc" } })).toEqual(records);
  expect(errors).toEqual([]);
  await tradePage.close();
});
