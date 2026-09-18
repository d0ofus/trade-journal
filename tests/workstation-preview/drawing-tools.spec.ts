import { expect, test, type Page } from "@playwright/test";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { defaultPreferences, type Drawing, type TradeDocument, type WorkspacePreferences } from "../../src/lib/workstation/types";

const preferenceKey = "execution-lab:workstation:preferences:demo:v1";
const documentKey = DEMO_PREFIX + demoTrades[0].id;
type PaintedText = { text: string; x: number; y: number };
declare global {
  interface Window {
    drawingLiveText: PaintedText[];
    drawingExportText: string[];
    drawingRayLine?: { x: number; y: number };
  }
}

async function open(page: Page, drawings?: Drawing[], legacyStyle?: { color: string; width: number; dashed: boolean }) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings = drawings ?? [{ ...doc.drawings[0], text: "" }];
  const preferences: Record<string, unknown> = { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m" }], labels: "hidden", journal: false };
  if (legacyStyle) { delete preferences.drawingStyles; preferences.style = legacyStyle; }
  await page.addInitScript(({ preferences, doc, preferenceKey, documentKey }) => {
    if (!localStorage.getItem(preferenceKey)) localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    if (!localStorage.getItem(documentKey)) localStorage.setItem(documentKey, JSON.stringify(doc));
    window.drawingLiveText = []; window.drawingExportText = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, fill = prototype.fillText, move = prototype.moveTo, line = prototype.lineTo;
    const moves = new WeakMap<CanvasRenderingContext2D, { x: number; y: number }>();
    prototype.clearRect = function(x, y, w, h) {
      if (this.canvas.classList.contains("ws-chart-overlay")) { window.drawingLiveText = []; window.drawingRayLine = undefined; }
      clear.call(this, x, y, w, h);
    };
    prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas.classList.contains("ws-chart-overlay")) {
        const rect = this.canvas.getBoundingClientRect();
        window.drawingLiveText.push({ text, x: rect.left + x, y: rect.top + y });
      } else if (!this.canvas.isConnected) window.drawingExportText.push(text);
      if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth);
    };
    prototype.moveTo = function(x, y) { moves.set(this, { x, y }); move.call(this, x, y); };
    prototype.lineTo = function(x, y) {
      const start = moves.get(this);
      if (this.canvas.classList.contains("ws-chart-overlay") && start && start.y === y && x - start.x > 350) {
        const rect = this.canvas.getBoundingClientRect();
        window.drawingRayLine = { x: rect.left + Math.max(30, start.x + 30), y: rect.top + y };
      }
      line.call(this, x, y);
    };
  }, { preferences, doc, preferenceKey, documentKey });
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-from", /\d+/);
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, documentKey);
const preferences = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as WorkspacePreferences, preferenceKey);
const liveText = (page: Page) => page.evaluate(() => window.drawingLiveText.map(row => row.text));
async function selectRay(page: Page) {
  await expect.poll(() => page.evaluate(() => window.drawingRayLine)).toBeTruthy();
  const point = (await page.evaluate(() => window.drawingRayLine))!;
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel("Show automatic label", { exact: true })).toBeVisible();
}
async function place(page: Page, shortcut: string, secondPoint = false) {
  const chart = page.locator(".ws-chart");
  await chart.focus(); await page.keyboard.press(shortcut);
  const rect = (await chart.locator(".ws-plot").boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .42, rect.y + rect.height * .42);
  if (secondPoint) await page.mouse.click(rect.x + rect.width * .56, rect.y + rect.height * .62);
}

test("ray automatic labels toggle without hiding notes, with undo, duplication, reload and locking", async ({ page }) => {
  const errors = await open(page);
  await expect.poll(() => liveText(page)).toContainEqual(expect.stringMatching(/^Ray · /));
  await selectRay(page);
  const toggle = page.getByLabel("Show automatic label", { exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => liveText(page)).toEqual([]);
  await expect.poll(async () => (await saved(page)).drawings[0].showDefaultLabel).toBe(false);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Control+z");
  await expect.poll(() => liveText(page)).toContainEqual(expect.stringMatching(/^Ray · /));
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => liveText(page)).toEqual([]);
  await selectRay(page);
  await page.getByLabel("Annotation text", { exact: true }).fill("Keep this ray note");
  await expect.poll(() => liveText(page)).toEqual(["Keep this ray note"]);
  await page.getByLabel("Annotation text", { exact: true }).fill("");
  await expect.poll(() => liveText(page)).toEqual([]);
  await page.getByTitle("Duplicate drawing", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(2);
  expect((await saved(page)).drawings.every(drawing => drawing.showDefaultLabel === false)).toBe(true);
  await page.getByTitle("Delete drawing", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(1);
  await page.reload();
  await selectRay(page);
  await expect(toggle).not.toBeChecked();
  await page.getByTitle("Lock drawing", { exact: true }).click();
  await expect(toggle).toBeDisabled();
  await page.getByTitle("Unlock drawing", { exact: true }).click();
  await toggle.check();
  await expect.poll(() => liveText(page)).toContainEqual(expect.stringMatching(/^Ray · /));
  expect(errors).toEqual([]);
});

test("migrated defaults and saved styles stay independent across tool creation, settings and reload", async ({ page }) => {
  const legacy = { color: "#123456", width: 3, dashed: true };
  const errors = await open(page, undefined, legacy);
  await expect.poll(async () => (await preferences(page)).drawingStyles.measure).toEqual(legacy);
  await selectRay(page);
  await page.getByLabel("Annotation color", { exact: true }).fill("#ff3344");
  await page.getByLabel("Annotation width", { exact: true }).selectOption("2");
  await page.getByLabel("Show automatic label", { exact: true }).uncheck();
  await page.getByTitle("Save drawing style as default for Horizontal ray", { exact: true }).click();
  const rayStyle = { color: "#ff3344", width: 2, dashed: true, showDefaultLabel: false };
  await expect.poll(async () => (await preferences(page)).drawingStyles.ray).toEqual(rayStyle);
  expect((await preferences(page)).drawingStyles.measure).toEqual(legacy);
  await place(page, "r");
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(2);
  expect((await saved(page)).drawings.at(-1)).toMatchObject(rayStyle);
  expect((await saved(page)).drawings.at(-1)!.text).toBe("");
  await place(page, "m", true);
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(3);
  expect((await saved(page)).drawings.at(-1)).toMatchObject({ ...legacy, tool: "measure" });
  expect((await saved(page)).drawings.at(-1)).not.toHaveProperty("showDefaultLabel");
  await page.getByLabel("Annotation color", { exact: true }).fill("#22aa88");
  await page.getByTitle("Toggle dashed line", { exact: true }).click();
  await page.getByTitle("Save drawing style as default for Price & time measurement", { exact: true }).click();
  const measureStyle = { ...legacy, color: "#22aa88", dashed: false };
  await expect.poll(async () => (await preferences(page)).drawingStyles.measure).toEqual(measureStyle);
  expect((await preferences(page)).drawingStyles.ray).toEqual(rayStyle);
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await expect(dialog.getByLabel("Drawing tool defaults", { exact: true })).toHaveValue("measure");
  await dialog.getByLabel("Drawing tool defaults", { exact: true }).selectOption("ray");
  await dialog.getByLabel("Default drawing color", { exact: true }).fill("#8844cc");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(async () => (await preferences(page)).drawingStyles.ray).toEqual({ ...rayStyle, color: "#8844cc" });
  expect((await preferences(page)).drawingStyles.measure).toEqual(measureStyle);
  expect((await saved(page)).drawings[0].color).toBe("#ff3344");
  expect(await preferences(page)).not.toHaveProperty("style");
  await page.reload();
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-from", /\d+/);
  await place(page, "m", true);
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(4);
  expect((await saved(page)).drawings.at(-1)).toMatchObject(measureStyle);
  await place(page, "r");
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(5);
  expect((await saved(page)).drawings.at(-1)).toMatchObject({ ...rayStyle, color: "#8844cc" });
  expect(errors).toEqual([]);
});

test("measurement notes render above values, remain selectable, and appear in PNG exports and evidence", async ({ page }, info) => {
  const trade = demoTrades[0];
  const measurement: Drawing = { ...initialDemoDocument(trade).drawings[0], id: "measured-move", tool: "measure", text: "Measured breakout",
    points: [{ time: trade.openTime, price: trade.entry }, { time: trade.openTime + 1800, price: trade.entry + 2 }] };
  const errors = await open(page, [measurement]);
  await expect.poll(() => liveText(page)).toContain("Measured breakout");
  const location = (await page.evaluate(() => window.drawingLiveText.find(row => row.text === "Measured breakout")))!;
  await page.mouse.click(location.x + 5, location.y - 5);
  await expect(page.getByLabel("Annotation text", { exact: true })).toHaveValue("Measured breakout");
  await page.getByLabel("Annotation text", { exact: true }).fill("Measured retest");
  await expect.poll(() => liveText(page)).toContain("Measured retest");
  await expect.poll(async () => (await saved(page)).drawings[0].text).toBe("Measured retest");
  await page.reload();
  await expect.poll(() => liveText(page)).toContain("Measured retest");
  for (const light of [false, true]) {
    if (light) await page.getByTitle("Appearance", { exact: true }).click();
    const rows = await page.evaluate(() => window.drawingLiveText);
    expect(rows.find(row => row.text === "Measured retest")!.y).toBeLessThan(rows.find(row => row.text.includes("bars"))!.y);
    await page.evaluate(() => { window.drawingExportText = []; });
    await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    await (await download).saveAs(info.outputPath(`measurement-${light ? "light" : "dark"}.png`));
    const exported = await page.evaluate(() => window.drawingExportText);
    expect(exported).toContain("Measured retest");
    expect(exported).toContainEqual(expect.stringMatching(/^\+2\.00 .*30m.*bars$/));
    await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  }
  await page.evaluate(() => { window.drawingExportText = []; });
  await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Capture chart", exact: true }).click();
  await page.getByRole("dialog", { name: "Attach current chart", exact: true }).getByRole("button", { name: "Exit Screen", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  expect(await page.evaluate(() => window.drawingExportText)).toContain("Measured retest");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("measurement-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
