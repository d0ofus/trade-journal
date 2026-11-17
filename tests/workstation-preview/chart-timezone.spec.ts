import { expect, test, type Page } from "@playwright/test";
import { openRvol, rvolPrefKey } from "./rvol-fixture";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { DEMO_PREFIX } from "../../src/lib/workstation/demo";
import { mkdir, writeFile } from "node:fs/promises";

declare global { interface Window { timezoneDurations: number[]; timezoneText: string[]; timezoneCanvases: HTMLCanvasElement[]; timezonePng?: Blob } }
async function observe(page: Page) {
  await page.addInitScript(() => {
    window.timezoneDurations = []; window.timezoneText = []; window.timezoneCanvases = [];
    window.addEventListener("workstation-timezone-updated", e => window.timezoneDurations.push((e as CustomEvent).detail.duration));
    const create = URL.createObjectURL;
    URL.createObjectURL = function(value) { if (value instanceof Blob && value.type === "image/png") window.timezonePng = value; return create.call(URL, value); };
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (window.timezoneText.length > 4000) window.timezoneText.splice(0, 2000);
      window.timezoneText.push(text);
      if (maxWidth === undefined) fill.call(this, text, x, y); else fill.call(this, text, x, y, maxWidth);
    };
  });
}
const mainSelector = (page: Page) => page.getByRole("combobox", { name: "Chart timezone", exact: true });
const ranges = (page: Page) => page.locator(".ws-chart").evaluateAll(nodes => nodes.map(n => [n.getAttribute("data-visible-from"), n.getAttribute("data-visible-to"), n.getAttribute("data-visible-bars"), n.getAttribute("data-rvol-points")]));

test("shares controls, defaults to Exchange and isolates four live charts from timezone changes", async ({ page }) => {
  await observe(page);
  const info = await openRvol(page, { enabled: true, index: true, panels: 4 });
  for (const chart of await page.locator(".ws-chart").all()) { await expect(chart).toHaveAttribute("data-rvol-status", "ready"); await expect(chart).toHaveAttribute("data-chart-timezone", "America/New_York"); }
  await page.waitForTimeout(1600);
  await page.evaluate(() => { window.timezoneCanvases = [...document.querySelectorAll<HTMLCanvasElement>(".ws-chart-canvas canvas")]; });
  const before = await ranges(page), requests = info.requests.length, calculations = await page.evaluate(() => window.rvolMetrics.calculationStarts.length);
  const saved = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => !key.includes("preferences"))));
  await expect(mainSelector(page)).toHaveValue("exchange");
  for (const mode of ["utc", "system", "exchange"] as const) {
    await mainSelector(page).selectOption(mode);
    await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-timezone-mode", mode);
    await page.waitForTimeout(400);
    expect(await ranges(page)).toEqual(before);
    expect(info.requests.length).toBe(requests);
    expect(await page.evaluate(() => window.rvolMetrics.calculationStarts.length)).toBe(calculations);
    expect(await page.evaluate(() => window.timezoneCanvases.every((canvas, i) => canvas === document.querySelectorAll(".ws-chart-canvas canvas")[i]))).toBe(true);
  }
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => !key.includes("preferences"))))).toEqual(saved);
  expect(await page.evaluate(() => Math.max(...window.timezoneDurations))).toBeLessThan(50);
  await page.getByLabel("Chart settings", { exact: true }).click();
  await page.getByLabel("Settings chart timezone", { exact: true }).selectOption("utc");
  await page.keyboard.press("Escape"); await expect(mainSelector(page)).toHaveValue("utc");
  await page.locator(".ws-chart").first().getByLabel("Focus chart-1", { exact: true }).click();
  await page.getByLabel("Fullscreen chart timezone", { exact: true }).selectOption("exchange");
  await expect(mainSelector(page)).toHaveValue("exchange");
  await page.reload(); await expect(mainSelector(page)).toHaveValue("exchange");
  expect(info.errors).toEqual([]);
});

test("System follows the device timezone on focus without retrieval or RVOL work", async ({ page }) => {
  const info = await openRvol(page);
  await mainSelector(page).selectOption("system");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Australia/Sydney" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-chart-timezone", "Australia/Sydney");
  const count = info.requests.length;
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Kathmandu" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-chart-timezone", /Asia\/Kat[h]?mandu/);
  expect(info.requests.length).toBe(count); expect(info.errors).toEqual([]); await cdp.detach();
});

test("Exchange fallback is explicit when metadata is unverified", async ({ page }) => {
  const info = await openRvol(page, { sessionMetadata: { timezone: null, calendar: "unknown", marketHours: "unknown" } });
  await expect(page.locator(".ws-chart")).toHaveAttribute("data-chart-timezone", "UTC");
  await expect(mainSelector(page).locator("..")).toContainText("unavailable");
  await mainSelector(page).focus(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(mainSelector(page)).toHaveValue("utc"); expect(info.errors).toEqual([]);
});

test("date jump converts local input and rejects DST gaps without moving charts", async ({ page }) => {
  await openRvol(page);
  await page.locator(".ws-date-control summary").click();
  const input = page.getByLabel(/^Target date Exchange/);
  const before = await ranges(page);
  await input.fill("2026-03-08T02:30");
  await page.getByRole("button", { name: "Go to date", exact: true }).click();
  await expect(page.locator(".ws-date-popover").getByRole("alert")).toContainText("does not exist"); expect(await ranges(page)).toEqual(before);
  await mainSelector(page).selectOption("utc");
  const utcInput = page.getByLabel("Target date UTC", { exact: true });
  await utcInput.fill("2026-09-10T13:30"); await utcInput.press("Enter");
  await mainSelector(page).selectOption("exchange");
  await expect(input).toHaveValue("2026-09-10T09:30");
  await mainSelector(page).selectOption("utc"); await expect(utcInput).toHaveValue("2026-09-10T13:30");
});

test("drawing coordinate edits retain absolute anchors across timezone changes", async ({ page }) => {
  await openRvol(page, { index: true });
  await page.locator(".ws-chart").focus(); await page.keyboard.press("n");
  const plot = page.locator(".ws-plot"), box = (await plot.boundingBox())!;
  await page.mouse.click(box.x + box.width * .45, box.y + 80);
  await page.getByLabel("Annotation text", { exact: true }).fill("Timezone anchor");
  await page.getByText("Coordinates", { exact: true }).first().click();
  const coordinate = page.getByLabel(/^Anchor 1 time Exchange/);
  await coordinate.fill("2026-09-10T10:35"); await coordinate.press("Enter");
  await mainSelector(page).selectOption("utc");
  await expect(page.getByLabel("Anchor 1 time UTC", { exact: true })).toHaveValue("2026-09-10T14:35");
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null")?.drawings?.at(-1)?.points?.[0]?.time, DEMO_PREFIX + "demo-nvda")).toBe(Date.parse("2026-09-10T14:35:00Z") / 1000);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).drawings.at(-1).points[0].time, DEMO_PREFIX + "demo-nvda");
  expect(stored).toBe(Date.parse("2026-09-10T14:35:00Z") / 1000);
  await mainSelector(page).selectOption("exchange"); await expect(coordinate).toHaveValue("2026-09-10T10:35");
});

test("peer charts inherit the shared mode, keep native canvases and save capture metadata", async ({ page }) => {
  await observe(page);
  await page.addInitScript(({ key, prefs }) => localStorage.setItem(key, JSON.stringify(prefs)), { key: rvolPrefKey, prefs: { ...defaultPreferences(), chartTimezone: "utc", panels: [{ id: "chart-1", interval: "1d", session: "regular" }] } });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await page.locator("summary").filter({ hasText: /^Peers$/ }).click();
  await page.getByRole("button", { name: "Compare peers", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Peer comparison", exact: true });
  const peer = dialog.locator('[data-peer-symbol="PEER01"]');
  await expect(peer.getByRole("button", { name: "Attach comparison", exact: true })).toBeEnabled();
  await dialog.locator("[data-peer-canvas]").first().evaluate(node => { window.timezoneCanvases = [...node.querySelectorAll<HTMLCanvasElement>("canvas")]; });
  await dialog.getByLabel("Peer chart timezone", { exact: true }).selectOption("exchange");
  await expect(dialog.locator("[data-peer-canvas]").first()).toHaveAttribute("data-chart-timezone", "America/New_York");
  expect(await dialog.locator("[data-peer-canvas]").first().evaluate(node => window.timezoneCanvases.every((c, i) => c === node.querySelectorAll("canvas")[i]))).toBe(true);
  await peer.getByRole("button", { name: "Attach comparison", exact: true }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null")?.evidence?.length ?? 0, DEMO_PREFIX + "demo-nvda")).toBeGreaterThan(0);
  const capture = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).evidence.at(-1).chartTimezone, DEMO_PREFIX + "demo-nvda");
  expect(capture.mode).toBe("exchange"); expect(Object.values(capture.zones)).toEqual(["America/New_York", "America/New_York"]);
  await dialog.getByLabel("Close peer comparison").click(); await expect(mainSelector(page)).toHaveValue("exchange");
});

for (const theme of ["dark", "light"] as const) for (const dpr of [1, 1.25, 2]) test(`${theme} capture preserves timezone with price, index and RVOL at DPR ${dpr}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: dpr, timezoneId: "Australia/Sydney" }), page = await context.newPage();
  try {
    await observe(page); const info = await openRvol(page, { enabled: true, index: true, theme });
    await expect(page.locator(".ws-chart")).toHaveAttribute("data-rvol-status", "ready");
    await mainSelector(page).selectOption("system"); await expect(page.locator(".ws-chart")).toHaveAttribute("data-chart-timezone", "Australia/Sydney");
    await page.getByLabel("Export chart-1", { exact: true }).click();
    await page.getByRole("button", { name: "Active chart PNG", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!window.timezonePng)).toBe(true);
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.timezonePng!.arrayBuffer())));
    await mkdir("artifacts/timezone-release", { recursive: true }); await writeFile(`artifacts/timezone-release/${theme}-dpr${dpr}.png`, Buffer.from(bytes));
    expect(await page.evaluate(() => window.timezoneText.some(t => t.includes("System · Australia/Sydney")))).toBe(true);
    expect(info.errors).toEqual([]); await writeFile(`artifacts/timezone-release/${theme}-dpr${dpr}.json`, JSON.stringify({ timezone: "Australia/Sydney", maximumUpdate: await page.evaluate(() => Math.max(...window.timezoneDurations)) }));
  } finally { await context.close(); }
});
