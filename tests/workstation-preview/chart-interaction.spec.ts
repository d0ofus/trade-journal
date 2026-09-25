import { expect, test, type Page } from "@playwright/test";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { defaultPreferences, type Drawing, type TradeDocument, type WorkspacePreferences } from "../../src/lib/workstation/types";

const prefKey = "execution-lab:workstation:preferences:demo:v1", docKey = DEMO_PREFIX + demoTrades[0].id;
declare global { interface Window { interactionText: { text: string; x: number; y: number }[]; interactionExport: string[]; interactionRay?: { x: number; y: number }; } }
async function open(page: Page, drawings: Drawing[] = [], overrides: Partial<WorkspacePreferences> = {}) {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => route.abort());
  await page.addInitScript(({ doc, prefs, prefKey, docKey }) => {
    if (!localStorage.getItem(prefKey)) localStorage.setItem(prefKey, JSON.stringify(prefs));
    if (!localStorage.getItem(docKey)) localStorage.setItem(docKey, JSON.stringify(doc));
    window.interactionText = []; window.interactionExport = [];
    const proto = CanvasRenderingContext2D.prototype, clear = proto.clearRect, fill = proto.fillText, move = proto.moveTo, line = proto.lineTo;
    const starts = new WeakMap<CanvasRenderingContext2D, { x: number; y: number }>();
    proto.clearRect = function(x, y, w, h) { if (this.canvas.classList.contains("ws-chart-overlay")) window.interactionText = []; clear.call(this, x, y, w, h); };
    proto.fillText = function(text, x, y, width) {
      if (this.canvas.classList.contains("ws-chart-overlay")) { const box = this.canvas.getBoundingClientRect(); window.interactionText.push({ text, x: box.left + x, y: box.top + y }); }
      else if (!this.canvas.isConnected) window.interactionExport.push(text);
      if (width === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, width);
    };
    proto.moveTo = function(x, y) { starts.set(this, { x, y }); move.call(this, x, y); };
    proto.lineTo = function(x, y) { const a = starts.get(this); if (this.canvas.classList.contains("ws-chart-overlay") && this.strokeStyle === "#d0ab12" && a && a.y === y && x - a.x > 100) { const b = this.canvas.getBoundingClientRect(); window.interactionRay = { x: b.left + a.x + 70, y: b.top + y }; } line.call(this, x, y); };
  }, { doc: { ...initialDemoDocument(demoTrades[0]), drawings, evidence: [] }, prefs: { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m" }], journal: true, labels: "hidden", ...overrides }, prefKey, docKey });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-visible-from", /\d+/);
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, docKey);
const prefs = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as WorkspacePreferences, prefKey);
const baseDrawing = () => ({ ...initialDemoDocument(demoTrades[0]).drawings[0], points: [{ time: demoTrades[0].openTime, price: demoTrades[0].entry }] });

test("execution details start compact and expose diagnostics on demand", async ({ page }) => {
  const errors = await open(page, [], { labels: "labels" });
  const marker = () => page.evaluate(() => window.interactionText.find(t => /^1\s+Buy/.test(t.text)));
  await expect.poll(marker).toBeTruthy();
  const pos = (await marker())!; await page.mouse.click(pos.x + 25, pos.y - 5);
  const dialog = page.getByRole("dialog", { name: "Execution details", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Provider / feed", { exact: true })).not.toBeVisible();
  await dialog.getByText("More details", { exact: true }).click();
  await expect(dialog.getByText("Provider / feed", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close execution details" }).click();
  await page.mouse.click(pos.x + 25, pos.y - 5);
  await expect(dialog.getByText("Provider / feed", { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("ray body drags time and price and only reveals an already-open drawing list", async ({ page }) => {
  const ray: Drawing = { ...baseDrawing(), id: "ray-body", tool: "ray", text: "Movable ray", color: "#d0ab12" };
  const others: Drawing[] = Array.from({ length: 25 }, (_, i) => ({ ...baseDrawing(), id: `hidden-${i}`, tool: "horizontal", hidden: true, text: `Hidden ${i}` }));
  const errors = await open(page, [...others, ray], { bottomCollapsed: true });
  await expect.poll(() => page.evaluate(() => window.interactionRay)).toBeTruthy();
  const point = (await page.evaluate(() => window.interactionRay))!;
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 55, point.y - 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).drawings.at(-1)!.points[0].price).not.toBe(ray.points[0].price);
  const moved = (await saved(page)).drawings.at(-1)!;
  expect(moved.points[0].time).not.toBe(ray.points[0].time);
  expect((await prefs(page)).bottomCollapsed).toBe(true);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Control+z");
  await expect.poll(async () => (await saved(page)).drawings.at(-1)!.points).toEqual(ray.points);
  const restored = (await page.evaluate(() => window.interactionRay))!;
  await page.mouse.click(restored.x, restored.y);
  await page.getByRole("button", { name: "Show Drawings", exact: true }).click();
  await expect.poll(() => page.locator(".ws-object-list").evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await page.locator(".ws-object-list").evaluate(e => { e.scrollTop = 0; });
  const selectedAgain = (await page.evaluate(() => window.interactionRay))!;
  await page.mouse.click(selectedAgain.x, selectedAgain.y);
  await expect.poll(() => page.locator(".ws-object-list").evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await page.getByTitle("Lock drawing", { exact: true }).click();
  const locked = (await page.evaluate(() => window.interactionRay))!;
  await page.mouse.move(locked.x, locked.y); await page.mouse.down(); await page.mouse.move(locked.x + 30, locked.y + 20); await page.mouse.up();
  expect((await saved(page)).drawings.at(-1)!.points).toEqual(ray.points);
  expect(errors).toEqual([]);
});

test("pin hover, keyboard access, editing and opt-in capture notes", async ({ page }) => {
  const pin: Drawing = { ...baseDrawing(), id: "test-pin", tool: "pin", text: "Hover-only pin note" };
  const errors = await open(page, [pin]);
  const target = page.getByRole("button", { name: "Pin: Hover-only pin note", exact: true });
  await expect(target).toBeVisible();
  expect(await page.evaluate(() => window.interactionText.map(t => t.text))).not.toContain(pin.text);
  await target.hover(); await expect.poll(() => page.evaluate(() => window.interactionText.map(t => t.text))).toContain(pin.text);
  await page.mouse.move(10, 10); await expect.poll(() => page.evaluate(() => window.interactionText.map(t => t.text))).not.toContain(pin.text);
  await target.dblclick(); await expect(page.getByLabel("Annotation text", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Close annotation properties", exact: true }).click();
  await target.focus(); await expect.poll(() => page.evaluate(() => window.interactionText.map(t => t.text))).toContain(pin.text);
  await target.press("F2"); await expect(page.getByLabel("Annotation text", { exact: true })).toBeFocused();
  await page.getByLabel("Annotation text", { exact: true }).fill("Updated pin note");
  await expect.poll(async () => (await saved(page)).drawings[0].text).toBe("Updated pin note");
  await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Take your review with you", exact: true });
  let download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Active chart PNG", exact: true }).click(); await download;
  expect(await page.evaluate(() => window.interactionExport)).not.toContain("Updated pin note");
  await dialog.getByLabel("Include pin notes in captures").check();
  download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Active chart PNG", exact: true }).click(); await download;
  expect(await page.evaluate(() => window.interactionExport)).toContain("Updated pin note");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload(); expect((await prefs(page)).capturePinNotes).toBe(true);
  expect((await saved(page)).drawings[0].tool).toBe("pin");
  expect(errors).toEqual([]);
});

test("focus journal is resizable and temporary; panel shortcuts open without stealing typing", async ({ page }) => {
  const errors = await open(page);
  const originalJournal = (await page.locator(".ws-journal-content").boundingBox())!;
  await page.mouse.move(originalJournal.x - 2, originalJournal.y + originalJournal.height / 2);
  await page.mouse.down(); await page.mouse.move(originalJournal.x - 50, originalJournal.y + originalJournal.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await prefs(page)).dock).toBeTruthy();
  const normalWidth = (await page.locator(".ws-journal-content").boundingBox())!.width;
  const chart = page.locator(".ws-chart"); await chart.focus();
  const normal = (await prefs(page)).dock;
  await page.keyboard.press("Shift+F"); await expect(page.getByRole("button", { name: "Hide focus journal" })).toBeVisible();
  await expect(page.locator(".ws-journal-content")).toBeVisible();
  const journalBox = (await page.locator(".ws-journal-content").boundingBox())!;
  await page.mouse.move(journalBox.x - 2, journalBox.y + journalBox.height / 2);
  await page.mouse.down(); await page.mouse.move(journalBox.x - 90, journalBox.y + journalBox.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await page.locator(".ws-journal-content").boundingBox())!.width).toBeGreaterThan(journalBox.width + 40);
  expect((await prefs(page)).focusMode).toBe(true);
  expect((await prefs(page)).dock).toEqual(normal);
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).fill("Written in Focus mode");
  await expect.poll(async () => (await saved(page)).review.takeaway).toContain("Written in Focus mode");
  await page.getByRole("button", { name: "Hide focus journal" }).click();
  await expect(page.locator(".ws-journal-content")).not.toBeVisible();
  await chart.focus(); await page.keyboard.press("Shift+F");
  await expect(page.locator(".ws-journal-content")).toBeVisible();
  await expect.poll(async () => (await page.locator(".ws-journal-content").boundingBox())!.width).toBe(normalWidth);
  await expect(page.getByRole("textbox", { name: "Takeaways", exact: true })).toContainText("Written in Focus mode");
  // Use the visible shortcut editor so the test follows its actual storage namespace.
  await chart.focus(); await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog.getByText("Show Drawings", { exact: true })).toBeVisible();
  const binding = dialog.getByRole("button", { name: "Set shortcut for Show Drawings", exact: true });
  await binding.click(); await binding.press("Shift+D");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).press("Shift+D");
  await expect(page.locator(".ws-object-list")).not.toBeVisible();
  await chart.focus(); await page.keyboard.press("Shift+F"); await expect(chart).toBeFocused(); await page.keyboard.press("Shift+D");
  await expect(page.locator(".ws-object-list")).toBeVisible();
  expect((await prefs(page)).focusMode).toBe(false);
  expect(errors).toEqual([]);
});

test("replay allows journal edits, workspace captures, image viewing and peer evidence without future candles", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const text = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await text.fill("Editable during replay");
  await expect.poll(async () => (await saved(page)).review.takeaway).toContain("Editable during replay");
  await page.getByRole("button", { name: "Attach current chart to Takeaways", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  const evidence = (await saved(page)).evidence[0]; expect(evidence.replayAt).toBeGreaterThan(0);
  let downloads = 0; page.on("download", () => downloads++);
  await page.locator(".ws-section-preview").getByRole("button", { name: `View ${evidence.name}`, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: `Image preview: ${evidence.name}` });
  await expect(viewer).toBeVisible(); expect(downloads).toBe(0);
  await expect(viewer.getByRole("button", { name: "Close image preview" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(viewer.getByRole("button", { name: "Fit", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(viewer.getByRole("button", { name: "100%", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(viewer.getByRole("button", { name: `Download ${evidence.name}` })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(viewer.getByRole("button", { name: "Close image preview" })).toBeFocused();
  const download = page.waitForEvent("download"); await viewer.getByRole("button", { name: `Download ${evidence.name}` }).click(); await download;
  await page.keyboard.press("Escape"); await expect(viewer).toHaveCount(0);
  await expect(page.locator(".ws-section-preview").getByRole("button", { name: `View ${evidence.name}`, exact: true })).toBeFocused();
  await page.locator("summary").filter({ hasText: /^Peers$/ }).click();
  await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  const peers = page.getByRole("dialog", { name: "Peer comparison", exact: true });
  await expect(peers.getByRole("note")).toContainText("Replay paused");
  await expect(peers.locator('[data-peer-symbol="PEER01"]').getByRole("button", { name: "Attach comparison", exact: true })).toBeEnabled();
  for (const interval of ["5m", "1h", "1d", "5m"]) {
    await peers.getByLabel("Peer timeframe").selectOption(interval);
    await expect(peers.locator('[data-peer-symbol="PEER01"] [data-peer-canvas]')).toHaveAttribute("data-replay-at", String(evidence.replayAt));
    const stamps = await peers.locator("[data-peer-canvas]").evaluateAll(elements => elements.map(e => [Number((e as HTMLElement).dataset.lastCandleTime), Number((e as HTMLElement).dataset.replayAt)]));
    expect(stamps.every(([last, cutoff]) => last < cutoff)).toBe(true);
  }
  await peers.locator('[data-peer-symbol="PEER01"]').getByRole("button", { name: "Attach comparison", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(2);
  const peer = (await saved(page)).evidence[1]; expect(peer.replayAt).toBe(evidence.replayAt); expect(peer.peerCapture?.replayAt).toBe(evidence.replayAt);
  await peers.getByRole("button", { name: "Close peer comparison" }).click();
  await page.screenshot({ path: "test-results/chart-interaction-replay.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("touch pins and the Focus journal toggle work on narrow screens", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const pin: Drawing = { ...baseDrawing(), id: "touch-pin", tool: "pin", text: "Touch pin note" };
    const errors = await open(page, [pin]);
    const target = page.getByRole("button", { name: "Pin: Touch pin note", exact: true });
    await expect(target).toBeVisible(); await target.tap();
    await expect.poll(() => page.evaluate(() => window.interactionText.map(t => t.text))).toContain("Touch pin note");
    await page.getByRole("button", { name: "Close annotation properties", exact: true }).tap();
    await page.getByRole("button", { name: "Chart focus", exact: true }).tap();
    await page.getByRole("button", { name: "Show focus journal", exact: true }).tap();
    await expect(page.locator(".ws-journal-content")).toBeVisible();
    expect((await prefs(page)).focusMode).toBe(true);
    await page.getByRole("button", { name: "Hide focus journal", exact: true }).tap();
    await expect(page.locator(".ws-chart")).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("volume appearance and bright journal text persist without changing candle dates", async ({ page }) => {
  const errors = await open(page);
  const chart = page.locator(".ws-chart"), range = await chart.getAttribute("data-visible-from");
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await dialog.getByLabel("Rising volume colour", { exact: true }).fill("#ff00ff");
  await dialog.getByLabel("Rising volume transparency", { exact: true }).fill("0");
  await dialog.getByLabel("Falling volume colour", { exact: true }).fill("#00ffff");
  await dialog.getByLabel("Average volume line colour", { exact: true }).fill("#ffffff");
  await dialog.getByLabel("Average volume line transparency", { exact: true }).fill("25");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(chart).toHaveAttribute("data-visible-from", range!);
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  expect(await page.getByRole("textbox", { name: "Takeaways", exact: true }).evaluate(e => getComputedStyle(e).color)).toBe("rgb(241, 245, 249)");
  await expect(chart.locator("[data-ohlc-percent]")).toHaveText(/[+−\-]?\d+\.\d{2}%/);
  await page.reload();
  expect((await prefs(page)).volumeStyle).toMatchObject({ up: { color: "#ff00ff", transparency: 0 }, down: { color: "#00ffff" }, average: { color: "#ffffff", transparency: 25 } });
  expect(errors).toEqual([]);
});
