import { expect, test, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
const prefsKey = "execution-lab:workstation:preferences:demo:v1";
async function open(page: Page, scenario = false) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(`/preview/trades${scenario ? "?scenario=execution-mismatch" : ""}`);
  await expect(page.locator(".ws-chart")).toHaveCount(3);
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-visible-from", /\d+/);
  return { errors, requests };
}
async function drag(page: Page, separator: Locator, dx: number, dy: number) {
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 }); await page.mouse.up();
}
const sizes = (page: Page) => page.locator(".ws-chart").evaluateAll(nodes => nodes.map(n => ({ width: n.clientWidth, height: n.clientHeight, x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })));
const windows = (page: Page) => page.locator(".ws-chart").evaluateAll(nodes => nodes.map(n => [n.getAttribute("data-visible-from"), n.getAttribute("data-visible-to")]));
async function arrangement(page: Page, value: string) { await page.getByRole("button", { name: "Chart settings", exact: true }).click(); await page.getByLabel("Chart arrangement").selectOption(value); await page.getByLabel("Close dialog", { exact: true }).click(); }

test("dragging three-chart divisions preserves chart instances, ranges, drawings and review drafts", async ({ page }) => {
  const { errors, requests } = await open(page);
  await page.getByPlaceholder("What will you repeat or change?").fill("Resize without losing my review.");
  await page.waitForTimeout(500);
  const before = await sizes(page), range = await windows(page);
  const element = await page.locator(".ws-chart-canvas").first().elementHandle();
  await drag(page, page.getByRole("separator", { name: "Main chart division", exact: true }), -100, 0);
  expect((await sizes(page))[0].width).toBeLessThan(before[0].width - 70);
  await drag(page, page.getByRole("separator", { name: "Secondary chart division", exact: true }), 0, 60);
  expect((await sizes(page))[1].height).toBeGreaterThan(before[1].height + 40);
  await page.waitForTimeout(500);
  expect(await windows(page)).toEqual(range);
  expect(await element!.evaluate(el => el === document.querySelector(".ws-chart-canvas"))).toBe(true);
  await expect(page.getByPlaceholder("What will you repeat or change?")).toHaveValue("Resize without losing my review.");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chartSizing, prefsKey);
  await page.reload(); await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chartSizing, prefsKey)).toEqual(stored);
  await page.getByRole("button", { name: "Focus chart-2", exact: true }).click();
  await expect(page.locator(".ws-chart-fullscreen")).toBeVisible(); await page.keyboard.press("Escape");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chartSizing, prefsKey)).toEqual(stored);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("all arrangements resize independently, keyboard limits and reset work, and presets restore sizing", async ({ page }) => {
  await open(page);
  await page.getByLabel("Number of charts").selectOption("2");
  const main = page.getByRole("separator", { name: "Main chart division", exact: true });
  await main.focus(); await page.keyboard.press("ArrowRight");
  await expect(main).toHaveAttribute("aria-valuenow", "52");
  await page.getByLabel("Number of charts").selectOption("3"); await arrangement(page, "top");
  await expect(main).toHaveAttribute("aria-orientation", "horizontal");
  const secondary = page.getByRole("separator", { name: "Secondary chart division", exact: true });
  await secondary.focus(); await page.keyboard.press("ArrowRight"); await expect(secondary).toHaveAttribute("aria-valuenow", "52");
  await page.getByLabel("Number of charts").selectOption("4");
  const left = page.getByRole("separator", { name: "Left charts division" }), right = page.getByRole("separator", { name: "Right charts division" });
  const rightBefore = await right.getAttribute("aria-valuenow");
  await left.focus(); await page.keyboard.press("Shift+ArrowDown");
  await expect(right).toHaveAttribute("aria-valuenow", rightBefore!);
  await page.keyboard.press("End");
  for (const s of await sizes(page)) expect(s.height).toBeGreaterThanOrEqual(180);
  await left.dblclick(); await expect(left).toHaveAttribute("aria-valuenow", "50");
  await main.focus(); await page.keyboard.press("ArrowLeft");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chartSizing, prefsKey);
  await page.getByRole("button", { name: /My workspace/ }).click();
  await page.getByLabel("Workspace name").fill("Review sizing"); await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.getByRole("button", { name: "Reset chart sizes", exact: true }).click();
  await page.getByRole("button", { name: "Review sizing", exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).chartSizing, prefsKey)).toEqual(stored);
});

test("label toggle keeps selectable markers, works in fullscreen, and removes plot logos", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Hide execution labels", exact: true }).click();
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-label-mode", "compact");
  for (const chart of (await page.locator(".ws-chart").all()).slice(1)) await expect(chart).toHaveAttribute("data-label-mode", "labels");
  const overlay = page.locator(".ws-chart-overlay").first();
  await page.waitForTimeout(250);
  const point = await overlay.evaluate((el: HTMLCanvasElement) => {
    const pixels = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
    for (let y = 30; y < el.height - 30; y++) for (let x = 10; x < el.width - 70; x++) { const i = (y * el.width + x) * 4; if (pixels[i] === 52 && pixels[i + 1] === 211 && pixels[i + 2] === 153 && pixels[i + 3] === 255) return { x: x / devicePixelRatio, y: y / devicePixelRatio }; }
    return null;
  });
  expect(point).not.toBeNull(); const box = (await overlay.boundingBox())!;
  await page.mouse.click(box.x + point!.x, box.y + point!.y);
  await expect(page.getByRole("dialog", { name: "Execution details", exact: true })).toBeVisible();
  await page.getByLabel("Close execution details").click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await expect(page.locator(".ws-fullscreen-credit")).toBeVisible();
  await page.locator(".ws-chart-fullscreen").getByRole("button", { name: "Show execution labels chart-1", exact: true }).click();
  await expect(page.locator(".ws-chart-fullscreen")).toHaveAttribute("data-label-mode", "labels");
  await expect(page.locator(".ws-chart-canvas a")).toHaveCount(0);
});

test("MU mismatch details preserve the timestamp and explain the price discrepancy", async ({ page }) => {
  const { errors, requests } = await open(page, true);
  await expect(page.locator(".ws-trade-title h2")).toContainText("MU");
  await page.getByRole("button", { name: "Chart history chart-1", exact: true }).click();
  await page.locator(".ws-diagnostic-list").getByRole("button", { name: /SELL 6 @ 1008.71/ }).click();
  const details = page.getByRole("dialog", { name: "Execution details", exact: true });
  await expect(details).toContainText("2026-09-08 15:09:25 UTC");
  await expect(details).toContainText("2026-09-08 15:05:00 UTC");
  await expect(details).toContainText("1015.3900 / 1017.6600");
  await expect(details).toContainText("6.6800"); await expect(details).toContainText("Unverified");
  await page.keyboard.press("Escape"); await expect(details).toBeHidden();
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("touch resizing uses separate mobile heights and supports reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage(); await open(page);
  await expect(page.locator(".ws-resizable-grid")).toHaveAttribute("data-stacked", "true");
  const divider = page.getByRole("separator", { name: "Chart 1 height" }); await divider.scrollIntoViewIfNeeded();
  const box = (await divider.boundingBox())!, client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 80, y: box.y + 3 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 80, y: box.y + 63 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(divider).toHaveAttribute("aria-valuenow", "400");
  await page.reload(); await expect(page.getByRole("separator", { name: "Chart 1 height" })).toHaveAttribute("aria-valuenow", "400");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false);
  await context.close();
});

test("multichart PNG follows the actual asymmetric geometry", async ({ page }, info) => {
  await open(page); await page.getByLabel("Number of charts").selectOption("4");
  const left = page.getByRole("separator", { name: "Left charts division" }); await left.focus(); await page.keyboard.press("Shift+ArrowDown");
  const right = page.getByRole("separator", { name: "Right charts division" }); await right.focus(); await page.keyboard.press("Shift+ArrowUp");
  await expect(page.locator(".ws-chart-state")).toHaveCount(0);
  const bounds = await page.locator(".ws-chart").evaluateAll(nodes => nodes.map(n => ({ x: parseFloat((n as HTMLElement).style.left), y: parseFloat((n as HTMLElement).style.top), w: n.clientWidth, h: n.clientHeight })));
  await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "All charts PNG", exact: true }).click();
  const path = info.outputPath("resized-layout.png"); await (await download).saveAs(path); const png = await readFile(path);
  expect(png.readUInt32BE(16)).toBe(Math.ceil(Math.max(...bounds.map(b => b.x + b.w)) * 2));
  expect(png.readUInt32BE(20)).toBe(Math.ceil(Math.max(...bounds.map(b => b.y + b.h)) * 2));
});
