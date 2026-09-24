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
    drawingTriangle?: { x: number; y: number };
    measurementStroke?: { x: number; y: number; endX: number; endY: number };
  }
}

async function open(page: Page, drawings?: Drawing[], legacyStyle?: { color: string; width: number; dashed: boolean }, overrides: Partial<WorkspacePreferences> = {}) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings = drawings ?? [{ ...doc.drawings[0], text: "" }];
  const preferences: Record<string, unknown> = { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m" }], labels: "hidden", journal: false, ...overrides };
  if (legacyStyle) { delete preferences.drawingStyles; preferences.style = legacyStyle; }
  await page.addInitScript(({ preferences, doc, preferenceKey, documentKey }) => {
    if (!localStorage.getItem(preferenceKey)) localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    if (!localStorage.getItem(documentKey)) localStorage.setItem(documentKey, JSON.stringify(doc));
    window.drawingLiveText = []; window.drawingExportText = [];
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, fill = prototype.fillText, move = prototype.moveTo, line = prototype.lineTo, close = prototype.closePath, begin = prototype.beginPath;
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
    prototype.beginPath = function() { moves.delete(this); begin.call(this); };
    prototype.closePath = function() {
      const tip = moves.get(this);
      if (this.canvas.classList.contains("ws-chart-overlay") && tip) {
        const rect = this.canvas.getBoundingClientRect();
        window.drawingTriangle = { x: rect.left + tip.x, y: rect.top + tip.y };
      }
      close.call(this);
    };
    prototype.lineTo = function(x, y) {
      const start = moves.get(this);
      if (this.canvas.classList.contains("ws-chart-overlay") && this.strokeStyle === "#d0ab12" && start && start.x !== x && start.y !== y) {
        const rect = this.canvas.getBoundingClientRect();
        window.measurementStroke = { x: rect.left + start.x, y: rect.top + start.y, endX: rect.left + x, endY: rect.top + y };
      }
      if (this.canvas.classList.contains("ws-chart-overlay") && start && start.y === y && x - start.x > 350) {
        const rect = this.canvas.getBoundingClientRect();
        window.drawingRayLine = { x: rect.left + Math.max(30, start.x + 30), y: rect.top + y };
      }
      line.call(this, x, y);
    };
  }, { preferences, doc, preferenceKey, documentKey });
  await page.goto(`/preview/trades?groupKey=${encodeURIComponent(demoTrades[0].id)}`);
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-visible-from", /\d+/);
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, documentKey);
const preferences = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as WorkspacePreferences, preferenceKey);
const liveText = (page: Page) => page.evaluate(() => window.drawingLiveText.map(row => row.text));
test("measurement label controls, rigid dragging, cancellation, visibility and captures", async ({ page }) => {
  const trade = demoTrades[0];
  const measurement: Drawing = { ...initialDemoDocument(trade).drawings[0], id: "rigid-measure", tool: "measure", color: "#d0ab12", text: "Rigid move",
    points: [{ time: trade.openTime, price: trade.entry }, { time: trade.openTime + 1800, price: trade.entry + 2 }] };
  const errors = await open(page, [measurement]);
  const stroke = () => page.evaluate(() => window.measurementStroke!);
  await expect.poll(stroke).toBeTruthy();
  let line = await stroke();
  const initialWidth = line.endX - line.x;
  const midpoint = () => ({ x: (line.x + line.endX) / 2, y: (line.y + line.endY) / 2 });
  let middle = midpoint();
  await page.mouse.move(middle.x, middle.y); await page.mouse.down(); await page.mouse.move(middle.x + 45, middle.y - 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings[0].points[0].price).not.toBe(trade.entry);
  const moved = (await saved(page)).drawings[0].points;
  expect(moved[1].price - moved[0].price).toBeCloseTo(2, 8);
  line = await stroke();
  expect(line.endX - line.x).toBeCloseTo(initialWidth, 1);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points).toEqual(measurement.points);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points).toEqual(moved);
  line = await stroke(); middle = midpoint();
  await page.mouse.move(middle.x, middle.y); await page.mouse.down(); await page.mouse.move(middle.x - 20, middle.y + 10, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect((await saved(page)).drawings[0].points).toEqual(moved);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await page.locator(".ws-object-list > div").first().getByRole("button").first().click();
  for (const name of ["Values", "Percent", "Interval", "Number of bars"]) await page.getByLabel(name, { exact: true }).uncheck();
  await expect.poll(() => liveText(page)).toEqual(["Rigid move"]);
  await page.getByTitle("Save drawing style as default for Price & time measurement", { exact: true }).click();
  await expect.poll(async () => (await preferences(page)).drawingStyles.measure).toMatchObject({ showValues: false, showPercent: false, showInterval: false, showBars: false });
  await page.getByTitle("Hide drawing", { exact: true }).click();
  await expect(page.locator(".ws-drawing-properties")).toBeVisible();
  await expect.poll(() => liveText(page)).toEqual([]);
  await page.getByTitle("Show drawing", { exact: true }).click();
  await expect.poll(() => liveText(page)).toEqual(["Rigid move"]);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).click();
  await expect.poll(() => liveText(page)).toEqual([]);
  expect((await saved(page)).drawings[0].hidden).toBe(false);
  await page.evaluate(() => { window.drawingExportText = []; });
  await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Active chart PNG", exact: true }).click(); await download;
  expect(await page.evaluate(() => window.drawingExportText)).not.toContain("Rigid move");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.reload();
  await expect.poll(() => liveText(page)).toEqual(["Rigid move"]);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).click();
  await page.getByRole("button", { name: "Price & time measurement", exact: true }).click();
  await expect.poll(() => liveText(page)).toEqual([]);
  await expect(page.getByRole("button", { name: "Show all drawings", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Hide all keeps older drawings hidden through new notes, placement previews, duplication and undo", async ({ page }) => {
  const old: Drawing = { ...initialDemoDocument(demoTrades[0]).drawings[0], id: "old-ray", text: "Older ray", hidden: false };
  const individual: Drawing = { ...old, id: "individual-ray", text: "Individually hidden", hidden: true };
  const errors = await open(page, [old, individual]);
  await expect.poll(() => liveText(page)).toContain("Older ray");
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  const before = await saved(page);
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await expect.poll(() => liveText(page)).toEqual([]);
  await expect(page.getByText("Existing drawings hidden; new drawings remain visible.", { exact: true })).toBeVisible();
  await place(page, "n"); await page.getByLabel("Annotation text", { exact: true }).fill("Fresh note");
  await expect.poll(() => liveText(page)).toContain("Fresh note");
  expect(await liveText(page)).not.toContain("Older ray");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)).toMatchObject({ text: "Fresh note", hidden: false });
  // A two-anchor placement preview is visible before it is committed.
  const chart = page.locator(".ws-chart"); await chart.focus(); await page.keyboard.press("m");
  const rect = (await chart.locator(".ws-plot").boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .3, rect.y + rect.height * .35);
  await page.mouse.move(rect.x + rect.width * .55, rect.y + rect.height * .55);
  await expect.poll(() => liveText(page)).toContainEqual(expect.stringMatching(/bars/));
  expect(await liveText(page)).not.toContain("Older ray");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(3);
  const rows = page.locator(".ws-object-list > div");
  await rows.filter({ hasText: "Individually hidden" }).getByRole("button").first().click();
  await page.getByTitle("Duplicate drawing", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(4);
  expect((await saved(page)).drawings.at(-1)).toMatchObject({ hidden: false, text: "Individually hidden" });
  await expect.poll(() => liveText(page)).toContain("Individually hidden");
  // Deleting and restoring a batched drawing must not reveal its old ID.
  await rows.filter({ hasText: "Older ray" }).getByRole("button").first().click();
  await page.getByTitle("Delete drawing", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).drawings.some(d => d.id === old.id)).toBe(false);
  await chart.focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings.some(d => d.id === old.id)).toBe(true);
  expect(await liveText(page)).not.toContain("Older ray");
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).drawings.some(d => d.id === old.id)).toBe(false);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings.some(d => d.id === old.id)).toBe(true);
  expect(await liveText(page)).not.toContain("Older ray");
  // A fresh capture uses the visible mix, not all or none of the drawings.
  await page.evaluate(() => { window.drawingExportText = []; });
  await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Active chart PNG", exact: true }).click(); await download;
  expect(await page.evaluate(() => window.drawingExportText)).toContain("Fresh note");
  expect(await page.evaluate(() => window.drawingExportText)).not.toContain("Older ray");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Show all drawings", exact: true }).click();
  await expect.poll(() => liveText(page)).toContain("Older ray");
  expect((await saved(page)).drawings.find(d => d.id === individual.id)?.hidden).toBe(true);
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).click();
  await expect.poll(() => liveText(page)).toEqual([]);
  await page.reload(); await expect.poll(() => liveText(page)).toContain("Older ray"); await expect.poll(() => liveText(page)).toContain("Fresh note");
  expect((await saved(page)).drawings.find(d => d.id === individual.id)?.hidden).toBe(true);
  expect(errors).toEqual([]);
});

test("batched pins stay hidden across charts, fullscreen and replay; trade navigation clears the batch", async ({ page }) => {
  const trade = demoTrades[0], old: Drawing = { ...initialDemoDocument(trade).drawings[0], id: "old-pin", tool: "pin", text: "Old shared pin", hidden: false, panel: null, createdAt: trade.openTime - 3600, points: [{ time: trade.openTime - 600, price: trade.entry }] };
  const errors = await open(page, [old], undefined, { panels: [{ id: "chart-1", interval: "5m" }, { id: "chart-2", interval: "5m" }] });
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await page.getByRole("button", { name: "Hide all drawings", exact: true }).click();
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  const chart = page.locator('[data-chart-id="chart-1"]');
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  await chart.locator(".ws-plot").click({ position: { x: 160, y: 150 } });
  await page.getByLabel("Annotation text", { exact: true }).fill("New replay pin");
  await page.getByLabel("Annotation visibility", { exact: true }).selectOption("all");
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(2);
  const added = (await saved(page)).drawings.at(-1)!;
  await expect(page.locator(`[data-pin-target="${added.id}"]`)).toHaveCount(2);
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(0);
  await chart.focus(); await page.keyboard.press("f");
  await expect(chart).toHaveClass(/ws-chart-fullscreen/);
  await expect(chart.locator(`[data-pin-target="${added.id}"]`)).toBeVisible();
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(0);
  await page.keyboard.press("Shift+B");
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await chart.focus(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  // Switching away and back restores normal per-drawing visibility.
  await chart.focus(); await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(0);
  await page.locator(".ws-chart").first().focus(); await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator('[data-pin-target="old-pin"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
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

test("whole measurements respect locks, snapping and Before entry in fullscreen", async ({ page }, info) => {
  const trade = demoTrades[0], points = [{ time: trade.openTime - 900, price: trade.entry - .3 }, { time: trade.openTime - 600, price: trade.entry + .2 }];
  const drawing: Drawing = { ...initialDemoDocument(trade).drawings[0], tool: "measure", color: "#d0ab12", text: "Before entry measure", points, locked: true };
  const errors = await open(page, [drawing]);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await page.locator(".ws-object-list > div").first().getByRole("button").first().click();
  const dragLine = async (dx: number, dy: number) => {
    const line = await page.evaluate(() => window.measurementStroke!);
    const x = (line.x + line.endX) / 2, y = (line.y + line.endY) / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  };
  await expect(page.getByLabel("Values", { exact: true })).toBeDisabled();
  await dragLine(20, -10);
  expect((await saved(page)).drawings[0].points).toEqual(points);
  await page.getByTitle("Unlock drawing", { exact: true }).click();
  await page.getByRole("button", { name: "Magnet to OHLC", exact: true }).click();
  await dragLine(30, 8);
  await expect.poll(async () => (await saved(page)).drawings[0].points[0].time).not.toBe(points[0].time);
  const snapped = (await saved(page)).drawings[0].points;
  expect(snapped[0].time % 300).toBe(0);
  expect(snapped[1].price - snapped[0].price).toBeCloseTo(.5, 8);
  await page.getByRole("button", { name: "Undo drawing", exact: true }).click();
  await expect.poll(async () => (await saved(page)).drawings[0].points).toEqual(points);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Shift+B");
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-executions", "0");
  await page.getByTitle("Appearance", { exact: true }).click();
  await page.locator(".ws-chart").focus(); await page.keyboard.press("f");
  await expect(page.locator(".ws-chart-fullscreen")).toBeVisible();
  await dragLine(300, 0);
  await expect.poll(async () => (await saved(page)).drawings[0].points[1].time).toBe(trade.openTime - 300);
  expect((await saved(page)).drawings[0].points[1].price - (await saved(page)).drawings[0].points[0].price).toBeCloseTo(.5, 8);
  await page.screenshot({ path: info.outputPath("measurement-before-entry-fullscreen.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("migrated defaults and saved styles stay independent across tool creation, settings and reload", async ({ page }) => {
  const legacy = { color: "#123456", width: 3, dashed: true };
  const errors = await open(page, undefined, legacy);
  await expect.poll(async () => (await preferences(page)).drawingStyles.measure).toEqual({ ...legacy, extendLeft: false, extendRight: false, showValues: true, showPercent: true, showInterval: true, showBars: true });
  await selectRay(page);
  await page.getByLabel("Annotation color", { exact: true }).fill("#ff3344");
  await page.getByLabel("Annotation width", { exact: true }).selectOption("2");
  await page.getByLabel("Show automatic label", { exact: true }).uncheck();
  await page.getByTitle("Save drawing style as default for Horizontal ray", { exact: true }).click();
  const rayStyle = { color: "#ff3344", width: 2, dashed: true, showDefaultLabel: false };
  await expect.poll(async () => (await preferences(page)).drawingStyles.ray).toEqual(rayStyle);
  expect((await preferences(page)).drawingStyles.measure).toEqual({ ...legacy, extendLeft: false, extendRight: false, showValues: true, showPercent: true, showInterval: true, showBars: true });
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
  const measureStyle = { ...legacy, color: "#22aa88", dashed: false, extendLeft: false, extendRight: false, showValues: true, showPercent: true, showInterval: true, showBars: true };
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
  await expect(page.getByLabel("Extend left", { exact: true })).not.toBeChecked();
  await page.getByLabel("Extend left", { exact: true }).check();
  await page.getByLabel("Extend right", { exact: true }).check();
  await page.getByTitle("Save drawing style as default for Price & time measurement", { exact: true }).click();
  await expect.poll(async () => (await preferences(page)).drawingStyles.measure).toMatchObject({ extendLeft: true, extendRight: true });
  await page.getByLabel("Annotation text", { exact: true }).fill("Measured retest");
  await expect.poll(() => liveText(page)).toContain("Measured retest");
  await expect.poll(async () => (await saved(page)).drawings[0].text).toBe("Measured retest");
  expect((await saved(page)).drawings[0]).toMatchObject({ extendLeft: true, extendRight: true });
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

test("planned triangles retain legacy colours, toggle prices, drag, save defaults and capture notes", async ({ page }) => {
  const trade = demoTrades[0];
  const entry: Drawing = { ...initialDemoDocument(trade).drawings[0], tool: "entry", text: "", color: "#8844cc",
    points: [{ time: trade.openTime, price: trade.entry }] };
  const errors = await open(page, [entry]);
  await expect.poll(() => liveText(page)).toContain(trade.entry.toFixed(2));
  await expect.poll(() => page.evaluate(() => window.drawingTriangle)).toBeTruthy();
  let tip = (await page.evaluate(() => window.drawingTriangle))!;
  await page.mouse.click(tip.x, tip.y + 5);
  await expect(page.getByLabel("Annotation color", { exact: true })).toHaveValue("#8844cc");
  await page.getByLabel("Show price", { exact: true }).uncheck();
  await expect.poll(() => liveText(page)).toEqual([]);
  await page.getByLabel("Annotation text", { exact: true }).fill("Planned breakout");
  await expect.poll(() => liveText(page)).toEqual(["Planned breakout"]);
  await page.getByTitle("Save drawing style as default for Planned entry", { exact: true }).click();
  await expect.poll(async () => (await preferences(page)).drawingStyles.entry).toMatchObject({ color: "#8844cc", showPrice: false });
  await page.getByTitle("Lock drawing", { exact: true }).click();
  await expect(page.getByLabel("Show price", { exact: true })).toBeDisabled();
  await page.getByTitle("Unlock drawing", { exact: true }).click();
  tip = (await page.evaluate(() => window.drawingTriangle))!;
  await page.mouse.move(tip.x, tip.y); await page.mouse.down(); await page.mouse.move(tip.x + 35, tip.y - 25, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings[0].points[0].price).not.toBe(trade.entry);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points[0].price).toBe(trade.entry);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points[0].price).not.toBe(trade.entry);
  await page.reload();
  await expect.poll(() => liveText(page)).toEqual(["Planned breakout"]);
  expect((await saved(page)).drawings[0]).toMatchObject({ tool: "entry", color: "#8844cc", showPrice: false });
  await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Capture chart", exact: true }).click();
  await page.getByRole("dialog", { name: "Attach current chart", exact: true }).getByRole("button", { name: "Exit Screen", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  expect(await page.evaluate(() => window.drawingExportText)).toContain("Planned breakout");
  await page.getByRole("button", { name: "Planned exit", exact: true }).click();
  const rect = (await page.locator(".ws-plot").boundingBox())!;
  await page.mouse.click(rect.x + rect.width * .65, rect.y + rect.height * .4);
  await expect.poll(async () => (await saved(page)).drawings.at(-1)).toMatchObject({ tool: "exit", color: "#ef4444", showPrice: true });
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await dialog.getByLabel("Drawing tool defaults", { exact: true }).selectOption("exit");
  await dialog.getByLabel("Show price", { exact: true }).uncheck();
  await dialog.getByLabel("Drawing tool defaults", { exact: true }).selectOption("measure");
  await dialog.getByLabel("Extend left", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(async () => (await preferences(page)).drawingStyles.exit?.showPrice).toBe(false);
  expect((await preferences(page)).drawingStyles.measure).toMatchObject({ extendLeft: true, extendRight: false });
  expect(errors).toEqual([]);
});
