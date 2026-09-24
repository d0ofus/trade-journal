import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";

const prefKey = "execution-lab:workstation:preferences:demo:v1", docKey = DEMO_PREFIX + demoTrades[0].id;
async function open(page: Page) {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", route => route.abort());
  await page.addInitScript(({ prefKey, docKey, prefs, doc }) => {
    if (!localStorage.getItem(prefKey)) localStorage.setItem(prefKey, JSON.stringify(prefs));
    if (!localStorage.getItem(docKey)) localStorage.setItem(docKey, JSON.stringify(doc));
  }, { prefKey, docKey, prefs: { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m", session: "regular" }], journal: true }, doc: initialDemoDocument(demoTrades[0]) });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart canvas").first()).toBeVisible();
  await expect(page.getByText("Loading chart…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".ws-notion-review")).toBeVisible();
  return errors;
}
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, docKey); }

test("fullscreen journal edits one live editor, resizes, captures and restores normal/Focus layout", async ({ page }, info) => {
  const errors = await open(page);
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const editor = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await editor.fill("Before fullscreen");
  await expect.poll(async () => (await saved(page)).review.takeaway).toContain("Before fullscreen");
  await editor.evaluate(node => node.setAttribute("data-preserved-editor", "yes"));
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dock, prefKey);
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  const chart = page.locator(".ws-chart-fullscreen"), fullWidth = (await chart.boundingBox())!.width;
  await page.getByRole("button", { name: "Show fullscreen journal" }).click();
  const sidebar = page.getByRole("complementary", { name: "Fullscreen trade journal" });
  await expect(sidebar).toBeVisible(); await expect(editor).toHaveAttribute("data-preserved-editor", "yes");
  await page.screenshot({ path: info.outputPath("fullscreen-journal.png") });
  await expect(page.locator('[role="textbox"][aria-label="Takeaways"]')).toHaveCount(1);
  await editor.fill("Written in fullscreen");
  await expect.poll(async () => (await saved(page)).review.takeaway).toContain("Written in fullscreen");
  expect((await chart.boundingBox())!.width).toBeLessThan(fullWidth - 270);
  const separator = page.getByRole("separator", { name: "Resize fullscreen journal" });
  const width = (await sidebar.boundingBox())!.width; await separator.focus(); await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(width);
  await page.getByRole("button", { name: "Attach current chart to Takeaways", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  await sidebar.getByRole("button", { name: /^View / }).click();
  await expect(page.getByRole("dialog", { name: /^Image preview:/ })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Close fullscreen journal" }).click();
  await expect(page.getByRole("button", { name: "Show fullscreen journal" })).toBeFocused();
  await expect(chart).toBeVisible(); await chart.focus(); await page.keyboard.press("Escape");
  await expect(editor).toBeVisible(); await expect(editor).toContainText("Written in fullscreen");
  // Closing intentionally returns keyboard focus to Charts; geometry/tabs remain intact.
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).dock, prefKey);
  expect({ ...restored, activeGroup: original.activeGroup }).toEqual(original);
  await page.locator(".ws-chart").focus(); await page.keyboard.press("Shift+F");
  await page.getByRole("button", { name: "Show focus journal" }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await page.getByRole("button", { name: "Show fullscreen journal" }).click();
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide focus journal" })).toBeVisible();
  await expect(editor).toHaveAttribute("data-preserved-editor", "yes");
  expect(errors).toEqual([]);
});

for (const ratio of [1, 1.25, 2, 3]) test.describe(`capture DPR ${ratio}`, () => {
  test.use({ deviceScaleFactor: ratio, viewport: { width: 1280, height: 800 } });
  test("high quality, native Standard and lossless saved-image downloads", async ({ page }) => {
    const errors = await open(page);
    await page.getByRole("button", { name: "Export chart-1", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Take your review with you" });
    await expect(dialog.getByLabel("Export resolution", { exact: true })).toHaveValue("high");
    const highDownload = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    const png = await readFile((await (await highDownload).path())!);
    const highWidth = png.readUInt32BE(16), highHeight = png.readUInt32BE(20);
    expect(highWidth).toBeGreaterThanOrEqual(1920); expect(highWidth * highHeight).toBeLessThanOrEqual(16_000_000);
    await dialog.getByLabel("Export resolution", { exact: true }).selectOption("standard");
    const normalDownload = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    const normal = await readFile((await (await normalDownload).path())!);
    expect(normal.readUInt32BE(16)).toBeLessThanOrEqual(highWidth);
    await page.keyboard.press("Escape");
    await page.locator("summary").filter({ hasText: /^Entry Screen$/ }).click();
    await page.getByRole("button", { name: "Attach current chart to Entry Screen", exact: true }).click();
    await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
    // Capturing can activate Evidence. Open through the section after showing Journal.
    await page.locator(".ws-section-preview").getByRole("button", { name: /^View / }).click();
    const viewer = page.getByRole("dialog", { name: /^Image preview:/ });
    const image = viewer.locator("img");
    await expect.poll(() => image.evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const imageSize = await image.evaluate(i => ({ natural: (i as HTMLImageElement).naturalWidth, display: i.getBoundingClientRect().width }));
    expect(imageSize.display).toBeLessThanOrEqual(imageSize.natural);
    await viewer.getByRole("button", { name: "100%", exact: true }).click();
    expect(Math.round((await image.boundingBox())!.width)).toBe(imageSize.natural);
    const original = await image.evaluate(async i => Array.from(new Uint8Array(await (await fetch((i as HTMLImageElement).src)).arrayBuffer())));
    const download = page.waitForEvent("download"); await viewer.getByRole("button", { name: /^Download / }).click();
    expect(await readFile((await (await download).path())!)).toEqual(Buffer.from(original));
    expect((await saved(page)).evidence[0].image).toBe("");
    expect(errors).toEqual([]);
  });
});

test("mobile fullscreen journal keeps chart inert, handles nested dialogs and restores focus", async ({ page }, info) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Focus chart-1", exact: true }).click();
  await page.getByRole("button", { name: "Show fullscreen journal" }).click();
  const journal = page.getByRole("complementary", { name: "Fullscreen trade journal" });
  await expect(journal).toBeVisible();
  await expect(journal.getByRole("button", { name: "Close fullscreen journal" })).toBeFocused();
  expect((await journal.boundingBox())!.width).toBe(390);
  await page.screenshot({ path: info.outputPath("fullscreen-journal-mobile.png") });
  await expect.poll(() => page.locator(".ws-chart-fullscreen").evaluate(e => (e as HTMLElement).inert)).toBe(true);
  await journal.getByRole("button", { name: "Review details", exact: false }).click();
  const details = page.getByRole("dialog", { name: "Review details", exact: true });
  await expect(details).toBeVisible(); await page.keyboard.press("Escape"); await expect(details).toHaveCount(0);
  await expect(journal).toBeVisible();
  await journal.getByRole("button", { name: "Close fullscreen journal" }).click();
  await expect(page.getByRole("button", { name: "Show fullscreen journal" })).toBeFocused();
  await expect.poll(() => page.locator(".ws-chart-fullscreen").evaluate(e => (e as HTMLElement).inert)).toBe(false);
});
