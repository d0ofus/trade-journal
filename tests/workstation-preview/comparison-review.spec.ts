import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { demoTrades } from "../../src/lib/workstation/demo";
import { beforeEntryBoundary } from "../../src/lib/workstation/before-entry";
import { readFileSync } from "node:fs";

async function open(page: Page, panels = 1, journal = false) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ preferences, panels, journal }) => {
    localStorage.setItem("execution-lab:workstation:preferences:demo:v1", JSON.stringify({ ...preferences, journal, panels: ["5m", "1h", "1d", "1wk"].slice(0, panels).map((interval, i) => ({ id: `chart-${i + 1}`, interval, benchmark: "SPY" })) }));
  }, { preferences: defaultPreferences(), panels, journal });
  await page.goto("/preview/trades");
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  return { errors, requests };
}

for (const panels of [1, 2, 3, 4]) test(`${panels} panels compare benchmark candles and cut off independently`, async ({ page }) => {
  const { errors, requests } = await open(page, panels);
  const charts = page.locator(".ws-chart"), first = charts.first();
  for (const chart of await charts.all()) await expect(chart.locator(".ws-benchmark-legend")).toContainText("SPY · O");
  const priorTo = Number(await first.getAttribute("data-visible-to"));
  await first.getByRole("button", { name: "Before entry chart-1", exact: true }).click();
  await expect(first.getByRole("button", { name: "Before entry chart-1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Number(await first.getAttribute("data-visible-to"))).toBeLessThan(demoTrades[0].openTime);
  for (let i = 1; i < panels; i++) await expect(charts.nth(i).getByRole("button", { name: `Before entry chart-${i + 1}`, exact: true })).toHaveAttribute("aria-pressed", "false");
  await first.getByLabel("Comparison chart-1", { exact: true }).selectOption("QQQ");
  await expect(first.locator(".ws-benchmark-legend")).toContainText("QQQ · O");
  await first.getByRole("button", { name: "Before entry chart-1", exact: true }).click();
  await expect.poll(async () => Number(await first.getAttribute("data-visible-to"))).toBe(priorTo);
  await first.getByLabel("Comparison chart-1", { exact: true }).selectOption("off");
  await expect(first.locator(".ws-benchmark-legend")).toBeEmpty();
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("before entry covers all intervals, replay, theme and fullscreen", async ({ page }) => {
  const { errors } = await open(page);
  const chart = page.locator(".ws-chart").first();
  await chart.getByRole("button", { name: "Before entry chart-1", exact: true }).click();
  for (const interval of ["5m", "10m", "15m", "1h", "1d", "1wk"] as const) {
    await chart.getByLabel("Timeframe chart-1", { exact: true }).selectOption(interval);
    await expect(chart).toHaveAttribute("data-history-interval", interval);
    const boundary = beforeEntryBoundary(demoTrades[0], interval, { timezone: "UTC", calendar: "utc", marketHours: "regular" })!;
    await expect.poll(async () => Number(await chart.getAttribute("data-visible-to"))).toBeLessThan(boundary);
    await expect(chart.locator(".ws-benchmark-legend")).toContainText("SPY · O");
  }
  await page.evaluate(() => { localStorage.setItem("execution-lab:appearance:demo:v1", "light"); window.dispatchEvent(new Event("execution-lab-appearance-change")); });
  await chart.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await expect(chart.locator(".ws-benchmark-legend")).toContainText("SPY · O");
  await chart.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  await expect(chart.getByRole("button", { name: "Before entry chart-1", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("journal lazily mounts formatting, retains custom properties and copies matching HTML", async ({ page }) => {
  const { errors } = await open(page, 1, true);
  await expect(page.locator(".ws-notion-review .tiptap")).toHaveCount(0);
  await page.getByText("Trade properties", { exact: true }).click();
  await expect(page.locator(".ws-template-property")).toHaveCount(29);
  await page.getByLabel("Market Regime", { exact: true }).fill("Rotation");
  await page.getByLabel("Sector ETF / Proxy", { exact: true }).fill("IHF / XLV");
  await page.getByRole("spinbutton", { name: "Planned entry", exact: true }).fill("20");
  await page.getByRole("spinbutton", { name: "Planned stop", exact: true }).fill("19");
  await expect(page.locator("#notion-stopLossPercent")).toHaveText("5.00%");
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const field = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await field.fill("Patient entry"); await field.press("Control+a");
  await page.getByRole("button", { name: "Bold Takeaways", exact: true }).click();
  await page.getByRole("button", { name: "Underline Takeaways", exact: true }).click();
  await page.getByRole("button", { name: "Bullet list Takeaways", exact: true }).click();
  await expect(field.locator("ul li strong u, ul li u strong")).toHaveText("Patient entry");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async (items: ClipboardItem[]) => {
      const item = items[0];
      (window as unknown as { copied: object }).copied = { html: await (await item.getType("text/html")).text(), text: await (await item.getType("text/plain")).text() };
    } } });
  });
  await page.getByRole("button", { name: "Copy review for Notion", exact: false }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: { html: string; text: string } }).copied);
  expect(copied.html).toContain("<u>"); expect(copied.html).toContain("<ul>");
  expect(copied.html).toContain("Rotation"); expect(copied.html).toContain("IHF / XLV");
  expect(copied.html).toContain("Pre-trade metrics"); expect(copied.text).toContain("Entry Screen");
  const adr = page.locator(".ws-market-metrics > span").filter({ hasText: "ADR%" }).locator("b");
  await expect(adr).toHaveText(/\d+\.\d+%/);
  expect(copied.html).toContain(await adr.innerText());
  await expect.poll(() => page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.includes("demo-nvda") && value.includes("Patient entry") && value.includes("Rotation")))).toBe(true);
  await page.reload();
  await page.getByText("Trade properties", { exact: true }).click();
  await expect(page.getByLabel("Market Regime", { exact: true })).toHaveValue("Rotation");
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true }).locator("ul")).toContainText("Patient entry");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: "test-results/comparison-journal.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("marker colours update independently of candles and survive preference restoration", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  await page.getByLabel("Buy colour", { exact: true }).fill("#00bbff");
  await page.getByLabel("Sell colour", { exact: true }).fill("#ffa500");
  await expect(page.getByLabel("Buy colour", { exact: true })).toHaveValue("#00bbff");
  await page.getByRole("button", { name: "Reset marker colours", exact: true }).click();
  await expect(page.getByLabel("Buy colour", { exact: true })).toHaveValue("#34d399");
});

test("PNG exports retain comparison candles, their actual OHLC legend and the before-entry boundary", async ({ page }) => {
  const { errors } = await open(page);
  const chart = page.locator(".ws-chart").first();
  await chart.getByRole("button", { name: "Before entry chart-1", exact: true }).click();
  await expect(chart.locator(".ws-benchmark-legend")).toContainText("SPY · O");
  await expect.poll(async () => Number(await chart.getAttribute("data-visible-to"))).toBeLessThan(demoTrades[0].openTime);
  await page.evaluate(() => {
    const state = window as unknown as { exportText: string[] }; state.exportText = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(...args) { state.exportText.push(args[0]); return fill.apply(this, args); };
  });
  await chart.getByRole("button", { name: "Export chart-1", exact: true }).click();
  await page.getByLabel("Light background").uncheck();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
  const png = await download;
  const data = `data:image/png;base64,${readFileSync((await png.path())!).toString("base64")}`;
  const result = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let blue = 0;
    for (let i = image.width * 60 * 4; i < pixels.length; i += 4) if (pixels[i] === 96 && pixels[i+1] === 165 && pixels[i+2] === 250) blue++;
    return { blue, labels: (window as unknown as { exportText: string[] }).exportText };
  }, data);
  expect(result.blue).toBeGreaterThan(10);
  expect(result.labels.some(text => text.includes("SPY · O"))).toBe(true);
  expect(result.labels.some(text => text.includes("BEFORE ENTRY"))).toBe(true);
  await png.saveAs("artifacts/comparison/before-entry-spy.png");
  expect(errors).toEqual([]);
});
