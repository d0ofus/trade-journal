import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  await context.route("**/api/**", route => route.request().method() !== "GET" || /candles|market-metrics|market-context|notion/.test(route.request().url()) ? route.abort() : route.continue());
  await context.addInitScript(() => localStorage.setItem("execution-lab:appearance:application:v1", "dark"));
});

test("retains the full inventory and control state without requests when tabs or theme change", async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/dashboard?preset=ytd");
  await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("189");
  await expect(page.locator('[data-testid^="dashboard-card-"]')).toHaveCount(24);
  await expect(page.locator('[data-chart-title]')).toHaveCount(8);
  await expect(page.locator('.dashboard-breakdowns table')).toHaveCount(4);
  await page.getByText("Metric definitions and data coverage", { exact: true }).click();
  await expect(page.getByText(/Sharpe, Sortino and Calmar: unavailable/)).toBeVisible();
  await page.locator('input[name="from"]').fill("2026-02-03");
  await page.waitForTimeout(1500);
  page.on("request", r => { if (/\/dashboard|candles|market-metrics/.test(r.url())) requests.push(r.url()); });
  await page.getByRole("tab", { name: "Entry timing" }).click();
  await page.getByLabel("Entry heatmap metric").selectOption("count");
  await page.getByRole("tab", { name: "Breakdowns" }).click();
  await expect(page.getByRole("heading", { name: "Holding duration breakdown" })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Entry heatmap metric")).toHaveValue("count");
  await expect(page.locator('input[name="from"]')).toHaveValue("2026-02-03");
  await page.getByRole("tab", { name: "Performance" }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".application-shell")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("dashboard-card-net-range")).toContainText("19,128.79");
  expect(requests).toEqual([]); expect(errors).toEqual([]);
  await page.getByRole("tab", { name: "Performance" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Entry timing" })).toBeFocused();
  await expect(page.getByLabel("Entry heatmap metric")).toHaveValue("count");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/preset=custom.*tab=timing/);
  await expect(page.locator('input[name="from"]')).toHaveValue("2026-02-03");
  await expect(page.getByRole("tab", { name: "Entry timing" })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Entry timing" })).toHaveAttribute("aria-selected", "true");
});

test("all date presets preserve the active tab and existing account scope", async ({ page }) => {
  await page.goto("/dashboard?preset=ytd&tab=breakdowns");
  for (const [label, preset] of [["All Time", "all"], ["Past 3 Months", "3m"], ["Past 6 Months", "6m"], ["YTD", "ytd"]]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`preset=${preset}&tab=breakdowns`));
    await expect(page.getByRole("tab", { name: "Breakdowns" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Reporting account").locator("option")).toHaveCount(2);
    await expect(page.getByLabel("Reporting account").locator("option:disabled")).toHaveCount(1);
  }
  await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("189");
});

for (const theme of ["dark", "light"] as const) for (const mobile of [false, true]) {
  test(`${theme} ${mobile ? "mobile" : "desktop"} panels, charts and heatmap are readable`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard?preset=ytd");
    await expect(page.getByTestId("dashboard-card-total-trades")).toContainText("189");
    if (theme === "light") {
      if (mobile) await page.getByLabel("Open navigation").click();
      await page.getByRole("button", { name: "Appearance", exact: true }).click();
      if (mobile) await page.getByLabel("Close navigation").click();
    }
    await expect(page.locator(".application-shell")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `test-results/dashboard-rehearsal/redesign-${theme}-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
    if (!mobile) {
      await page.locator('[data-chart-title="Cumulative Net P&L"] .recharts-surface').hover({ position: { x: 220, y: 130 } });
      await expect(page.locator('.recharts-tooltip-wrapper').filter({ visible: true }).first()).toBeVisible();
    }
    await page.getByRole("tab", { name: "Entry timing" }).click();
    for (const metric of ["pnl", "expectancy", "winRate", "count"]) { await page.getByLabel("Entry heatmap metric").selectOption(metric); await expect(page.locator('a[href*="entryWeekday="]').first()).toBeVisible(); }
    await page.screenshot({ path: `test-results/dashboard-rehearsal/heatmap-${theme}-${mobile ? "mobile" : "desktop"}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
