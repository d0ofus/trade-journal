import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { emptyDocument } from "../../src/lib/workstation/types";
import { candleFixture } from "./candle-fixture";
import { unavailableMetrics } from "../../src/lib/workstation/market-metrics";

const prefix = `status-browser-${crypto.randomUUID()}`;
const keys = [0, 1, 2].map(i => `demo-account-workstation:${prefix}:${i}`);
const symbols = ["STATUSA", "STATUSB", "STATUSC"];
const instrumentIds: string[] = [];
const endpoint = (index = 2) => `/api/closed-trades/${encodeURIComponent(keys[index])}/workstation`;
const card = (page: Page, index: number) => page.locator(".ws-trade-card").filter({ has: page.locator("strong", { hasText: symbols[index] }) });
const dot = (page: Page, index: number) => card(page, index).locator(".ws-review-dot");
async function open(page: Page) {
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(keys[2])}`);
  await expect(page.getByLabel("Review status", { exact: true })).toBeVisible();
}
async function noteBox(page: Page) {
  const box = page.getByRole("textbox", { name: "Takeaways", exact: true });
  if (!await box.isVisible()) await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  return box;
}
async function typeNote(page: Page, text: string) {
  await (await noteBox(page)).fill(text);
}

test.beforeAll(async () => {
  const account = await prisma.account.findUniqueOrThrow({ where: { ibkrAccount: "DEMO-WORKSTATION" } });
  for (let i = 0; i < keys.length; i++) {
    const instrument = await prisma.instrument.create({ data: { symbol: symbols[i], exchange: prefix, assetType: "STOCK", currency: "USD" } }); instrumentIds.push(instrument.id);
    await prisma.closedTrade.create({ data: { groupKey: keys[i], accountId: account.id, instrumentId: instrument.id, symbol: symbols[i], direction: "LONG", openTime: new Date("2026-09-25T14:00:00Z"), closeTime: new Date("2026-09-25T15:00:00Z"), tradeDate: new Date("2026-09-25"), totalQuantity: 1, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 10, realizedPnl: 10, totalCommission: 0, openingQuantity: 0, closingQuantity: 0 } });
  }
});
test.beforeEach(async ({ context }) => {
  for (let i = 0; i < keys.length; i++) {
    const document = emptyDocument(); document.review.status = (["Reviewed", "In progress", "Not reviewed"] as const)[i];
    const data = { content: "", lesson: "", workstationVersion: 0, workstationJson: JSON.stringify(document) };
    await prisma.closedTradeNote.upsert({ where: { groupKey: keys[i] }, create: { groupKey: keys[i], ...data }, update: data });
  }
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  await context.route("**/market-metrics", route => route.fulfill({ json: unavailableMetrics("STATUS", "USD", "Isolated status test") }));
});
test.afterAll(async () => {
  await prisma.workstationTradeView.deleteMany({ where: { groupKey: { in: keys } } });
  await prisma.journalEntry.deleteMany({ where: { links: { some: { targetType: "CLOSED_TRADE", targetId: { in: keys } } } } });
  await prisma.closedTradeNote.deleteMany({ where: { groupKey: { in: keys } } });
  await prisma.closedTrade.deleteMany({ where: { groupKey: { in: keys } } });
  await prisma.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
  await prisma.$disconnect();
});

test("all rows show their saved status before selection and retain it during navigation", async ({ page }) => {
  await open(page);
  for (const [i, state] of ["reviewed", "in-progress", "not-reviewed"].entries()) await expect(dot(page, i)).toHaveAttribute("data-review-state", state);
  await card(page, 0).locator(".ws-trade-card-main").click();
  await expect(page.getByLabel("Review status", { exact: true })).toHaveValue("Reviewed");
  await card(page, 2).locator(".ws-trade-card-main").click();
  await expect(dot(page, 0)).toHaveAttribute("data-review-state", "reviewed");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "not-reviewed");
  await page.waitForTimeout(1500);
  expect((await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: keys[2] } })).workstationVersion).toBe(0);
  await page.screenshot({ path: "test-results/workstation-auth/review-status-dark.png" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await page.screenshot({ path: "test-results/workstation-auth/review-status-light.png" });
});

test("content auto-starts a draft, manual completion survives save/navigation/reload without chart requests", async ({ page, context }) => {
  await open(page);
  await page.waitForTimeout(1500);
  let requests = 0; page.on("request", request => { if (/candles|market-metrics/.test(request.url())) requests++; });
  await typeNote(page, "First deliberate review content");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "in-progress");
  await expect(dot(page, 2)).toHaveAttribute("data-unsaved", "true");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.status).toBe("In progress");
  await page.getByLabel("Review status", { exact: true }).selectOption("Reviewed");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "reviewed");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.status).toBe("Reviewed");
  await expect(dot(page, 2)).not.toHaveAttribute("data-unsaved", "true");
  await typeNote(page, "Updated completed review");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.takeaway).toContain("Updated completed review");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "reviewed");
  expect(requests).toBe(0);
  await card(page, 1).locator(".ws-trade-card-main").click();
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "reviewed");
  await page.reload();
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "reviewed");
  await card(page, 2).locator(".ws-trade-card-main").click();
  await expect(page.getByLabel("Review status", { exact: true })).toHaveValue("Reviewed");
  await page.getByLabel("Review status", { exact: true }).selectOption("Not reviewed");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.status).toBe("Not reviewed");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "not-reviewed");
});

test("save failures preserve the draft indicator and recovery without false saved status", async ({ page, context }) => {
  await open(page);
  await page.route("**/workstation", route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Temporary save failure" } }) : route.continue());
  await typeNote(page, "Unsent recovery text");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "in-progress");
  await expect(dot(page, 2)).toHaveAttribute("title", /unsaved draft/);
  expect((await (await context.request.get(endpoint())).json()).review.status).toBe("Not reviewed");
  await page.reload();
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "in-progress");
  await expect(dot(page, 2)).toHaveAttribute("data-unsaved", "true");
  await expect(await noteBox(page)).toContainText("Unsent recovery text");
  await page.unroute("**/workstation");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: /^Save & next/ }).click();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.status).toBe("In progress");
  await expect(dot(page, 2)).not.toHaveAttribute("data-unsaved", "true");
});

test("cross-tab changes refresh dots while conflicting editor drafts remain protected", async ({ page, context }) => {
  await open(page);
  const other = await context.newPage(); await open(other);
  await typeNote(page, "Saved by first tab");
  await expect(dot(other, 2)).toHaveAttribute("data-review-state", "in-progress");
  await typeNote(other, "Conflicting second tab draft");
  await expect(dot(other, 2)).toHaveAttribute("title", /unsaved draft/);
  await expect(other.getByRole("button", { name: "Reload saved review", exact: true })).toBeVisible();
  await other.getByRole("button", { name: "Reload saved review", exact: true }).click();
  await expect(await noteBox(other)).toContainText("Saved by first tab");
  await expect(dot(other, 2)).not.toHaveAttribute("data-unsaved", "true");
  await other.close();
});

test("recovering existing content does not automatically initiate a review", async ({ page, context }) => {
  // Keep the recovered draft unsaved while inspecting its status; autosave normally
  // persists recovery within 1.2 seconds, before a slow browser can assert the dot.
  await page.route("**/workstation", route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Hold recovered draft for inspection" } }) : route.continue());
  const document = await (await context.request.get(endpoint())).json();
  document.review.takeaway = "<p>Recovered legacy draft</p>";
  await page.addInitScript(({ key, document }) => localStorage.setItem(key, JSON.stringify(document)), {
    key: `execution-lab:workstation:draft:application:${keys[2]}`, document,
  });
  await open(page);
  await expect(await noteBox(page)).toContainText("Recovered legacy draft");
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "not-reviewed");
  await expect(dot(page, 2)).toHaveAttribute("data-unsaved", "true");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await page.unroute("**/workstation");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: /^Save & next/ }).click();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.takeaway).toContain("Recovered legacy draft");
  expect((await (await context.request.get(endpoint())).json()).review.status).toBe("Not reviewed");
});

test("unreadable status is neutral and a focus refresh observes a subsequent change", async ({ page }) => {
  await prisma.closedTradeNote.update({ where: { groupKey: keys[0] }, data: { workstationJson: "invalid" } });
  await open(page);
  await expect(dot(page, 0)).toHaveAttribute("data-review-state", "unavailable");
  const document = emptyDocument(); document.review.status = "In progress";
  await prisma.closedTradeNote.update({ where: { groupKey: keys[0] }, data: { workstationJson: JSON.stringify(document), workstationVersion: 1 } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dot(page, 0)).toHaveAttribute("data-review-state", "in-progress");
});

test("a delayed status response cannot undo a newer successful save", async ({ page, context }) => {
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/api/workstation/review-statuses", async route => {
    const response = await route.fetch();
    requested(); await gate;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await started;
  await typeNote(page, "A newer saved revision");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.status).toBe("In progress");
  await expect(dot(page, 2)).not.toHaveAttribute("data-unsaved", "true");
  const received = page.waitForResponse("**/api/workstation/review-statuses");
  release(); await received;
  await expect(dot(page, 2)).toHaveAttribute("data-review-state", "in-progress");
});

test("the accounting-pending dashboard state respects shared dark appearance", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText(/Accounting reconciliation is in progress/)).toBeVisible();
  await expect(page.locator(".dashboard-workspace")).toBeVisible();
});
