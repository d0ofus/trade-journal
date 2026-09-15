import { expect, test, type Locator, type Page } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { readFileSync } from "node:fs";

const key = "execution-lab:workstation:preferences:demo:v1";
async function open(page: Page, count = 1, timing = true) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ key, count, prefs }) => {
    localStorage.setItem(key, JSON.stringify({ ...prefs, list: true, journal: false, bottomCollapsed: true, chartSession: "extended", panels: ["5m", "1h", "1d", "1wk"].slice(0, count).map((interval, i) => ({ id: `chart-${i + 1}`, interval })) }));
    const original = CanvasRenderingContext2D.prototype.fillRect;
    (window as unknown as { sessionPaints: number }).sessionPaints = 0;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      if (this.fillStyle === "#171e2b" || this.fillStyle === "#f2f5fa") (window as unknown as { sessionPaints: number }).sessionPaints++;
      return original.apply(this, args);
    };
  }, { key, count, prefs: defaultPreferences() });
  await page.goto(timing ? "/preview/trades?scenario=execution-timing" : "/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(count);
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  return { errors, requests };
}

async function shadePixels(chart: Locator, light = false) {
  return chart.locator(".ws-chart-canvas canvas").first().evaluate((canvas: HTMLCanvasElement, light) => {
    const color = light ? [242, 245, 250] : [23, 30, 43];
    const ctx = canvas.getContext("2d")!, data = ctx.getImageData(0, Math.floor(canvas.height * .3), canvas.width, 1).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === color[0] && data[i+1] === color[1] && data[i+2] === color[2]) count++;
    return count;
  }, light);
}

for (const count of [1, 2, 3, 4]) test(`${count} panels shade intraday sessions beneath candles without pointer repaints`, async ({ page }) => {
  const { errors, requests } = await open(page, count);
  const charts = page.locator(".ws-chart");
  for (let i = 0; i < count; i++) {
    await expect(charts.nth(i).locator(".ws-session-legend")).toHaveCount(i < 2 ? 1 : 0);
    if (i < 2) await expect.poll(() => shadePixels(charts.nth(i))).toBeGreaterThan(10);
    else expect(await shadePixels(charts.nth(i))).toBe(0);
  }
  await page.waitForTimeout(350);
  const paints = await page.evaluate(() => (window as unknown as { sessionPaints: number }).sessionPaints);
  const box = (await charts.first().locator(".ws-chart-canvas").boundingBox())!;
  for (let i = 1; i < 12; i++) await page.mouse.move(box.x + (box.width - 70) * i / 12, box.y + box.height * .4);
  expect(await page.evaluate(() => (window as unknown as { sessionPaints: number }).sessionPaints)).toBe(paints);
  await page.mouse.move(0, 0);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("shading follows theme, fullscreen, resizing, session changes, replay and export", async ({ page }) => {
  const { errors, requests } = await open(page);
  const chart = page.locator(".ws-chart").first();
  await expect.poll(() => shadePixels(chart)).toBeGreaterThan(10);
  await page.evaluate(() => { localStorage.setItem("execution-lab:appearance:demo:v1", "light"); window.dispatchEvent(new Event("execution-lab-appearance-change")); });
  await expect.poll(() => shadePixels(chart, true)).toBeGreaterThan(10);
  await page.setViewportSize({ width: 1366, height: 900 });
  const focus = chart.getByRole("button", { name: "Focus chart-1", exact: true });
  await focus.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".ws-chart-fullscreen")).toBeVisible();
  await expect.poll(() => shadePixels(chart, true)).toBeGreaterThan(10);
  await page.keyboard.press("Escape");
  await page.getByLabel("Chart session").selectOption("regular");
  await expect(chart.locator(".ws-session-legend")).toHaveCount(0);
  await expect.poll(() => shadePixels(chart, true)).toBe(0);
  await page.getByLabel("Chart session").selectOption("extended");
  await expect.poll(() => shadePixels(chart, true)).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Light background").check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "All charts PNG", exact: true }).click();
  const png = await download, path = (await png.path())!;
  const found = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 242 && pixels[i+1] === 245 && pixels[i+2] === 250) count++;
    return count;
  }, `data:image/png;base64,${readFileSync(path).toString("base64")}`);
  expect(found).toBeGreaterThan(100);
  await png.saveAs("artifacts/trade-display/extended-hours-export.png");
  await page.getByLabel("Close dialog", { exact: true }).click();
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await expect(chart.locator(".ws-session-legend")).toBeVisible();
  await page.screenshot({ path: "artifacts/trade-display/extended-hours-light.png" });
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("execution time is prominent and technical details open by keyboard and reset per fill", async ({ page }) => {
  const { errors, requests } = await open(page);
  const inspect = async (name: RegExp) => {
    await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
    await page.locator(".ws-diagnostic-list").getByRole("button", { name }).click();
  };
  await inspect(/SELL 6 @ 1008.71/);
  const details = page.getByRole("dialog", { name: "Execution details", exact: true });
  await expect(details.locator(".ws-execution-time")).toContainText("Sep 08, 2026, 15:09:25 EDT");
  await expect(details.locator(".ws-execution-time")).toContainText("2026-09-08 19:09:25 UTC");
  const raw = details.getByText("2026-09-08 15:09:25 UTC", { exact: true });
  await expect(raw).toBeHidden();
  await details.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(raw).toBeVisible();
  await expect(details).toContainText("Raw database timestamp");
  await page.screenshot({ path: "artifacts/trade-display/execution-details.png" });
  await page.getByLabel("Close execution details").click();
  await inspect(/BUY 4 @ 978.50/);
  await expect(details.locator("details")).not.toHaveAttribute("open", "");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("trade cards show peak cost beside shares, wrap on mobile and mask replay", async ({ page }) => {
  const { errors, requests } = await open(page, 1, false);
  const cards = page.locator(".ws-trade-card");
  const nvda = cards.filter({ hasText: "NVDA" });
  await expect(nvda.locator(".ws-trade-size")).toContainText("200 shares · Max $34,840.00");
  await expect(cards.filter({ hasText: "TSLA" }).locator(".ws-peak-cost")).toContainText("Max $27,984.00");
  await expect(nvda.locator(".ws-peak-cost")).toHaveAttribute("title", "Maximum entry cost of the position held at one time, excluding fees.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show trade list", exact: true }).first().click();
  await expect(nvda.locator(".ws-peak-cost")).toBeVisible();
  expect(await nvda.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/trade-display/peak-cost-mobile.png" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  for (const value of await cards.locator(".ws-peak-cost").all()) await expect(value).toHaveText("Max —");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});
