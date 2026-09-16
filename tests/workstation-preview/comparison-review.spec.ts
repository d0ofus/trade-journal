import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { demoTrades } from "../../src/lib/workstation/demo";
import { beforeEntryBoundary } from "../../src/lib/workstation/before-entry";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { DEMO_PREFIX } from "../../src/lib/workstation/demo";
import type { TradeDocument } from "../../src/lib/workstation/types";

async function open(page: Page, panels = 1, journal = false) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ preferences, panels, journal }) => {
    localStorage.setItem("execution-lab:workstation:preferences:demo:v1", JSON.stringify({ ...preferences, journal, panels: ["5m", "1h", "1d", "1wk"].slice(0, panels).map((interval, i) => ({ id: `chart-${i + 1}`, interval, benchmark: "SPY" })) }));
  }, { preferences: defaultPreferences(), panels, journal });
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(panels);
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-visible-bars", /[1-9]/);
  return { errors, requests };
}

test("section captures persist, can be shared, export once, and lose all references when removed", async ({ page }, info) => {
  const { errors } = await open(page, 1, true);
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as TradeDocument | null, DEMO_PREFIX + demoTrades[0].id);
  const exit = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Exit Screen$/ }) });
  await exit.locator("summary").click();
  await exit.getByRole("button", { name: "Attach current chart to Exit Screen", exact: true }).click();
  await expect.poll(async () => (await saved())?.review.notion?.sections.exit?.evidenceIds.length).toBe(1);
  const captured = (await saved())!.evidence.at(-1)!;
  expect((await saved())!.review.notion?.sections.entry?.evidenceIds ?? []).not.toContain(captured.id);
  const index = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^Index$/ }) });
  await index.locator("summary").click(); await index.getByRole("checkbox", { name: captured.name, exact: true }).check();
  await expect.poll(async () => (await saved())?.review.notion?.sections.index?.evidenceIds).toContain(captured.id);
  await page.reload();
  await exit.locator("summary").click(); await expect(exit.getByRole("checkbox", { name: captured.name, exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Export review for Notion", exact: false }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Review page ZIP", exact: true }).click();
  const files = unzipSync(readFileSync((await (await download).path())!));
  expect(Object.keys(files).filter(key => key.startsWith("assets/"))).toHaveLength((await saved())!.evidence.length);
  expect(strFromU8(files["review.html"]).split('alt="' + captured.name.replace(/&/g, "&amp;") + '"')).toHaveLength(3);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`notion-export-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  // Removing through the evidence panel must clear both section assignments.
  await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  await page.getByTitle("Remove attachment", { exact: true }).last().click();
  await expect.poll(async () => (await saved())?.evidence.some(e => e.id === captured.id)).toBe(false);
  expect((await saved())!.review.notion!.sections.exit!.evidenceIds).not.toContain(captured.id);
  expect((await saved())!.review.notion!.sections.index!.evidenceIds).not.toContain(captured.id);
  expect(errors).toEqual([]);
});

test("trade selection cannot redirect an in-flight capture to another review", async ({ page }) => {
  await open(page, 1, true);
  await page.locator("summary").filter({ hasText: /^Exit Screen$/ }).click();
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => document.querySelector('[style*="-100000px"]') ? window.setTimeout(() => callback(performance.now()), 700) : raf(callback);
  });
  await page.getByRole("button", { name: "Attach current chart to Exit Screen", exact: true }).click();
  await page.locator(".ws-trade-card").nth(1).click();
  const original = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as TradeDocument | null, DEMO_PREFIX + demoTrades[0].id);
  await expect.poll(async () => (await original())?.review.notion?.sections.exit?.evidenceIds.length).toBe(1);
  const captured = (await original())!.evidence.at(-1)!;
  const other = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null") as TradeDocument | null, DEMO_PREFIX + demoTrades[1].id);
  expect(other?.evidence.some(e => e.id === captured.id) ?? false).toBe(false);
  await expect(page.locator(".ws-trade-card").first()).toHaveClass(/active/);
});

test("failed attachment saves keep image and section together in the recovery draft", async ({ page }) => {
  await open(page, 1, true);
  await page.locator("summary").filter({ hasText: /^Exit Screen$/ }).click();
  await page.evaluate(prefix => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith(prefix) && !key.includes("view:")) throw new Error("Test save failure"); return set.call(this, key, value); };
  }, DEMO_PREFIX);
  await page.getByRole("button", { name: "Attach current chart to Exit Screen", exact: true }).click();
  await expect(page.getByText("Test save failure", { exact: true })).toBeVisible();
  const recovery = () => page.evaluate(scope => new Promise<TradeDocument | null>((resolve, reject) => {
    const request = indexedDB.open("execution-lab-journal-recovery");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("drafts", "readonly");
      const rows = tx.objectStore("drafts").index("scope").getAll(scope);
      rows.onsuccess = () => resolve(rows.result.find(row => !row.acknowledged)?.payload ?? null);
      rows.onerror = () => reject(rows.error); tx.oncomplete = () => db.close();
    };
  }), `workstation:demo:${demoTrades[0].id}`);
  await expect.poll(async () => (await recovery())?.evidence.length).toBeGreaterThan(0);
  const draft = (await recovery())!;
  expect(draft.review.notion!.sections.exit!.evidenceIds).toContain(draft.evidence.at(-1)!.id);
  await page.reload();
  await expect.poll(() => page.evaluate(key => {
    const doc = JSON.parse(localStorage.getItem(key) ?? "null") as TradeDocument | null;
    return doc?.review.notion?.sections.exit?.evidenceIds.length;
  }, DEMO_PREFIX + demoTrades[0].id)).toBe(1);
});

for (const panels of [1, 2, 3, 4]) test(`${panels} panels compare benchmark candles and cut off independently`, async ({ page }) => {
  const { errors, requests } = await open(page, panels);
  const charts = page.locator(".ws-chart"), first = charts.first();
  for (const chart of await charts.all()) await expect(chart.locator(".ws-benchmark-legend")).toContainText("SPY · O");
  await expect(first).toHaveAttribute("data-visible-to", /[1-9]\d{8,}/);
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

test("journal lazily mounts formatting, retains custom properties and downloads matching Notion import files", async ({ page }) => {
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
  await page.getByRole("button", { name: "Export review for Notion", exact: false }).click();
  const dialog = page.getByRole("dialog", { name: "Export review for Notion" });
  const zipDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Review page ZIP", exact: true }).click();
  const archive = unzipSync(readFileSync((await (await zipDownload).path())!));
  const html = strFromU8(archive["review.html"]);
  const csvDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Database CSV", exact: true }).click();
  const csv = readFileSync((await (await csvDownload).path())!, "utf8");
  expect(html).toContain("<u>"); expect(html).toContain("<ul>");
  expect(html).toContain("Rotation"); expect(html).toContain("IHF / XLV");
  expect(html).toContain("Pre-trade metrics"); expect(html).toContain("Entry Screen");
  expect(csv).toContain('"S/L % (snapshot)"'); expect(csv).toContain("Patient entry");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  const adr = page.locator(".ws-market-metrics > span").filter({ hasText: "ADR%" }).locator("b");
  await expect(adr).toHaveText(/\d+\.\d+%/);
  expect(html).toContain(await adr.innerText());
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
  expect(result.labels.some(text => text.includes("Independent scale"))).toBe(true);
  expect(result.labels.some(text => text.includes("adjustment:") || text.includes("provider-native") || text.includes("tradingview.com"))).toBe(false);
  expect(result.labels.some(text => text.includes("SPY · O"))).toBe(true);
  expect(result.labels.some(text => text.includes("BEFORE ENTRY"))).toBe(true);
  await png.saveAs("artifacts/comparison/before-entry-spy.png");
  expect(errors).toEqual([]);
});

test("layout PNGs keep panel dimensions and omit footer text in both themes", async ({ page }, info) => {
  await open(page, 2);
  const bounds = await page.locator(".ws-chart").evaluateAll(nodes => nodes.map(node => {
    const style = (node as HTMLElement).style;
    return { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
  }));
  const expected = { width: Math.ceil(Math.max(...bounds.map(b => b.x + b.width)) * 2), height: Math.ceil(Math.max(...bounds.map(b => b.y + b.height)) * 2) };
  await page.locator(".ws-chart").first().getByRole("button", { name: "Export chart-1", exact: true }).click();
  for (const light of [false, true]) {
    await page.getByLabel("Light background").setChecked(light);
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "All charts PNG", exact: true }).click();
    const file = await download, png = readFileSync((await file.path())!);
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(expected);
    await file.saveAs(info.outputPath(`layout-${light ? "light" : "dark"}.png`));
  }
});
