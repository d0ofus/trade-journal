import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  // Restored genuine records are read-only in this browser rehearsal.
  await context.route("**/api/**", route => route.request().method() !== "GET" || /candles|market-metrics|market-context|notion/.test(route.request().url()) ? route.abort() : route.continue());
});

test("YTD cards, zero chart baselines, account scope, heatmap and drilldowns reconcile", async ({ page }) => {
  const requests: string[] = [], errors: string[] = [];
  page.on("request", r => { if (/candles|market-metrics/.test(r.url())) requests.push(r.url()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/dashboard?preset=ytd");
  await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("189");
  await expect(page.getByTestId("dashboard-card-gross-range")).toContainText("18,463.51");
  await expect(page.getByTestId("dashboard-card-net-range")).toContainText("19,128.79");
  await expect(page.getByTestId("dashboard-card-commissions")).toContainText("665.28");
  const gross = page.getByTestId("dashboard-chart-gross-cumulative-pnl"), net = page.getByTestId("dashboard-chart-net-cumulative-pnl");
  await expect(gross).toHaveAttribute("data-first-value", "0.00");
  await expect(gross).toHaveAttribute("data-last-value", "-18463.51");
  await expect(net).toHaveAttribute("data-first-value", "0.00");
  await expect(net).toHaveAttribute("data-last-value", "-19128.79");
  const accounts = page.getByRole("combobox", { name: "Reporting account" });
  await expect(accounts.locator("option")).toHaveCount(2);
  await expect(accounts.locator("option:disabled")).toHaveCount(1);
  expect(requests).toEqual([]);
  await page.waitForTimeout(1500); // Let Recharts finish its initial line animation before visual capture.
  await page.screenshot({ path: "test-results/dashboard-rehearsal/dashboard-desktop.png" });
  await gross.screenshot({ path: "test-results/dashboard-rehearsal/gross-ytd.png" });
  await page.getByRole("tab", { name: "Entry timing" }).click();
  await page.getByRole("combobox", { name: "Entry heatmap metric" }).selectOption("count");
  const cell = page.locator('a[href*="entryWeekday="]').first();
  const count = Number((await cell.getAttribute("title"))!.match(/^\d+/)![0]);
  const href = (await cell.getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByLabel("Matching trade count", { exact: true })).toHaveText(String(count));
  await expect(page.getByText(/Closing dates: America\/New_York/)).toBeVisible();
  await page.goto("/dashboard?preset=ytd");
  await page.getByRole("link", { name: "Review matching trades" }).click();
  await expect(page.getByLabel("Matching trade count", { exact: true })).toHaveText("189");
  expect(errors).toEqual([]);
});

test("dated positions contain only the two genuine accounts and the five current scoped holdings", async ({ page }) => {
  await page.goto("/positions");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await expect(page.locator("tbody")).toContainText("AMD");
  await expect(page.locator("tbody")).toContainText("IBIT");
  await expect(page.locator("tbody")).toContainText("2026-09-25");
  await expect(page.locator("body")).not.toContainText("DEMO-");
  await page.getByRole("button", { name: "All (7)", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(7);
  await expect(page.locator("tbody")).toContainText("INDA");
  await page.screenshot({ path: "test-results/dashboard-rehearsal/positions.png" });
});

test("empty cohorts and mobile dashboard remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard?preset=custom&from=2030-01-01&to=2030-01-02");
  await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("0");
  await expect(page.getByTestId("dashboard-card-expectancy")).toContainText("Unavailable");
  await page.getByRole("tab", { name: "Entry timing" }).click();
  await expect(page.getByText("No known entry times in range.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/dashboard-rehearsal/dashboard-mobile.png" });
});
