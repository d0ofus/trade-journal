import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";

const prefKey = "execution-lab:workstation:preferences:demo:v1", docKey = DEMO_PREFIX + demoTrades[0].id;
type Row = { text: string; x: number; y: number; chart?: string };
declare global { interface Window { indexRows: Row[]; indexExport: Row[]; indexPng?: Blob; indexStroke?: { x: number; y: number }; indexResize?: { x: number; y: number }; } }
async function open(page: Page, theme: "dark" | "light" = "dark", count = 1) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]); doc.drawings = [];
  await page.addInitScript(({ prefKey, docKey, prefs, doc }) => {
    if (!localStorage.getItem(prefKey)) localStorage.setItem(prefKey, JSON.stringify(prefs));
    if (!localStorage.getItem(docKey)) localStorage.setItem(docKey, JSON.stringify(doc));
    window.indexRows = []; window.indexExport = [];
    const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText, clear = proto.clearRect;
    proto.clearRect = function(x, y, w, h) { if (this.canvas.classList.contains("ws-chart-overlay")) window.indexRows = window.indexRows.filter(row => row.chart !== this.canvas.closest("[data-chart-id]")?.getAttribute("data-chart-id")); clear.call(this, x, y, w, h); };
    proto.fillText = function(text, x, y, maxWidth) {
      const m = this.getTransform(), row = { text, x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
      if (this.canvas.classList.contains("ws-chart-overlay")) window.indexRows.push({ ...row, chart: this.canvas.closest("[data-chart-id]")?.getAttribute("data-chart-id") ?? undefined, x: row.x / devicePixelRatio, y: row.y / devicePixelRatio });
      else if (!this.canvas.isConnected) window.indexExport.push(row);
      if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth);
    };
    const move = proto.moveTo, line = proto.lineTo, rect = proto.fillRect;
    const starts = new WeakMap<CanvasRenderingContext2D, { x: number; y: number }>();
    const screen = (ctx: CanvasRenderingContext2D, x: number, y: number) => { const m = ctx.getTransform(), b = ctx.canvas.getBoundingClientRect(); return { x: b.left + (m.a * x + m.c * y + m.e) / devicePixelRatio, y: b.top + (m.b * x + m.d * y + m.f) / devicePixelRatio }; };
    proto.moveTo = function(x, y) { starts.set(this, { x, y }); move.call(this, x, y); };
    proto.lineTo = function(x, y) { const a = starts.get(this); if (this.canvas.classList.contains("ws-chart-overlay") && this.strokeStyle === "#d0ab12" && a && a.y === y && x - a.x > 100) window.indexStroke = screen(this, a.x + (x - a.x) * .6, y); line.call(this, x, y); };
    proto.fillRect = function(x, y, w, h) { if (this.canvas.classList.contains("ws-chart-overlay") && w === 6 && h === 10) window.indexResize = screen(this, x + 3, y + 5); rect.call(this, x, y, w, h); };
    const create = URL.createObjectURL;
    URL.createObjectURL = function(value) { if (value instanceof Blob && value.type === "image/png") window.indexPng = value; return create.call(URL, value); };
  }, { prefKey, docKey, prefs: { ...defaultPreferences(), theme, labels: "hidden", magnet: false, journal: false, panels: Array.from({ length: count }, (_, i) => ({ id: `chart-${i + 1}`, interval: "5m", session: "regular", benchmark: "SPY", benchmarkMode: "pane", benchmarkPaneRatio: .35 })) }, doc });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, docKey);
async function place(page: Page, key: string, text: string, fraction = .55) {
  const chart = page.locator(".ws-chart").first(); await chart.focus(); await page.keyboard.press(key);
  const box = (await chart.locator(".ws-chart-overlay").boundingBox())!, top = Number(await chart.getAttribute("data-benchmark-pane-top")), height = Number(await chart.getAttribute("data-benchmark-pane-height"));
  await page.mouse.click(box.x + box.width * .52, box.y + top + height * fraction);
  await page.getByLabel("Annotation text", { exact: true }).fill(text);
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.text).toBe(text);
  return (await saved(page)).drawings.at(-1)!;
}

test("creates notes, rays and lines on the index scale and restores them by symbol and display mode", async ({ page }) => {
  const errors = await open(page);
  for (const [key, tool, name, fraction] of [["n", "text", "Index note", .7], ["r", "ray", "Index ray", .45], ["h", "horizontal", "Index line", .25]] as const) {
    const drawing = await place(page, key, name, fraction);
    expect(drawing).toMatchObject({ tool, target: { kind: "benchmark", symbol: "SPY" }, panel: "chart-1" });
    expect(drawing.points[0].price).toBeGreaterThan(450); expect(drawing.points[0].price).toBeLessThan(550);
    await expect.poll(() => page.evaluate(name => window.indexRows.some(row => row.text === name), name)).toBe(true);
  }
  const original = (await saved(page)).drawings;
  await expect(page.locator(".ws-drawing-properties")).toContainText("SPY · Index pane");
  const chart = page.locator(".ws-chart");
  await chart.getByLabel("Index display chart-1").click();
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text.startsWith("Index ")))).toBe(false);
  expect((await saved(page)).drawings).toEqual(original);
  await chart.getByLabel("Index display chart-1").click();
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Index note"))).toBe(true);
  await chart.getByLabel("Comparison chart-1").selectOption("QQQ");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text.startsWith("Index ")))).toBe(false);
  await chart.getByLabel("Comparison chart-1").selectOption("SPY");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Index ray"))).toBe(true);
  await page.reload();
  await expect(chart).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Index line"))).toBe(true);
  expect((await saved(page)).drawings).toEqual(original); expect(errors).toEqual([]);
});

test("drags and edits index drawings with locking, visibility, deletion and undo", async ({ page }) => {
  const errors = await open(page), chart = page.locator(".ws-chart");
  const ray = await place(page, "r", "Movable index ray", .65);
  await page.getByLabel("Annotation color", { exact: true }).fill("#d0ab12");
  await expect.poll(() => page.evaluate(() => window.indexStroke)).toBeTruthy();
  const start = (await page.evaluate(() => window.indexStroke))!;
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 30, start.y - 18, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings[0].points).not.toEqual(ray.points);
  const moved = (await saved(page)).drawings[0];
  expect(moved.target).toEqual(ray.target); expect(moved.points[0].price).toBeGreaterThan(450);
  await chart.focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points).toEqual(ray.points);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(async () => (await saved(page)).drawings[0].points).toEqual(moved.points);
  const selected = (await page.evaluate(() => window.indexStroke))!; await page.mouse.click(selected.x, selected.y);
  await page.getByTitle("Lock drawing", { exact: true }).click();
  const locked = (await page.evaluate(() => window.indexStroke))!;
  await page.mouse.move(locked.x, locked.y); await page.mouse.down(); await page.mouse.move(locked.x + 20, locked.y + 20); await page.mouse.up();
  expect((await saved(page)).drawings[0].points).toEqual(moved.points);
  await page.getByTitle("Unlock drawing", { exact: true }).click();
  await page.getByTitle("Hide drawing", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Movable index ray"))).toBe(false);
  await page.getByTitle("Show drawing", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Movable index ray"))).toBe(true);
  await chart.focus(); await page.keyboard.press("Delete");
  await expect.poll(async () => (await saved(page)).drawings.length).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings[0]?.target).toEqual(ray.target);
  const note = await place(page, "n", "Resizable index note", .5);
  await page.getByLabel("Note width", { exact: true }).fill("160");
  await expect.poll(() => page.evaluate(() => window.indexResize)).toBeTruthy();
  const resize = (await page.evaluate(() => window.indexResize))!;
  await page.mouse.move(resize.x, resize.y); await page.mouse.down(); await page.mouse.move(resize.x + 75, resize.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBeGreaterThan(210);
  expect((await saved(page)).drawings.at(-1)?.points).toEqual(note.points);
  await chart.focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.noteWidth).toBe(160);
  const label = (await page.evaluate(() => window.indexRows.find(row => row.text.startsWith("Resizable index"))))!;
  const plot = (await chart.locator(".ws-chart-overlay").boundingBox())!;
  await page.mouse.move(plot.x + label.x + 20, plot.y + label.y - 5); await page.mouse.down(); await page.mouse.move(plot.x + label.x + 45, plot.y + label.y - 14, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings.at(-1)?.points.length).toBe(2);
  const movedNote = (await saved(page)).drawings.at(-1)!;
  expect(movedNote.points[0]).toEqual(note.points[0]); expect(movedNote.points[1].price).toBeGreaterThan(450); expect(movedNote.target).toEqual(note.target);
  const stroke = (await page.evaluate(() => window.indexStroke))!;
  await page.mouse.move(stroke.x, stroke.y); await page.mouse.down(); await page.mouse.move(stroke.x, plot.y + 70, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings[0].points).not.toEqual(moved.points);
  expect((await saved(page)).drawings[0].target).toEqual(ray.target);
  const rayLabel = (await page.evaluate(() => window.indexRows.find(row => row.text === "Movable index ray")))!;
  expect(rayLabel.y).toBeGreaterThanOrEqual(Number(await chart.getAttribute("data-benchmark-pane-top")));
  expect(errors).toEqual([]);
});

test("respects chart scope, unsupported tools, off mode and historical boundaries", async ({ page }) => {
  const errors = await open(page, "dark", 2), first = page.locator('[data-chart-id="chart-1"]'), second = page.locator('[data-chart-id="chart-2"]');
  const ray = await place(page, "r", "Scoped index level");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Scoped index level" && row.chart === "chart-2"))).toBe(false);
  await page.getByLabel("Annotation visibility", { exact: true }).selectOption("all");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Scoped index level" && row.chart === "chart-2"))).toBe(true);
  await second.getByLabel("Comparison chart-2").selectOption("QQQ");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Scoped index level" && row.chart === "chart-2"))).toBe(false);
  await first.focus(); await page.keyboard.press("t");
  const box = (await first.locator(".ws-chart-overlay").boundingBox())!, top = Number(await first.getAttribute("data-benchmark-pane-top"));
  await page.mouse.click(box.x + 120, box.y + top + 40); await page.mouse.click(box.x + 220, box.y + top + 60);
  expect((await saved(page)).drawings).toHaveLength(1);
  await first.getByLabel("Comparison chart-1").selectOption("off");
  await expect.poll(() => page.evaluate(() => window.indexRows.some(row => row.text === "Scoped index level"))).toBe(false);
  await first.getByLabel("Comparison chart-1").selectOption("SPY");
  await expect(first).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  await first.focus(); await page.keyboard.press("Shift+b");
  const note = await place(page, "n", "Before-entry index note");
  expect(note.points.every(point => point.time < demoTrades[0].openTime)).toBe(true);
  await first.focus(); await page.keyboard.press("Shift+b");
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  const cursor = Number(await page.getByLabel("Replay time", { exact: true }).inputValue());
  const replayNote = await place(page, "n", "Replay index note");
  expect(replayNote.createdAt).toBe(cursor); expect(replayNote.points.every(point => point.time < cursor)).toBe(true);
  await page.getByRole("button", { name: "Exit replay", exact: true }).click();
  await first.getByLabel("Timeframe chart-1").selectOption("1h");
  await expect(first).toHaveAttribute("data-history-interval", "1h");
  await expect(first).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  await first.focus(); await page.keyboard.press("Shift+e");
  await expect(first).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  expect((await saved(page)).drawings.find(d => d.id === ray.id)?.target).toEqual(ray.target);
  expect(errors).toEqual([]);
});

for (const ratio of [1, 1.25, 2]) for (const theme of ["dark", "light"] as const) test.describe(`${theme} index capture DPR ${ratio}`, () => {
  test.use({ deviceScaleFactor: ratio });
  test("keeps stock and index notes aligned after resizing and in exported PNGs", async ({ page }, info) => {
    const errors = await open(page, theme), chart = page.locator(".ws-chart");
    const index = await place(page, "n", "Index capture", .7);
    await chart.focus(); await page.keyboard.press("n");
    let box = (await chart.locator(".ws-chart-overlay").boundingBox())!;
    await page.mouse.click(box.x + box.width * .35, box.y + 130);
    await page.getByLabel("Annotation text", { exact: true }).fill("Stock capture");
    await expect.poll(async () => (await saved(page)).drawings.at(-1)?.text).toBe("Stock capture");
    expect((await saved(page)).drawings.at(-1)?.target).toBeUndefined();
    const primaryHeight = Number(await chart.getAttribute("data-primary-pane-height"));
    box = (await chart.locator(".ws-chart-overlay").boundingBox())!;
    await page.mouse.move(box.x + box.width * .5, box.y + primaryHeight + 1); await page.mouse.down(); await page.mouse.move(box.x + box.width * .5, box.y + primaryHeight - 30, { steps: 10 }); await page.mouse.up();
    await expect.poll(async () => Number(await chart.getAttribute("data-primary-pane-height"))).toBeLessThan(primaryHeight - 3);
    expect((await saved(page)).drawings.find(d => d.id === index.id)?.points).toEqual(index.points);
    await chart.focus(); await page.keyboard.press("f");
    await expect(chart).toHaveClass(/ws-chart-fullscreen/);
    await expect.poll(async () => (await chart.locator(".ws-chart-overlay").boundingBox())!.height).toBeGreaterThan(box.height + 50);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => page.evaluate(() => window.indexRows.filter(row => row.text === "Index capture" || row.text === "Stock capture").length)).toBe(2);
    const live = await page.evaluate(() => window.indexRows.filter(row => row.text === "Index capture" || row.text === "Stock capture"));
    const paneTop = Number(await chart.getAttribute("data-benchmark-pane-top"));
    expect(live.find(row => row.text === "Stock capture")!.y).toBeLessThan(paneTop);
    expect(live.find(row => row.text === "Index capture")!.y).toBeGreaterThan(paneTop);
    const frame = (await chart.locator(".ws-chart-overlay").boundingBox())!;
    await chart.screenshot({ path: info.outputPath("index-live.png") });
    await chart.getByRole("button", { name: "Export chart-1", exact: true }).click();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    const dimensions = await page.evaluate(async () => { const image = await createImageBitmap(window.indexPng!); return { width: image.width, height: image.height }; });
    const scale = dimensions.width / frame.width;
    const exported = await page.evaluate(() => window.indexExport);
    const png = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.indexPng!.arrayBuffer()))));
    await writeFile(info.outputPath("index-capture.png"), png);
    await writeFile(info.outputPath("capture-geometry.json"), JSON.stringify({ frame, scale, live, exported: exported.filter(row => row.text === "Index capture" || row.text === "Stock capture"), dimensions }, null, 2));
    for (const row of live) {
      const match = exported.find(r => r.text === row.text)!; expect(match).toBeTruthy();
      expect(Math.abs(match.x / scale - row.x)).toBeLessThan(4);
      expect(Math.abs(match.y / scale - 48 - row.y)).toBeLessThan(4);
    }
    if (theme === "light" && ratio === 1) {
      await page.evaluate(() => { window.indexExport = []; });
      await page.getByRole("button", { name: "Add to journal", exact: true }).click();
      await page.getByRole("dialog", { name: "Attach current chart", exact: true }).getByRole("button", { name: "Exit Screen", exact: true }).click();
      await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
      expect(await page.evaluate(() => window.indexExport.some(row => row.text === "Index capture"))).toBe(true);
      expect(await page.evaluate(() => window.indexExport.some(row => row.text === "Stock capture"))).toBe(true);
      await page.reload();
      expect((await saved(page)).evidence).toHaveLength(1);
      expect((await saved(page)).drawings.find(d => d.id === index.id)?.target).toEqual(index.target);
    }
    expect(errors).toEqual([]);
  });
});
