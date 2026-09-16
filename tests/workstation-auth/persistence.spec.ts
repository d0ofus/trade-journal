import { expect, test, BrowserContext, Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";
import { candleFixture } from "./candle-fixture";

// Dedicated test-server login. Never load the application's .env.local in this suite.
const username = "phase2-reviewer", password = "phase2-local-test-only";
let groupKey: string;
let tradeQuantity: number;
const endpoint = () => `/api/closed-trades/${encodeURIComponent(groupKey)}/workstation`;
async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  const result = await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username, password, json: "true", callbackUrl: "http://127.0.0.1:3101/trades" } });
  expect(result.ok()).toBeTruthy();
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe(username);
}
async function revealTakeaways(page: Page) {
  const section = page.locator("summary").filter({ hasText: /^Takeaways$/ });
  if (!await page.getByRole("textbox", { name: "Takeaways", exact: true }).isVisible()) await section.click();
}
async function open(page: Page) {
  await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(groupKey)}`);
  await revealTakeaways(page);
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true })).toBeVisible();
}
test.beforeAll(async () => {
  const trade = await prisma.closedTrade.findFirstOrThrow({ where: { account: { ibkrAccount: "DEMO-WORKSTATION" }, isStale: false }, orderBy: { closeTime: "desc" } });
  groupKey = trade.groupKey;
  tradeQuantity = trade.totalQuantity;
  const executions = await prisma.closedTradeExecution.findMany({ where: { closedTradeGroupKey: groupKey }, orderBy: { sortOrder: "asc" } });
  expect(trade.openTime.toISOString()).toBe(executions[0].executedAt.toISOString());
  expect(trade.closeTime.toISOString()).toBe(executions.at(-1)!.executedAt.toISOString());
});
test.afterAll(() => prisma.$disconnect());
test.beforeEach(async ({ context }) => {
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
});

test("production build protects authenticated routes and keeps preview disabled", async ({ page, context }) => {
  await page.goto("/trades");
  await expect(page).toHaveURL(/\/login/);
  expect((await context.request.get("/preview/trades")).status()).toBe(404);
  const metrics = await context.request.get(`/api/closed-trades/${encodeURIComponent(groupKey)}/market-metrics`, { maxRedirects: 0 });
  expect(metrics.status()).toBe(307);
  expect(metrics.headers().location).toContain("/login");
  await page.getByPlaceholder("Username", { exact: true }).fill(username);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/trades/);
  expect((await context.request.get(endpoint())).status()).toBe(200);
});

test("autosaves to PostgreSQL, reloads drawings and chart evidence, and shares the review with journal", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await login(context); await open(page);
  await expect(page.getByText("QUANTITY", { exact: true }).locator("..").locator("b")).toHaveText(String(tradeQuantity));
  const value = `Authenticated takeaway ${Date.now()}`;
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).fill(value);
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.takeaway).toBe(`<p>${value}</p>`);
  await expect(page.locator(".ws-journal-save").getByText("All changes saved", { exact: true })).toBeVisible();
  const doc = await (await context.request.get(endpoint())).json();
  const drawing = { id: "phase2-measurement", tool: "measure", points: [{ time: 1781789400, price: 100 }, { time: 1781791200, price: 103 }], text: "3% measured move", color: "#a5b4fc", width: 1.5, dashed: false, locked: false, hidden: false, panel: null, createdAt: 1781791200 };
  const update = await context.request.patch(endpoint(), { data: { expectedRevision: doc.revision, document: { ...doc, drawings: [...doc.drawings.filter((d: { id: string }) => d.id !== drawing.id), drawing] } } });
  expect(update.status()).toBe(200);
  await page.reload();
  await revealTakeaways(page);
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true })).toHaveText(value);
  const chart = page.getByRole("region", { name: /chart$/, exact: false }).first();
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/, { timeout: 30000 });
  await page.getByRole("button", { name: /Attach current chart/ }).click();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).evidence.length).toBeGreaterThan(doc.evidence.length);
  const saved = await (await context.request.get(endpoint())).json();
  expect(saved.drawings).toContainEqual(drawing);
  expect(saved.evidence.at(-1).image).toMatch(/^data:image\/png;base64,/);
  await page.goto(`/journal?entryId=${saved.journalEntryId}`);
  await revealTakeaways(page);
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true })).toHaveText(value);
  await page.screenshot({ path: "test-results/workstation-auth/authenticated-review.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("a second tab preserves its conflicting draft across reload and can export it", async ({ page, context }) => {
  await login(context); await open(page);
  const other = await context.newPage(); await open(other);
  const winner = `Saved tab ${Date.now()}`, draft = `Conflicting draft ${Date.now()}`;
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).fill(winner);
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.takeaway).toBe(`<p>${winner}</p>`);
  await other.getByRole("textbox", { name: "Takeaways", exact: true }).fill(draft);
  await expect(other.locator(".ws-journal-save").getByText("Save paused · draft preserved", { exact: true })).toBeVisible();
  await other.reload();
  await revealTakeaways(other);
  await expect(other.getByRole("textbox", { name: "Takeaways", exact: true })).toHaveText(draft);
  await expect(other.locator(".ws-journal-save").getByText("Conflict · draft preserved", { exact: true })).toBeVisible();
  const download = other.waitForEvent("download");
  await other.getByRole("button", { name: "Export draft", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/recovered-draft.json$/);
  await other.getByRole("button", { name: "Reload saved review", exact: true }).click();
  await revealTakeaways(other);
  await expect(other.getByRole("textbox", { name: "Takeaways", exact: true })).toHaveText(winner);
  expect((await (await context.request.get(endpoint())).json()).review.takeaway).toBe(`<p>${winner}</p>`);
});
