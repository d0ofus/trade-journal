import { showTakeaways } from "./review-helpers";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.route("**/api/**", route => route.abort());
  await page.goto(`/preview/trades${query}`);
  await expect(page.locator(".workstation")).toBeVisible();
}
const filters = (page: Page) => page.getByTestId("trade-filters");

test("filter drafts survive collapse and Apply changes the selected chart and review together", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  await filters(page).getByRole("textbox", { name: "Symbol", exact: true }).fill("TSLA");
  await page.waitForTimeout(500);
  expect(new URL(page.url()).searchParams.has("symbol")).toBe(false);
  await page.getByRole("button", { name: "Collapse filters", exact: true }).click();
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  await expect(filters(page).getByRole("textbox", { name: "Symbol", exact: true })).toHaveValue("TSLA");
  await page.getByTitle("Collapse trade list", { exact: true }).click();
  await page.getByTitle("Show trade list", { exact: true }).click();
  await expect(filters(page).getByRole("textbox", { name: "Symbol", exact: true })).toHaveValue("TSLA");
  await filters(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page).toHaveURL(/symbol=TSLA/);
  await expect(page.locator(".ws-trade-title h2")).toContainText("TSLA");
  expect(new URL(page.url()).searchParams.get("groupKey")).toBe("demo-tsla");
  await expect(page.locator(".ws-trade-card")).toHaveCount(1);
  await showTakeaways(page);
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).fill("TSLA filtered review");
  await expect(page.locator(".ws-journal-save")).toContainText("Saved on this device");
  await page.reload(); await showTakeaways(page);
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true })).toHaveText("TSLA filtered review");
  await expect(page.locator(".ws-filter-expansion")).toBeVisible();
});

test("date validation, presets, open boundaries and empty-result recovery", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  await filters(page).getByLabel("From", { exact: true }).fill("2026-09-10");
  await filters(page).getByLabel("To", { exact: true }).fill("2026-09-08");
  await filters(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(filters(page).getByRole("alert")).toContainText("on or before");
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);
  await filters(page).getByRole("button", { name: "5D", exact: true }).click();
  await expect(page).toHaveURL(/from=/);
  await filters(page).getByRole("button", { name: "All time", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("from")).toBe(false);
  await filters(page).getByLabel("From", { exact: true }).fill("2026-09-09");
  await filters(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".ws-applied-filters")).toContainText("From 2026-09-09");
  await expect(page.locator(".ws-trade-card")).toHaveCount(2);
  await filters(page).getByRole("textbox", { name: "Symbol", exact: true }).fill("MISSING");
  await filters(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No trades match these filters" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(filters(page)).toBeVisible();
  await filters(page).getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(page.locator(".ws-trade-card")).toHaveCount(6);
});

test("theme and rail preferences preserve chart ranges and provide bounded filter scrolling", async ({ page }) => {
  await open(page);
  const chart = page.locator(".ws-chart").first();
  await expect(chart.locator("canvas").first()).toBeVisible();
  await expect(chart).toHaveAttribute("data-visible-from", /\d+/);
  const range = async () => [await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")];
  const before = await range();
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  await expect(page.locator(".app-navigation")).toHaveClass(/is-expanded/);
  await page.getByRole("button", { name: "Expand filters", exact: true }).click();
  const sizes = await page.evaluate(() => ({ body: document.body.scrollHeight, viewport: innerHeight, panel: document.querySelector(".ws-filter-expansion")!.getBoundingClientRect().height, list: document.querySelector(".ws-trade-list")!.getBoundingClientRect().height }));
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport + 1);
  expect(sizes.panel).toBeLessThanOrEqual(sizes.list / 2 + 1);
  expect(await range()).toEqual(before);
  await page.getByTitle("Appearance", { exact: true }).click();
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await expect(page.locator(".application-shell")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "screenshots/workstation-shell-filters/desktop-light-filters.png" });
  await page.reload(); await showTakeaways(page);
  await expect(page.locator(".workstation")).toHaveClass(/ws-light/);
  await expect(page.locator(".app-navigation")).toHaveClass(/is-expanded/);
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  await page.screenshot({ path: "screenshots/workstation-shell-filters/desktop-dark-filters.png" });
});

test("mobile navigation and trade filters remain accessible with focus return", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeFocused();
  await page.getByTitle("Show trade list", { exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Your trades", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Expand filters", exact: true }).click();
  await filters(page).getByLabel("From", { exact: true }).fill("2026-09-08");
  await page.screenshot({ path: "screenshots/workstation-shell-filters/mobile-light-filters.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByTitle("Show trade list", { exact: true })).toBeFocused();
  await page.getByTitle("Show trade list", { exact: true }).click();
  await expect(filters(page).getByLabel("From", { exact: true })).toHaveValue("2026-09-08");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
