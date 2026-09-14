import { expect, test } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { observePngExport } from "../workstation-png";

const key = "execution-lab:workstation:preferences:demo:v1";

for (const count of [2, 3, 4]) test(`${count} chart slots retain independent labels through navigation, layout and reload`, async ({ page }) => {
  await page.addInitScript(({ key, prefs }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(prefs)); }, { key, prefs: defaultPreferences() });
  await page.route("**/api/**", route => route.abort());
  await page.goto("/preview/trades");
  await page.getByLabel("Number of charts", { exact: true }).selectOption(String(count));
  const charts = page.locator(".ws-chart");
  await expect(charts).toHaveCount(count);
  const first = page.locator('[data-chart-id="chart-1"]'), second = page.locator('[data-chart-id="chart-2"]');
  await expect(first).toHaveAttribute("data-visible-bars", /[1-9]/);
  const original = await first.getAttribute("data-visible-from");
  await first.getByRole("button", { name: "Hide execution labels chart-1", exact: true }).click();
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await expect(second).toHaveAttribute("data-label-mode", "labels");
  await expect(first).toHaveAttribute("data-visible-from", original!);
  await second.getByRole("button", { name: "Focus chart-2", exact: true }).click();
  await second.getByRole("button", { name: "Hide execution labels chart-2", exact: true }).click();
  await second.getByRole("button", { name: "Focus chart-2", exact: true }).click();
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await expect(second).toHaveAttribute("data-label-mode", "compact");
  if (count > 2) await expect(charts.nth(2)).toHaveAttribute("data-label-mode", "labels");
  await page.getByLabel("Timeframe chart-2", { exact: true }).selectOption("1d");
  await page.getByRole("button", { name: "Show execution labels", exact: true }).click();
  await expect(second).toHaveAttribute("data-label-mode", "labels");
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await page.getByLabel("Number of charts", { exact: true }).selectOption("1");
  await page.getByLabel("Number of charts", { exact: true }).selectOption(String(count));
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await page.reload();
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await expect(second).toHaveAttribute("data-label-mode", "labels");
  await page.locator(".ws-trade-card-main").nth(1).click();
  await expect(first).toHaveAttribute("data-label-mode", "compact");
  await expect(second).toHaveAttribute("data-label-mode", "labels");
  const exportedPng = await observePngExport(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "All charts PNG", exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/\.png$/);
  const png = await exportedPng();
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  await test.info().attach("per-slot-labels", { body: png, contentType: "image/png" });
});

test("legacy hidden labels migrate to all slots and controls change only the selected slot", async ({ page }) => {
  await page.addInitScript(({ key, prefs }) => localStorage.setItem(key, JSON.stringify(prefs)), { key, prefs: { ...defaultPreferences(), labels: "hidden" } });
  await page.goto("/preview/trades");
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-label-mode", "hidden");
  await page.getByRole("button", { name: "Show execution labels chart-2", exact: true }).click();
  await expect(page.locator('[data-chart-id="chart-2"]')).toHaveAttribute("data-label-mode", "labels");
  await expect(page.locator('[data-chart-id="chart-1"]')).toHaveAttribute("data-label-mode", "hidden");
});
