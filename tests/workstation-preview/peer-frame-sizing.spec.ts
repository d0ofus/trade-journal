import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { defaultPreferences, type Drawing, type TradeDocument } from "../../src/lib/workstation/types";
import type { PeerFrameSize } from "../../src/lib/workstation/peer-arrangement";

const prefKey = "execution-lab:workstation:preferences:demo:v1", docKey = DEMO_PREFIX + demoTrades[0].id;
type TextRow = { text: string; x: number; y: number; symbol?: string };
declare global { interface Window { peerLiveRows: TextRow[]; peerExportRows: TextRow[]; } }
async function open(page: Page, options: { theme?: "dark" | "light"; sizes?: Record<string, PeerFrameSize>; note?: boolean } = {}) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  const doc = initialDemoDocument(demoTrades[0]);
  const note: Drawing = { id: "resize-note", tool: "text", text: "Resized peer note", points: [{ time: Math.floor(demoTrades[0].openTime / 86400) * 86400 - 3 * 86400, price: 167 }], width: 1, color: "#e879f9", dashed: false, hidden: false, locked: false, panel: null, createdAt: 0, noteWidth: 160 };
  doc.comparison = { drawings: options.note ? { NVDA: [note] } : {}, arrangements: { "demo-peers": { order: [], hidden: [], sizes: options.sizes } } };
  await page.addInitScript(({ prefs, prefKey, docKey, doc }) => {
    if (!localStorage.getItem(prefKey)) localStorage.setItem(prefKey, JSON.stringify(prefs));
    if (!localStorage.getItem(docKey)) localStorage.setItem(docKey, JSON.stringify(doc));
    window.peerLiveRows = []; window.peerExportRows = [];
    const prototype = CanvasRenderingContext2D.prototype, fill = prototype.fillText, clear = prototype.clearRect;
    prototype.clearRect = function(x, y, w, h) { if (this.canvas.classList.contains("ws-peer-drawing-canvas")) { const symbol = this.canvas.closest("[data-peer-symbol]")?.getAttribute("data-peer-symbol"); window.peerLiveRows = window.peerLiveRows.filter(row => row.symbol !== symbol); } clear.call(this, x, y, w, h); };
    prototype.fillText = function(text, x, y, maximum) {
      const matrix = this.getTransform(), row = { text, x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
      if (this.canvas.classList.contains("ws-peer-drawing-canvas")) window.peerLiveRows.push({ ...row, symbol: this.canvas.closest("[data-peer-symbol]")?.getAttribute("data-peer-symbol") ?? undefined, x: row.x / devicePixelRatio, y: row.y / devicePixelRatio });
      else if (!this.canvas.isConnected) window.peerExportRows.push(row);
      if (maximum === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maximum);
    };
  }, { prefs: { ...defaultPreferences(), journal: true, theme: options.theme ?? "dark", magnet: false, panels: [{ id: "chart-1", interval: "1d", session: "regular" }] }, prefKey, docKey, doc });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-from", /\d+/);
  if (await page.locator(".ws-mobile-tabs").isVisible()) await page.locator(".ws-mobile-tabs").getByRole("button", { name: "Journal", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Peers$/ }).click();
  await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Peer comparison", exact: true });
  await expect(dialog.locator('[data-peer-symbol="PEER01"]').getByRole("button", { name: "Attach current chart", exact: true })).toBeEnabled();
  return { dialog, errors };
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, docKey);
const chart = (dialog: Locator, symbol: string) => dialog.locator(`[data-peer-symbol="${symbol}"] [data-peer-canvas]`);
async function range(plot: Locator) { return { from: Number(await plot.getAttribute("data-visible-from")), to: Number(await plot.getAttribute("data-visible-to")) }; }
async function drag(page: Page, dialog: Locator, symbol: string, dx: number, dy: number, cancel = false) {
  const handle = dialog.getByRole("button", { name: `Resize ${symbol} frame`, exact: true }); await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("independent resizing preserves interval and right edge, links dates and saves dimensions only", async ({ page }) => {
  const { dialog, errors } = await open(page), source = chart(dialog, "PEER01"), primary = chart(dialog, "NVDA");
  const before = await range(source), box = (await source.boundingBox())!;
  await drag(page, dialog, "PEER01", 230, 90);
  await expect.poll(async () => (await range(source)).from).toBeLessThan(before.from);
  await expect.poll(async () => (await range(source)).to).toBe(before.to);
  await expect.poll(async () => (await range(primary)).from).toBe((await range(source)).from);
  await expect(dialog.getByLabel("Peer timeframe")).toHaveValue("1d");
  expect((await source.boundingBox())!.width).toBeGreaterThan(box.width + 200);
  await expect.poll(async () => (await saved(page)).comparison?.arrangements["demo-peers"].sizes?.PEER01.height).toBe(418);
  await expect(dialog.locator('[data-peer-symbol="PEER01"]').getByRole("button", { name: "Attach current chart", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Link dates on", exact: true }).click();
  const mainRange = await range(primary), own = await range(source);
  await drag(page, dialog, "PEER01", -100, 0);
  await expect.poll(async () => (await range(source)).from).toBeGreaterThan(own.from);
  expect(await range(primary)).toEqual(mainRange);
  const committedWidth = (await dialog.locator('[data-peer-symbol="PEER01"]').boundingBox())!.width;
  await expect.poll(async () => (await saved(page)).comparison!.arrangements["demo-peers"].sizes!.PEER01.width).toBe(committedWidth);
  const size = (await saved(page)).comparison!.arrangements["demo-peers"].sizes!.PEER01;
  await dialog.getByRole("button", { name: "Close peer comparison" }).click();
  await page.reload(); await page.locator("summary").filter({ hasText: /^Peers$/ }).click(); await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  const restored = (await dialog.locator('[data-peer-symbol="PEER01"]').boundingBox())!;
  expect(restored.width).toBeCloseTo(size.width, 0); expect(restored.height).toBe(size.height);
  expect(errors).toEqual([]);
});

test("height-only changes, numeric confirmation, keyboard resizing and Escape cancellation", async ({ page }) => {
  const { dialog, errors } = await open(page), primary = chart(dialog, "NVDA"), before = await range(primary);
  await drag(page, dialog, "NVDA", 0, 100);
  expect(await range(primary)).toEqual(before);
  const handle = dialog.getByRole("button", { name: "Resize NVDA frame", exact: true });
  await handle.focus(); await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await saved(page)).comparison?.arrangements["demo-peers"].sizes?.NVDA.height).toBe(448);
  await dialog.getByRole("button", { name: "Arrange", exact: true }).click();
  const height = dialog.getByLabel("NVDA frame height"); await height.fill("600");
  expect((await primary.boundingBox())!.height).toBeLessThan(500);
  await height.press("Enter");
  await expect.poll(async () => (await saved(page)).comparison?.arrangements["demo-peers"].sizes?.NVDA.height).toBe(600);
  await dialog.getByRole("button", { name: "Close comparison controls" }).click();
  const frame = (await dialog.locator('[data-peer-symbol="NVDA"]').boundingBox())!, dates = await range(primary);
  await drag(page, dialog, "NVDA", 200, -80, true);
  await expect.poll(async () => (await dialog.locator('[data-peer-symbol="NVDA"]').boundingBox())!.width).toBe(frame.width);
  expect(await range(primary)).toEqual(dates);
  expect((await saved(page)).comparison?.arrangements["demo-peers"].sizes?.NVDA.height).toBe(600);
  expect(errors).toEqual([]);
});

test("sizes survive order, search, hide and restore; resetting sizes preserves peer arrangement", async ({ page }) => {
  const { dialog, errors } = await open(page, { sizes: { PEER01: { width: 700, height: 420 } } });
  await dialog.getByRole("button", { name: "Arrange", exact: true }).click();
  const row = dialog.locator(".ws-peer-arrangement-list li").filter({ has: page.locator("strong", { hasText: /^PEER01$/ }) });
  await row.getByRole("button", { name: "Move PEER01 down" }).click(); await row.getByRole("button", { name: "Hide", exact: true }).click();
  expect((await saved(page)).comparison!.arrangements["demo-peers"].sizes!.PEER01).toEqual({ width: 700, height: 420 });
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  expect((await dialog.locator('[data-peer-symbol="PEER01"]').boundingBox())!.height).toBe(420);
  await dialog.getByRole("button", { name: "Close comparison controls" }).click();
  await dialog.getByLabel("Search peers").fill("PEER02"); await expect(chart(dialog, "PEER01")).toHaveCount(0); await dialog.getByLabel("Search peers").fill("");
  await dialog.getByRole("button", { name: "Arrange", exact: true }).click(); await row.getByRole("button", { name: "Hide", exact: true }).click();
  await expect.poll(async () => (await saved(page)).comparison!.arrangements["demo-peers"].hidden).toContain("PEER01");
  const before = (await saved(page)).comparison!.arrangements["demo-peers"];
  await dialog.getByRole("button", { name: "Reset frame sizes", exact: true }).click();
  await expect.poll(async () => (await saved(page)).comparison!.arrangements["demo-peers"]).toEqual({ order: before.order, hidden: before.hidden });
  expect(errors).toEqual([]);
});

test("responsive clamping preserves desktop sizes and the primary remains available for offscreen paired capture", async ({ page }) => {
  const { dialog, errors } = await open(page, { sizes: { NVDA: { width: 900, height: 400 }, PEER01: { width: 700, height: 420 } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await dialog.locator('[data-peer-symbol="NVDA"]').boundingBox())!.width).toBeLessThan(390);
  expect((await saved(page)).comparison!.arrangements["demo-peers"].sizes!.NVDA.width).toBe(900);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(async () => (await dialog.locator('[data-peer-symbol="NVDA"]').boundingBox())!.width).toBe(900);
  await dialog.locator(".ws-peer-scroll").evaluate(node => { node.scrollTop = node.scrollHeight; });
  const last = dialog.locator('[data-peer-symbol="PEER50"]');
  await expect(last.getByRole("button", { name: "Attach comparison", exact: true })).toBeEnabled();
  expect(await dialog.locator("[data-peer-canvas]").count()).toBeLessThanOrEqual(14);
  await last.getByRole("button", { name: "Attach comparison", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.at(-1)?.peerCapture?.symbols).toEqual(["NVDA", "PEER50"]);
  await dialog.getByRole("button", { name: "Attach visible charts", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm attachment to Peers", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("complementary")).toContainText("NVDA: not fully visible");
  expect(errors).toEqual([]);
});

test("resizing respects Before entry, replay and timeframe changes without changing workspace charts", async ({ page }) => {
  const { dialog, errors } = await open(page), primary = chart(dialog, "NVDA");
  const workspace = await page.locator(".ws-chart").getAttribute("data-visible-from");
  await dialog.getByRole("button", { name: "Before entry off", exact: true }).click();
  await expect.poll(async () => Number(await primary.getAttribute("data-last-candle-time"))).toBeLessThan(demoTrades[0].openTime);
  const before = await range(primary);
  await drag(page, dialog, "NVDA", 80, 0);
  await expect.poll(async () => (await range(primary)).to).toBe(before.to);
  await dialog.getByLabel("Peer timeframe").selectOption("1h");
  await expect(dialog.locator('[data-peer-symbol="NVDA"]').getByRole("button", { name: "Attach current chart", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Match workspace", exact: true }).click();
  await expect(dialog.getByLabel("Peer timeframe")).toHaveValue("1d");
  await dialog.getByRole("button", { name: "Close peer comparison", exact: true }).click();
  expect(await page.locator(".ws-chart").getAttribute("data-visible-from")).toBe(workspace);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  await expect(dialog.getByRole("note")).toContainText("Replay paused");
  await expect(primary).toHaveAttribute("data-replay-at", /\d+/);
  await drag(page, dialog, "NVDA", 80, 40);
  const cutoff = Number(await primary.getAttribute("data-replay-at"));
  expect((await range(primary)).to).toBeLessThanOrEqual(cutoff);
  const stamps = await dialog.locator("[data-peer-canvas]").evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.lastCandleTime)));
  expect(stamps.every(time => time < cutoff)).toBe(true);
  expect(errors).toEqual([]);
});

test("touch dragging resizes a narrow frame without overwriting its saved desktop width", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  try {
    const { dialog, errors } = await open(page, { sizes: { NVDA: { width: 900, height: 260 } } });
    const handle = dialog.getByRole("button", { name: "Resize NVDA frame", exact: true }); await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!, session = await context.newCDPSession(page);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (const dy of [15, 30, 45, 60]) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await saved(page)).comparison!.arrangements["demo-peers"].sizes!.NVDA.height).toBe(320);
    expect((await saved(page)).comparison!.arrangements["demo-peers"].sizes!.NVDA.width).toBe(900);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("capture freezes sizing, arrangement and chart interaction", async ({ page }) => {
  const { dialog, errors } = await open(page);
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => document.querySelector('[style*="-100000px"]') ? -window.setTimeout(() => callback(performance.now()), 180) : raf(callback);
    window.cancelAnimationFrame = id => { if (id < 0) clearTimeout(-id); else cancel(id); };
  });
  const scroll = dialog.locator(".ws-peer-scroll"), top = await scroll.evaluate(node => node.scrollTop);
  await dialog.locator('[data-peer-symbol="NVDA"]').getByRole("button", { name: "Attach current chart", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Resize NVDA frame", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Arrange", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Peer timeframe")).toBeDisabled();
  const box = (await chart(dialog, "NVDA").boundingBox())!; await page.mouse.move(box.x + 80, box.y + 80); await page.mouse.wheel(0, 300);
  expect(await scroll.evaluate(node => node.scrollTop)).toBe(top);
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  await expect(dialog.getByRole("button", { name: "Resize NVDA frame", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) for (const dpr of [1, 1.25, 2]) test(`resized drawings and visible capture align in ${theme} at DPR ${dpr}`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr, baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  try {
    const { dialog, errors } = await open(page, { theme, note: true, sizes: { NVDA: { width: 600, height: 400 }, PEER01: { width: 500, height: 350 } } });
    await drag(page, dialog, "NVDA", 100, 60);
    await expect.poll(() => page.evaluate(() => window.peerLiveRows.some(row => row.text === "Resized peer note"))).toBe(true);
    await expect(dialog.locator('[data-peer-symbol="NVDA"]').getByRole("button", { name: "Attach current chart", exact: true })).toBeEnabled();
    await page.evaluate(() => { window.peerExportRows = []; });
    await dialog.locator('[data-peer-symbol="NVDA"]').getByRole("button", { name: "Attach current chart", exact: true }).click();
    await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
    const rows = await page.evaluate(() => ({ live: window.peerLiveRows.find(row => row.text === "Resized peer note")!, output: window.peerExportRows.find(row => row.text === "Resized peer note")! }));
    const plot = (await chart(dialog, "NVDA").boundingBox())!, image = (await saved(page)).evidence[0].asset!;
    const scale = image.width / plot.width;
    expect(Math.abs(rows.output.x / scale - rows.live.x)).toBeLessThan(2);
    expect(Math.abs(rows.output.y / scale - 43 - rows.live.y)).toBeLessThan(2);
    const png = Buffer.from(await page.evaluate(async id => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("execution-lab-private-images"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try {
        const blob = await new Promise<Blob>((resolve, reject) => { const request = db.transaction("originals").objectStore("originals").get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      } finally { db.close(); }
    }, image.id));
    await writeFile(info.outputPath(`resized-peer-${theme}-${dpr}.png`), png);
    await dialog.getByRole("button", { name: "Attach visible charts", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm attachment to Peers", exact: true }).click();
    await expect.poll(async () => (await saved(page)).evidence.length).toBe(2);
    const capture = (await saved(page)).evidence[1].peerCapture!;
    expect(capture.arrangement!.find(rect => rect.symbol === "NVDA")).toMatchObject({ width: plot.width, height: plot.height });
    expect(capture.ranges.NVDA).toEqual(await range(chart(dialog, "NVDA")));
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
