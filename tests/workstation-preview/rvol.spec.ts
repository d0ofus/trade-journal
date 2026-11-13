import { expect, test } from "@playwright/test";
import { openRvol, rvolPrefKey } from "./rvol-fixture";
import { demoTrades } from "../../src/lib/workstation/demo";
import { mkdir, writeFile } from "node:fs/promises";

test("starts hidden, toggles by keyboard, keeps dates, and remembers visibility", async ({ page }) => {
  const { errors, requests, fills } = await openRvol(page);
  const chart = page.locator(".ws-chart"), toggle = page.getByRole("button", { name: "Show relative volume", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false"); await expect(chart.locator(".ws-rvol-legend")).toHaveCount(0);
  expect(requests.filter(r => r.purpose === "indicator")).toHaveLength(0);
  const before = [await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")];
  await toggle.focus(); await page.keyboard.press("Space");
  await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/); await expect(chart).toHaveAttribute("data-rvol-pane-top", /\d+/);
  expect(fills.filter(p => p === "indicator")).toHaveLength(0);
  expect([await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")]).toEqual(before);
  await toggle.click(); await expect(chart.locator(".ws-rvol-legend")).toHaveCount(0);
  const count = requests.length; await page.waitForTimeout(500); expect(requests.length).toBe(count);
  await page.reload(); await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click(); await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/);
  await page.reload(); await expect(toggle).toHaveAttribute("aria-pressed", "true"); expect(errors).toEqual([]);
});

test("edits all modes and lookbacks and uses ordinary RVOL on daily charts", async ({ page }) => {
  const { errors } = await openRvol(page, { enabled: true });
  const chart = page.locator(".ws-chart"); await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/);
  await page.getByLabel("Chart settings", { exact: true }).click();
  for (const mode of ["ordinary", "per-bar", "cumulative"]) { await page.getByLabel("RVOL calculation").selectOption(mode); await expect(chart).toHaveAttribute("data-rvol-mode", mode); }
  await page.getByLabel("RVOL lookback", { exact: true }).fill("0"); await page.getByLabel("RVOL lookback", { exact: true }).press("Enter");
  await expect(page.locator(".ws-rvol-settings").getByRole("alert")).toContainText("1 to 100");
  await page.getByLabel("RVOL lookback", { exact: true }).fill("10"); await page.getByLabel("RVOL lookback", { exact: true }).press("Enter");
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).rvol.lookback, rvolPrefKey)).toBe(10);
  await page.keyboard.press("Escape"); await page.locator(".ws-timeframes").getByRole("button", { name: "1d", exact: true }).click();
  await expect(chart).toHaveAttribute("data-rvol-mode", "ordinary"); await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/);
  await page.locator(".ws-timeframes").getByRole("button", { name: "5m", exact: true }).click(); await expect(chart).toHaveAttribute("data-rvol-mode", "cumulative");
  expect(errors).toEqual([]);
});

test("keeps the visible dates when unusually high RVOL values populate the scale", async ({ page }) => {
  const { errors } = await openRvol(page, { volumeSpike: true });
  const chart = page.locator(".ws-chart"), before = [await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")];
  await page.getByRole("button", { name: "Show relative volume", exact: true }).click();
  await expect(chart).toHaveAttribute("data-rvol-status", "ready");
  await expect(chart.locator("[data-rvol-description]")).toContainText("×");
  // Include the native axis-layout frame and the existing visible-range debounce.
  await page.waitForTimeout(300);
  expect([await chart.getAttribute("data-visible-from"), await chart.getAttribute("data-visible-to")]).toEqual(before);
  expect(errors).toEqual([]);
});

test("coexists with the index pane, follows native resizing, and exports the legend", async ({ page }) => {
  const { errors } = await openRvol(page, { enabled: true, index: true });
  const chart = page.locator(".ws-chart"); await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/);
  const indexTop = Number(await chart.getAttribute("data-benchmark-pane-top")), rvolTop = Number(await chart.getAttribute("data-rvol-pane-top")); expect(rvolTop).toBeGreaterThan(indexTop);
  await chart.getByLabel("Index display chart-1").click(); await expect(chart).not.toHaveAttribute("data-benchmark-pane-top");
  await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/); await chart.getByLabel("Index display chart-1").click();
  await expect(chart).toHaveAttribute("data-benchmark-pane-top", /\d+/);
  await chart.getByLabel("Focus chart-1").click();
  await expect(chart.getByRole("button", { name: "Show relative volume", exact: true })).toBeVisible();
  await chart.getByRole("button", { name: "Show relative volume", exact: true }).click(); await expect(chart.locator(".ws-rvol-legend")).toHaveCount(0);
  await chart.getByRole("button", { name: "Show relative volume", exact: true }).click(); await expect(chart).toHaveAttribute("data-rvol-points", /[1-9]/);
  await page.evaluate(() => { const fill = CanvasRenderingContext2D.prototype.fillText; (window as unknown as { rvolExport: string[] }).rvolExport = []; CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) { if (!this.canvas.isConnected) (window as unknown as { rvolExport: string[] }).rvolExport.push(text); if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth); }; });
  await chart.getByLabel("Export chart-1", { exact: true }).click();
  await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { rvolExport: string[] }).rvolExport.some(text => text.includes("RVOL at time")))).toBe(true);
  expect(errors).toEqual([]);
});

test("loads missing lookback separately and retains price candles on retrieval failure", async ({ page }) => {
  const { errors, requests } = await openRvol(page, { enabled: true, cache: "cold", failure: true });
  const chart = page.locator(".ws-chart"); await expect(chart.getByRole("button", { name: "Retry RVOL" })).toBeVisible();
  await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/); await expect(chart.locator(".ws-chart-state")).toHaveCount(0);
  expect(requests.some(r => r.purpose === "indicator" && r.mode === "fill")).toBe(true);
  await page.getByRole("button", { name: "Show relative volume", exact: true }).click(); await expect(chart.locator(".ws-rvol-legend")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("resizes the native RVOL pane, saves its ratio, and clamps historical values before entry", async ({ page }) => {
  const { errors } = await openRvol(page, { enabled: true, index: true });
  const chart = page.locator('[data-chart-id="chart-1"]'); await expect(chart).toHaveAttribute("data-rvol-status", "ready");
  const bounds = (await chart.locator(".ws-chart-overlay").boundingBox())!, top = Number(await chart.getAttribute("data-rvol-pane-top"));
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + top - 3); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + top - 43, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).panels[0].rvolPaneRatio ?? .2, rvolPrefKey)).toBeGreaterThan(.2);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).panels[0].benchmarkPaneRatio, rvolPrefKey)).toBe(.3);
  await chart.getByLabel("Before entry chart-1", { exact: true }).click();
  await expect(chart).toHaveAttribute("data-rvol-status", "ready");
  await expect.poll(async () => Number(await chart.getAttribute("data-rvol-last-time"))).toBeLessThan(demoTrades[0].openTime);
  await chart.getByLabel("Before entry chart-1", { exact: true }).click();
  await expect.poll(async () => Number(await chart.getAttribute("data-rvol-last-time"))).toBeGreaterThan(demoTrades[0].openTime);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  const cursor = Number(await page.getByLabel("Replay time", { exact: true }).inputValue());
  await expect(chart).toHaveAttribute("data-rvol-status", "ready");
  expect(Number(await chart.getAttribute("data-rvol-last-time"))).toBeLessThan(cursor);
  expect(errors).toEqual([]);
});

test("preempts warmup when changing trades and keeps the RVOL toggle visible on narrow screens", async ({ page }) => {
  const { errors, requests } = await openRvol(page, { enabled: true, cache: "cold", delay: 150 });
  await expect.poll(() => requests.filter(r => r.purpose === "indicator").length).toBeGreaterThan(0);
  await page.getByRole("button", { name: /^AAPL .*Long/ }).click();
  const chart = page.locator('[data-chart-id="chart-1"]'); await expect(chart).toHaveAttribute("data-history-identity", /AAPL/);
  await expect(chart).toHaveAttribute("data-rvol-status", "ready");
  await page.setViewportSize({ width: 600, height: 900 });
  const toggle = page.getByRole("button", { name: "Show relative volume", exact: true }); await expect(toggle).toBeVisible(); await expect(toggle).toHaveText("RVOL");
  await toggle.click(); await expect(chart).toHaveAttribute("data-rvol-enabled", "false"); expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"] as const) for (const dpr of [1, 1.25, 2]) test(`captures native RVOL and index geometry in ${theme} at DPR ${dpr}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr }), page = await context.newPage();
  try {
    const { errors } = await openRvol(page, { enabled: true, index: true, theme });
    const chart = page.locator(".ws-chart"); await expect(chart).toHaveAttribute("data-rvol-status", "ready");
    await page.evaluate(() => {
      const state = window as unknown as { rvolTexts: { text: string; y: number }[]; rvolPng?: Blob }; state.rvolTexts = [];
      const fill = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) { if (!this.canvas.isConnected || this.canvas.closest('[style*="-100000px"]')) { const matrix = this.getTransform(); state.rvolTexts.push({ text, y: matrix.b * x + matrix.d * y + matrix.f }); } if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth); };
      const create = URL.createObjectURL; URL.createObjectURL = function(blob) { if (blob instanceof Blob && blob.type === "image/png") state.rvolPng = blob; return create.call(URL, blob); };
    });
    const top = Number(await chart.getAttribute("data-rvol-pane-top")), width = (await chart.locator(".ws-chart-overlay").boundingBox())!.width;
    await chart.getByLabel("Export chart-1", { exact: true }).click(); await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { rvolPng?: Blob }).rvolPng)).toBe(true);
    const captured = await page.evaluate(async () => {
      const state = window as unknown as { rvolTexts: { text: string; y: number }[]; rvolPng: Blob }, bitmap = await createImageBitmap(state.rvolPng), bytes = new Uint8Array(await state.rvolPng.arrayBuffer());
      return { width: bitmap.width, texts: state.rvolTexts, bytes: Array.from(bytes) };
    });
    await mkdir("artifacts/rvol-release", { recursive: true }); await writeFile(`artifacts/rvol-release/${theme}-dpr-${dpr}.png`, Buffer.from(captured.bytes));
    const title = captured.texts.find(t => t.text.startsWith("RVOL at time"))!, scale = captured.width / width;
    expect(title).toBeTruthy(); expect(Math.abs(title.y / scale - 48 - top - 15)).toBeLessThan(4);
    expect(captured.texts.some(t => /^\d+\.\d{2}×$/.test(t.text))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
