import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { showTakeaways } from "./review-helpers";

const preferenceKey = "execution-lab:workstation:preferences:demo:v1";
const documentKey = DEMO_PREFIX + demoTrades[0].id;
async function open(page: Page, panels = 1) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ preferences, key, panels }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ ...preferences, labels: "hidden", journal: panels > 1, panels: ["5m", "1h"].slice(0, panels).map((interval, i) => ({ id: `chart-${i + 1}`, interval })) }));
  }, { preferences: defaultPreferences(), key: preferenceKey, panels });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-visible-from", /\d+/);
  return { errors, requests };
}

test("index shortcut targets the focused chart, remembers QQQ and supports remapping and typing exclusions", async ({ page }) => {
  const { errors, requests } = await open(page, 2);
  const first = page.locator('[data-chart-id="chart-1"]'), second = page.locator('[data-chart-id="chart-2"]');
  const comparison = second.getByLabel("Comparison chart-2", { exact: true });
  await second.focus(); await page.keyboard.press("Shift+I");
  await expect(comparison).toHaveValue("SPY");
  await expect(first.getByLabel("Comparison chart-1", { exact: true })).toHaveValue("off");
  await comparison.selectOption("QQQ"); await second.focus(); await page.keyboard.press("Shift+I");
  await expect(comparison).toHaveValue("off");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("execution-lab:workstation:demo:v1:view:demo-nvda"))).toContain('"lastBenchmark":"QQQ"');
  await page.reload(); await second.focus(); await page.keyboard.press("Shift+I");
  await expect(comparison).toHaveValue("QQQ");
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  await page.getByRole("button", { name: /Keyboard shortcuts/ }).click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  const binding = dialog.getByRole("button", { name: "Set shortcut for Toggle index comparison", exact: true });
  await expect(binding).toContainText("Shift + I");
  await binding.click(); await binding.press("Shift+Y");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(comparison).toHaveAttribute("title", /Shift \+ Y/);
  await second.focus(); await page.keyboard.press("Shift+Y"); await expect(comparison).toHaveValue("off");
  await showTakeaways(page);
  const note = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await note.fill(""); await note.press("Shift+Y"); await expect(note).toHaveText("Y");
  await expect(comparison).toHaveValue("off");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("custom comparison colour survives reload and is used in live and exported candles", async ({ page }, info) => {
  const { errors, requests } = await open(page);
  const chart = page.locator(".ws-chart");
  await chart.getByLabel("Comparison chart-1", { exact: true }).selectOption("SPY");
  await expect(chart.locator(".ws-benchmark-legend")).toContainText("Independent scale");
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await dialog.getByLabel("Index comparison colour", { exact: true }).fill("#e879f9");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(chart.locator(".ws-benchmark-legend")).toHaveCSS("color", "rgb(232, 121, 249)");
  for (const light of [false, true]) {
    if (light) await page.getByTitle("Appearance", { exact: true }).click();
    await expect.poll(() => chart.locator(".ws-chart-canvas canvas").evaluateAll(canvases => canvases.reduce((count, canvas) => {
      const c = canvas as HTMLCanvasElement, data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 232 && data[i + 1] === 121 && data[i + 2] === 249) count++;
      return count;
    }, 0))).toBeGreaterThan(20);
    await chart.getByRole("button", { name: "Export chart-1", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    const file = await download; const path = info.outputPath(`comparison-colour-${light ? "light" : "dark"}.png`); await file.saveAs(path);
    const pixels = await page.evaluate(async encoded => {
      const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
      // Exclude the header to check the candles themselves.
      const data = ctx.getImageData(0, 100, canvas.width, canvas.height - 100).data; let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] === 232 && data[i + 1] === 121 && data[i + 2] === 249) count++;
      return count;
    }, (await readFile(path)).toString("base64"));
    expect(pixels).toBeGreaterThan(20);
    await page.getByRole("dialog").getByRole("button", { name: "Close dialog" }).click();
  }
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  await dialog.getByRole("button", { name: "Reset comparison colour", exact: true }).click();
  await expect(dialog.getByLabel("Index comparison colour", { exact: true })).toHaveValue("#2563eb");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

type NotePaint = { x: number; y: number; tipX: number; tipY: number };
test("legacy text notes gain draggable boxes and independent tips, with undo, reload and locked protection", async ({ page }, info) => {
  const doc = initialDemoDocument(demoTrades[0]);
  doc.drawings = doc.drawings.filter(d => d.tool === "text"); doc.drawings[0].text = "Draggable note";
  await page.addInitScript(({ key, doc }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(doc));
    const lastMove = new WeakMap<CanvasRenderingContext2D, { x: number; y: number }>();
    const move = CanvasRenderingContext2D.prototype.moveTo;
    CanvasRenderingContext2D.prototype.moveTo = function(x, y) { lastMove.set(this, { x, y }); move.call(this, x, y); };
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (text === "Draggable note") {
        const rect = this.canvas.getBoundingClientRect();
        const tip = lastMove.get(this)!;
        (window as unknown as { notePaint: NotePaint }).notePaint = { x: rect.left + x + 20, y: rect.top + y - 4, tipX: rect.left + tip.x, tipY: rect.top + tip.y };
      }
      if (maxWidth === undefined) original.call(this, text, x, y); else original.call(this, text, x, y, maxWidth);
    };
  }, { key: documentKey, doc });
  const { errors } = await open(page);
  const saved = () => page.evaluate(key => (JSON.parse(localStorage.getItem(key)!) as TradeDocument).drawings[0], documentKey);
  const location = () => page.evaluate(() => (window as unknown as { notePaint: NotePaint }).notePaint);
  await expect.poll(location).toBeTruthy();
  const initial = await saved(), position = await location();
  await page.mouse.move(position.x, position.y); await page.mouse.down();
  await page.mouse.move(position.x + 150, position.y + 50, { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await saved()).points.length).toBe(2);
  const extended = await saved();
  expect(extended.points[0]).toEqual(initial.points[0]); expect(extended.points[1].time).toBeGreaterThan(initial.points[0].time);
  const right = await location();
  await page.mouse.move(right.x, right.y); await page.mouse.down();
  await page.mouse.move(right.x - 350, right.y + 30, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => (await saved()).points[1].time).toBeLessThan(initial.points[0].time);
  const left = await saved(); expect(left.points[0]).toEqual(initial.points[0]);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved()).points).toEqual(extended.points);
  await page.keyboard.press("Control+Shift+z"); await expect.poll(async () => (await saved()).points).toEqual(left.points);
  await page.reload(); await expect.poll(location).toBeTruthy(); expect((await saved()).points).toEqual(left.points);
  const relocated = await location();
  await page.mouse.move(relocated.tipX, relocated.tipY); await page.mouse.down();
  await page.mouse.move(relocated.tipX + 60, relocated.tipY + 25, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await saved()).points[0]).not.toEqual(left.points[0]);
  const movedTip = await saved(); expect(movedTip.points[1]).toEqual(left.points[1]);
  await page.getByTitle("Lock drawing", { exact: true }).click();
  await expect.poll(async () => (await saved()).locked).toBe(true);
  const locked = await location();
  await page.mouse.move(locked.x, locked.y); await page.mouse.down();
  await page.mouse.move(locked.x + 100, locked.y + 30, { steps: 10 }); await page.mouse.up();
  expect((await saved()).points).toEqual(movedTip.points);
  await page.screenshot({ path: info.outputPath("text-note-left.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("text-note-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
