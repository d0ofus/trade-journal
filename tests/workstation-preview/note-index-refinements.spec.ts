import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";

const prefKey = "execution-lab:workstation:preferences:demo:v1", docKey = DEMO_PREFIX + demoTrades[0].id;
type Row = { text: string; x: number; y: number; maxWidth?: number; color: string };
declare global { interface Window { refinementRows: Row[]; refinementExport: Row[]; noteResize?: { x: number; y: number }; } }
async function open(page: Page, existing = false) {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings = existing ? doc.drawings.filter(d => d.tool === "text").map(d => ({ ...d, text: "Capture alignment note", noteWidth: 180 })) : [];
  await page.addInitScript(({ prefKey, docKey, prefs, doc }) => {
    if (!localStorage.getItem(prefKey)) localStorage.setItem(prefKey, JSON.stringify(prefs));
    if (!localStorage.getItem(docKey)) localStorage.setItem(docKey, JSON.stringify(doc));
    window.refinementRows = []; window.refinementExport = [];
    const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText, rect = proto.fillRect, clear = proto.clearRect;
    proto.clearRect = function(x, y, w, h) { if (this.canvas.classList.contains("ws-chart-overlay")) { window.refinementRows = []; window.noteResize = undefined; } clear.call(this, x, y, w, h); };
    proto.fillText = function(text, x, y, maxWidth) {
      const row = { text, x, y, maxWidth, color: String(this.fillStyle) };
      if (this.canvas.classList.contains("ws-chart-overlay")) window.refinementRows.push(row);
      else if (!this.canvas.isConnected) window.refinementExport.push(row);
      if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth);
    };
    proto.fillRect = function(x, y, w, h) {
      if (this.canvas.classList.contains("ws-chart-overlay") && w === 6 && h === 10) { const box = this.canvas.getBoundingClientRect(); window.noteResize = { x: box.left + x + 3, y: box.top + y + 5 }; }
      rect.call(this, x, y, w, h);
    };
  }, { prefKey, docKey, prefs: { ...defaultPreferences(), labels: "hidden", magnet: false, journal: false, panels: [{ id: "chart-1", interval: "5m", session: "regular" }] }, doc });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-from", /\d+/);
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, docKey);

test("new notes start empty and focused, wrap, resize with undo and survive reload", async ({ page }) => {
  const errors = await open(page), chart = page.locator(".ws-chart");
  await chart.focus(); await page.keyboard.press("n");
  const box = (await chart.locator(".ws-chart-overlay").boundingBox())!;
  await page.mouse.click(box.x + box.width * .45, box.y + box.height * .45);
  const editor = page.getByLabel("Annotation text", { exact: true });
  await expect(editor).toBeFocused(); await expect(editor).toHaveValue("");
  const text = "A long trade note wraps naturally without squeezing the letters and preserves every word.\nSecond paragraph.";
  await page.keyboard.insertText(text);
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.text).toBe(text);
  await page.getByLabel("Note width", { exact: true }).fill("160");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBe(160);
  await expect.poll(() => page.evaluate(() => window.refinementRows.length)).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.refinementRows.every(row => row.maxWidth === undefined))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.noteResize)).toBeTruthy();
  const handle = (await page.evaluate(() => window.noteResize))!, anchors = (await saved(page)).drawings.at(-1)!.points;
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 100, handle.y, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBeGreaterThan(240);
  expect((await saved(page)).drawings.at(-1)!.points).toEqual(anchors);
  await chart.focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBe(160);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBeGreaterThan(240);
  await page.reload(); expect((await saved(page)).drawings.at(-1)?.text).toBe(text);
  expect((await saved(page)).drawings.at(-1)?.noteWidth).toBeGreaterThan(240);
  expect(errors).toEqual([]);
});

for (const ratio of [1, 1.25, 2, 3]) test.describe(`index pane DPR ${ratio}`, () => {
test.use({ deviceScaleFactor: ratio });
test("index pane keeps dates and chart size, resizes, restores and captures aligned notes", async ({ page }, info) => {
  const errors = await open(page, true), chart = page.locator(".ws-chart");
  await chart.getByLabel("Comparison chart-1", { exact: true }).selectOption("SPY");
  await expect(chart.locator(".ws-benchmark-legend")).toContainText("Independent scale");
  const before = (await chart.boundingBox())!, from = await chart.getAttribute("data-visible-from"), to = await chart.getAttribute("data-visible-to");
  await chart.getByLabel("Index display chart-1").click();
  await expect(chart).toHaveAttribute("data-benchmark-mode", "pane");
  expect((await chart.boundingBox())!.height).toBe(before.height);
  await expect(chart).toHaveAttribute("data-visible-from", from!); await expect(chart).toHaveAttribute("data-visible-to", to!);
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await settings.getByLabel("Index transparency", { exact: true }).fill("40");
  await settings.getByLabel("Index pane height", { exact: true }).fill("35");
  await settings.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).panels[0].benchmarkPaneRatio, prefKey)).toBe(.35);
  await page.reload();
  await expect(chart).toHaveAttribute("data-benchmark-mode", "pane");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).benchmarkTransparency, prefKey)).toBe(40);
  const plot = chart.locator(".ws-chart-overlay");
  await expect.poll(async () => Number(await chart.getAttribute("data-primary-pane-height"))).toBeGreaterThan(100);
  const height = Number(await chart.getAttribute("data-primary-pane-height")), bounds = (await plot.boundingBox())!;
  expect(height).toBeLessThan(bounds.height * .8);
  // The chart library's own separator also resizes the pane without moving drawings into it.
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + height + 1); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + height - 35, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => Number(await chart.getAttribute("data-primary-pane-height"))).toBeLessThan(height - 20);
  await expect.poll(() => page.evaluate(() => window.refinementRows.some(r => r.text.startsWith("Capture alignment")))).toBe(true);
  const live = await page.evaluate(() => window.refinementRows.filter(r => r.text.includes("Capture") || r.text === "note"));
  await chart.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
  await (await download).saveAs(info.outputPath("index-pane-capture.png"));
  const exported = await page.evaluate(() => window.refinementExport);
  for (const row of live) {
    const match = exported.find(r => r.text === row.text)!; expect(match).toBeTruthy();
    expect(Math.abs(match.x - row.x)).toBeLessThan(4); expect(Math.abs(match.y - row.y)).toBeLessThan(4); expect(match.maxWidth).toBeUndefined();
  }
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("index-pane-live.png") });
  await chart.getByLabel("Index display chart-1").click();
  await expect(chart).toHaveAttribute("data-benchmark-mode", "overlay");
  await expect.poll(async () => Number(await chart.getAttribute("data-primary-pane-height"))).toBeGreaterThan(bounds.height * .9);
  expect(errors).toEqual([]);
});
});
