import { expect, test, type Locator, type Page } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { showTakeaways } from "./review-helpers";
import { readFile } from "node:fs/promises";

const preferenceKey = "execution-lab:workstation:preferences:demo:v1";
async function open(page: Page, count = 3) {
  const errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.addInitScript(({ preferences, count, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ ...preferences, panels: ["5m", "1h", "1d", "1wk"].slice(0, count).map((interval, i) => ({ id: `chart-${i + 1}`, interval, session: i % 2 ? "extended" : "regular" })) }));
  }, { preferences: defaultPreferences(), count, key: preferenceKey });
  await page.goto("/preview/trades");
  await expect(page.locator(".ws-chart")).toHaveCount(count);
  for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-visible-from", /\d+/);
  return { errors, requests };
}
async function settings(page: Page) {
  await page.getByRole("button", { name: "Chart settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Chart settings", exact: true });
}
async function colorPixels(chart: Locator, color: number[]) {
  return chart.locator(".ws-chart-canvas canvas").evaluateAll((canvases, rgb) => canvases.reduce((sum, element) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - rgb[0]) < 3 && Math.abs(pixels[i + 1] - rgb[1]) < 3 && Math.abs(pixels[i + 2] - rgb[2]) < 3 && pixels[i + 3] > 200) sum++;
    return sum;
  }, 0), color);
}

for (const count of [1, 2, 3, 4]) test(`${count} charts retain independent sessions and explicitly apply to all`, async ({ page }) => {
  const { errors, requests } = await open(page, count);
  for (let i = 0; i < count; i++) await expect(page.getByLabel(`Chart session chart-${i + 1}`, { exact: true })).toHaveValue(i % 2 ? "extended" : "regular");
  await page.getByLabel("Chart session chart-1", { exact: true }).selectOption("auto");
  if (count > 1) await expect(page.getByLabel("Chart session chart-2", { exact: true })).toHaveValue("extended");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("execution-lab:workstation:demo:v1:view:demo-nvda"))).toContain('"session":"auto"');
  await page.reload();
  await expect(page.getByLabel("Chart session chart-1", { exact: true })).toHaveValue("auto");
  if (count > 1) await expect(page.getByLabel("Chart session chart-2", { exact: true })).toHaveValue("extended");
  await page.getByLabel("Chart session chart-1", { exact: true }).selectOption("regular");
  await page.getByRole("button", { name: "Apply active chart’s session to all charts", exact: true }).click();
  for (let i = 0; i < count; i++) await expect(page.getByLabel(`Chart session chart-${i + 1}`, { exact: true })).toHaveValue("regular");
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("chart actions use focused shortcuts, preserve Before entry guards, and ignore typing", async ({ page }) => {
  const { errors } = await open(page);
  const chart = page.locator('[data-chart-id="chart-2"]'), first = page.locator('[data-chart-id="chart-1"]');
  await chart.focus(); await page.keyboard.press("Shift+B");
  await expect(chart.getByRole("button", { name: "Before entry chart-2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(first.getByRole("button", { name: "Before entry chart-1", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Shift+T");
  await expect(chart.getByRole("button", { name: "Before entry chart-2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Shift+B"); await page.keyboard.press("Shift+E");
  await expect(chart.getByLabel("Chart session chart-2", { exact: true })).toHaveValue("regular");
  await chart.getByLabel("Chart session chart-2", { exact: true }).selectOption("auto");
  const session = await chart.getAttribute("data-session");
  await chart.focus(); await page.keyboard.press("Shift+E");
  await expect(chart.getByLabel("Chart session chart-2", { exact: true })).toHaveValue(session === "regular" ? "extended" : "regular");
  await showTakeaways(page);
  const note = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await note.fill(""); await note.press("Shift+B"); await note.press("Shift+E"); await note.press("Shift+T");
  await expect(note).toHaveText("BET");
  await expect(chart.getByRole("button", { name: "Before entry chart-2", exact: true })).toHaveAttribute("aria-pressed", "false");
  const dialog = await settings(page);
  await dialog.getByRole("button", { name: /Keyboard shortcuts/ }).click();
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
  for (const [label, key] of [["Before Trade", "B"], ["Fit Trade", "T"], ["Toggle trading hours", "E"]]) await expect(shortcuts.getByRole("button", { name: `Set shortcut for ${label}`, exact: true })).toContainText(`Shift + ${key}`);
  const binding = shortcuts.getByRole("button", { name: "Set shortcut for Before Trade", exact: true });
  await binding.click(); await binding.press("Shift+Y");
  await shortcuts.getByRole("button", { name: "Close dialog" }).click();
  await expect(chart.getByRole("button", { name: "Before entry chart-2", exact: true })).toHaveAttribute("title", /Shift \+ Y/);
  await chart.focus(); await page.keyboard.press("Shift+Y");
  await expect(chart.getByRole("button", { name: "Before entry chart-2", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("volume SMA and grid settings render, persist, and export in both themes", async ({ page }, info) => {
  const { errors, requests } = await open(page, 1);
  const chart = page.locator(".ws-chart");
  await expect.poll(() => colorPixels(chart, [212, 180, 119])).toBeGreaterThan(5);
  const gridPixels = await colorPixels(chart, [27, 34, 48]);
  const dialog = await settings(page);
  await dialog.getByLabel("Volume average", { exact: true }).uncheck();
  await dialog.getByLabel("Horizontal gridlines", { exact: true }).uncheck();
  await dialog.getByLabel("Vertical gridlines", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(() => colorPixels(chart, [212, 180, 119])).toBe(0);
  // Antialiased text/candles can share a few grid-coloured pixels.
  await expect.poll(() => colorPixels(chart, [27, 34, 48])).toBeLessThan(gridPixels / 10);
  await settings(page);
  await dialog.getByLabel("Horizontal gridlines", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(() => colorPixels(chart, [27, 34, 48])).toBeGreaterThan(50);
  await settings(page);
  await dialog.getByLabel("Horizontal gridlines", { exact: true }).uncheck();
  await dialog.getByLabel("Volume average", { exact: true }).check();
  await dialog.getByLabel("Volume average period (bars)", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect.poll(() => colorPixels(chart, [212, 180, 119])).toBeGreaterThan(5);
  await settings(page);
  await expect(dialog.getByLabel("Volume average period (bars)", { exact: true })).toHaveValue("5");
  await expect(dialog.getByLabel("Horizontal gridlines", { exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel("Vertical gridlines", { exact: true })).not.toBeChecked();
  await dialog.getByLabel("Volume", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect.poll(() => colorPixels(chart, [212, 180, 119])).toBe(0);
  await settings(page); await dialog.getByLabel("Volume", { exact: true }).check();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByTitle("Appearance", { exact: true }).click();
  await expect.poll(() => colorPixels(chart, [150, 105, 30])).toBeGreaterThan(5);
  await chart.focus(); await page.keyboard.press("Shift+B"); await page.keyboard.press("f");
  // This short pre-entry fixture has only two SMA segments after warm-up.
  await expect.poll(() => colorPixels(chart, [150, 105, 30])).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("volume-average-light-fullscreen.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await chart.getByRole("button", { name: "Export chart-1", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
  const png = await download; await png.saveAs(info.outputPath("volume-average-export.png"));
  expect((await png.failure())).toBeNull();
  const encoded = (await readFile(info.outputPath("volume-average-export.png"))).toString("base64");
  const exportPixels = await page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let average = 0, grid = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 150 && pixels[i + 1] === 105 && pixels[i + 2] === 30) average++;
      if (pixels[i] === 237 && pixels[i + 1] === 240 && pixels[i + 2] === 245) grid++;
    }
    return { average, grid };
  }, encoded);
  expect(exportPixels.average).toBeGreaterThan(0);
  expect(exportPixels.grid).toBeLessThan(100);
  expect(errors).toEqual([]); expect(requests).toEqual([]);
});

test("Before Trade shortcut respects unresolved execution times", async ({ page }) => {
  await page.route("**/api/**", route => route.abort());
  await page.goto("/preview/trades?scenario=execution-timing&interpretation=original");
  const chart = page.locator('[data-chart-id="chart-1"]');
  const before = chart.getByRole("button", { name: "Before entry chart-1", exact: true });
  await expect(before).toBeDisabled();
  await chart.focus(); await page.keyboard.press("Shift+B");
  await expect(before).toHaveAttribute("aria-pressed", "false");
});

test("workspace presets keep mixed sessions and newly added charts start in Auto", async ({ page }) => {
  await open(page, 2);
  await page.getByRole("button", { name: /My workspace/ }).click();
  await page.getByLabel("Workspace name").fill("Mixed sessions");
  await page.getByRole("button", { name: "Save preset", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Number of charts").selectOption("3");
  await expect(page.getByLabel("Chart session chart-3", { exact: true })).toHaveValue("auto");
  await page.getByLabel("Chart session chart-1", { exact: true }).selectOption("extended");
  await page.getByRole("button", { name: /My workspace/ }).click();
  await page.getByRole("button", { name: "Mixed sessions", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".ws-chart")).toHaveCount(2);
  await expect(page.getByLabel("Chart session chart-1", { exact: true })).toHaveValue("regular");
  await expect(page.getByLabel("Chart session chart-2", { exact: true })).toHaveValue("extended");
});

test("new chart controls fit laptop and mobile headers", async ({ page }, info) => {
  await open(page, 4);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Chart session chart-1", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const heading of await page.locator(".ws-chart-heading").all()) expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`chart-controls-${width}.png`), fullPage: true });
  }
});
