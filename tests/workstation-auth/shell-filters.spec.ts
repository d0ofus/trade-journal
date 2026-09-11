import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

let groupKey: string;
let symbol: string;
const endpoint = () => `/api/closed-trades/${encodeURIComponent(groupKey)}/workstation`;
async function login(context: BrowserContext) {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true", callbackUrl: "http://127.0.0.1:3101/trades" } });
}
async function open(page: Page) { await page.goto(`/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(groupKey)}`); await expect(page.getByPlaceholder("What will you repeat or change?")).toBeVisible(); }
test.beforeAll(async () => { const trade = await prisma.closedTrade.findFirstOrThrow({ where: { account: { ibkrAccount: "DEMO-WORKSTATION" }, isStale: false }, orderBy: { closeTime: "desc" } }); groupKey = trade.groupKey; symbol = trade.symbol; });
test.afterAll(() => prisma.$disconnect());

test("all application routes use one functional navigation rail while only workstation content follows its theme", async ({ page, context }) => {
  await login(context); await open(page);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("link")).toHaveCount(7);
  await expect(page.locator(".ws-rail")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  for (const name of ["Dashboard", "Positions", "Calendar", "Import", "Settings", "Journal", "Trades"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".app-navigation")).toHaveCount(1);
  }
  await open(page);
  await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  await page.screenshot({ path: "screenshots/workstation-shell-filters/authenticated-desktop-dark.png" });
  const geometry = await page.evaluate(() => ({ content: document.querySelector(".application-content")!.getBoundingClientRect(), body: document.body.scrollHeight, viewport: innerHeight, scheme: getComputedStyle(document.querySelector('input[name="from"]')!).colorScheme }));
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.scheme).toBe("dark");
  await page.getByTitle("Appearance", { exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator(".application-shell")).toHaveAttribute("data-theme", "light");
  expect(await page.locator(".application-content").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(245, 247, 251)");
  await nav.getByRole("link", { name: "Trades", exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
});

test("Apply waits for an in-flight review save and empty results retain usable filters without empty-ID requests", async ({ page, context }) => {
  await login(context); await open(page);
  const errors: string[] = [], invalidRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/closed-trades\/(?:undefined|null|%20)?\/workstation/.test(request.url())) invalidRequests.push(request.url()); });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const patchStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route(`**${endpoint()}`, async route => { if (route.request().method() === "PATCH") { started(); await gate; } await route.continue(); });
  const takeaway = "Save completes before changing server filters";
  await page.getByPlaceholder("What will you repeat or change?").fill(takeaway);
  await patchStarted;
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  const form = page.getByTestId("trade-filters");
  await form.getByRole("textbox", { name: "Symbol", exact: true }).fill("MISSING");
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(form.getByRole("button", { name: "Applying…", exact: true })).toBeDisabled();
  expect(new URL(page.url()).searchParams.has("symbol")).toBe(false);
  release();
  await expect(page.getByRole("heading", { name: "No trades match these filters" })).toBeVisible();
  expect((await (await context.request.get(endpoint())).json()).review.takeaway).toBe(takeaway);
  await page.screenshot({ path: "screenshots/workstation-shell-filters/authenticated-empty-results.png" });
  await form.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".ws-trade-title h2")).toContainText(symbol);
  expect(errors).toEqual([]); expect(invalidRequests).toEqual([]);
});

test("conflicting drafts block filters and sign out while preserving the active review", async ({ page, context }) => {
  await login(context); await open(page);
  const saved = await (await context.request.get(endpoint())).json();
  const winner = await context.request.patch(endpoint(), { data: { expectedRevision: saved.revision, document: { ...saved, review: { ...saved.review, takeaway: "Competing tab wins" } } } });
  expect(winner.status()).toBe(200);
  await page.getByPlaceholder("What will you repeat or change?").fill("Preserve this conflicting draft");
  await expect(page.locator(".ws-journal-save")).toContainText("Save paused");
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  const form = page.getByTestId("trade-filters");
  await form.getByRole("textbox", { name: "Symbol", exact: true }).fill("MISSING");
  await form.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Resolve the review save issue");
  expect(new URL(page.url()).searchParams.has("symbol")).toBe(false);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".app-navigation-message")).toContainText("draft is preserved");
  await expect(page.getByPlaceholder("What will you repeat or change?")).toHaveValue("Preserve this conflicting draft");
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe("phase2-reviewer");
});
