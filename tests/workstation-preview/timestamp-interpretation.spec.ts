import { expect, test, type Page } from "@playwright/test";
const key = "execution-lab:workstation:preferences:demo:v1";
async function open(page: Page, original = false) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(`/preview/trades?scenario=execution-timing${original ? "&interpretation=original" : ""}`);
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-visible-from", /\d+/);
  return { errors, requests };
}
async function sellDetails(page: Page) {
  await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  await page.locator(".ws-diagnostic-list").getByRole("button", { name: /SELL 6 @ 1008.71/ }).click();
  return page.getByRole("dialog", { name: "Execution details", exact: true });
}
test("confirmed MU timing, sessions, replay and exported chart use the same execution time", async ({ page }) => {
  const { errors, requests } = await open(page);
  await expect(page.getByLabel("Chart session")).toHaveValue("auto");
  const details = await sellDetails(page);
  await expect(details).toContainText("2026-09-08 19:09:25 UTC");
  await expect(details).toContainText("2026-09-08 15:09:25 UTC");
  await expect(details).toContainText("2026-09-08 19:05:00 UTC");
  await expect(details).toContainText("Matching time bucket and price");
  await expect(details).toContainText("user-confirmed");
  await page.getByLabel("Close execution details").click();
  await page.getByLabel("Chart session").selectOption("regular");
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  await expect(page.locator(".ws-diagnostic-list").getByRole("button", { name: /BUY 4 @ 978.50/ })).toContainText("Missing candle");
  await page.keyboard.press("Escape");
  await page.getByLabel("Chart session").selectOption("extended");
  await page.reload(); await expect(page.getByLabel("Chart session")).toHaveValue("extended");
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
  const png = await download;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  await png.saveAs("screenshots/timestamp-interpretation/corrected-chart-export.png");
  await page.getByLabel("Close dialog", { exact: true }).click();
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  await expect(page.locator(".ws-diagnostic-list").getByRole("button", { name: /SELL 6 @ 1008.71/ })).toHaveCount(0);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});
test("before/after screenshots retain the real fill price", async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem(k, JSON.stringify({ list: false, journal: false, bottomCollapsed: true, panels: [{ id: "chart-1", interval: "5m" }], chartSession: "extended" })), key);
  await open(page, true);
  const before = await sellDetails(page); await expect(before).toContainText("Price outside candle");
  await page.screenshot({ path: "screenshots/timestamp-interpretation/before-dark.png" });
  await page.goto("/preview/trades?scenario=execution-timing");
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  const after = await sellDetails(page); await expect(after).toContainText("Matching time bucket and price");
  await page.screenshot({ path: "screenshots/timestamp-interpretation/after-dark.png" });
});
test("timestamp controls fit desktop, laptop and mobile in both themes", async ({ page }) => {
  await open(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => { localStorage.setItem("execution-lab:appearance:demo:v1", value); window.dispatchEvent(new Event("execution-lab-appearance-change")); }, theme);
    for (const [size, width, height] of [["desktop", 1920, 1080], ["laptop", 1366, 768], ["mobile", 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await expect(page.getByLabel("Chart session")).toBeVisible();
      if (size === "mobile") expect((await page.getByLabel("Chart session").boundingBox())!.width).toBeGreaterThanOrEqual(160);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `screenshots/timestamp-interpretation/${size}-${theme}.png` });
    }
  }
});
