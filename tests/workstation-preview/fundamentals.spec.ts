import { expect, test, type Locator, type Page } from "@playwright/test";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { DEMO_PREFIX } from "../../src/lib/workstation/demo";
const prefKey = "execution-lab:workstation:preferences:demo:v1";
async function open(page: Page) {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(({ prefs, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ ...prefs, journal: true, panels: [{ id: "chart-1", interval: "1d", session: "regular" }] })); }, { prefs: defaultPreferences(), key: prefKey });
  await page.goto("/preview/trades?groupKey=demo-nvda");
  await expect(page.locator(".ws-chart").first()).toHaveAttribute("data-visible-from", /\d+/);
  if (await page.locator(".ws-mobile-tabs").isVisible()) await page.locator(".ws-mobile-tabs").getByRole("button", { name: "Journal", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Fundamentals$/ }).click();
  await expect(page.getByRole("button", { name: "Attach snapshot", exact: true })).toBeEnabled();
  return errors;
}
const doc = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null"), DEMO_PREFIX + "demo-nvda");
async function hoverQuarter(page: Page, chart: Locator, index: number, count = 8) {
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  // The top of a column is deliberately away from its actual bar/line point.
  await page.mouse.move(box.x + box.width * (index + .5) / count, box.y + 2);
  await expect(page.getByRole("tooltip")).toBeVisible();
}
async function tooltipFits(page: Page) {
  const box = (await page.getByRole("tooltip").boundingBox())!, viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}
test("section, shared cutoff, complete snapshot, save/reload and removal", async ({ page }) => {
  await page.addInitScript(() => {
    const original = XMLSerializer.prototype.serializeToString;
    XMLSerializer.prototype.serializeToString = function(node) {
      const markup = original.call(this, node);
      if (node instanceof SVGSVGElement && node.classList.contains("ws-fundamentals-profile")) (window as unknown as { capturedFundamentals: string }).capturedFundamentals = markup;
      return markup;
    };
  });
  const errors = await open(page), section = page.locator(".ws-fundamentals");
  await expect(section.locator(".ws-fundamentals-mini")).toHaveCount(2);
  await expect(section.getByLabel("Before entry fundamentals preview")).toBeChecked();
  await section.getByRole("button", { name: "View fundamentals" }).click();
  const dialog = page.getByRole("dialog", { name: "NVDA fundamentals", exact: true });
  await expect(dialog.locator(".ws-fundamentals-profile")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Refresh SEC" })).toHaveCount(0);
  await dialog.getByLabel("Before entry fundamentals dialog").uncheck();
  await expect(dialog).toContainText("Latest available");
  await dialog.getByLabel("Before entry fundamentals dialog").check();
  await expect(dialog.getByRole("button", { name: "Attach snapshot", exact: true })).toBeEnabled();
  await hoverQuarter(page, dialog.locator(".ws-fundamentals-hit-area").first(), 2);
  await expect(dialog.locator("[data-fundamentals-highlight]")).toHaveCount(2);
  await expect(section.locator(".ws-fundamentals-capture [data-fundamentals-highlight], .ws-fundamentals-capture [tabindex]")).toHaveCount(0);
  await dialog.screenshot({ path: "test-results/fundamentals-modal.png" });
  // Capture with hover still active, without moving focus/pointer off the chart.
  await dialog.getByRole("button", { name: "Attach snapshot", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(async () => (await doc(page))?.evidence?.length).toBe(1);
  const captured = await page.evaluate(() => (window as unknown as { capturedFundamentals: string }).capturedFundamentals);
  expect(captured).toContain("Growth: YoY + QoQ");
  expect(captured).not.toMatch(/fundamentals-highlight|fundamentals-hit-area|role="tooltip"/);
  const saved = await doc(page), evidence = saved.evidence[0];
  expect(evidence.asset).toMatchObject({ storage: "demo", width: 2240, height: 1640 });
  expect(evidence.fundamentalsCapture).toMatchObject({ symbol: "NVDA", mode: "before-entry", cutoff: "2026-09-09" });
  expect(saved.review.notion.sectionEvidence.fundamentals).toEqual([evidence.id]);
  await dialog.getByRole("button", { name: "Close NVDA fundamentals" }).click();
  await page.reload();
  await page.locator("summary").filter({ hasText: /^Fundamentals$/ }).click();
  await expect(page.locator(".ws-section-preview")).toHaveCount(1);
  expect((await doc(page)).evidence[0].fundamentalsCapture).toEqual(evidence.fundamentalsCapture);
  await page.getByRole("button", { name: `Remove ${evidence.name} from Fundamentals`, exact: true }).click();
  await expect.poll(async () => (await doc(page))?.evidence?.length).toBe(0);
  expect(errors).toEqual([]);
});
test("changing trades resets the cutoff, closes the old modal and preserves preview privacy", async ({ page }) => {
  await open(page);
  await page.getByLabel("Before entry fundamentals preview").uncheck();
  await page.getByRole("button", { name: "View fundamentals", exact: true }).click();
  await hoverQuarter(page, page.getByRole("dialog").locator(".ws-fundamentals-hit-area").first(), 3);
  await page.mouse.move(0, 0);
  await page.getByRole("dialog", { name: "NVDA fundamentals", exact: true }).press("Escape");
  await page.locator(".ws-trade-card").filter({ hasText: "TSLA" }).click();
  const summary = page.locator("summary").filter({ hasText: /^Fundamentals$/ });
  if (!(await summary.locator("..").getAttribute("open"))) { if (!(await page.locator(".ws-fundamentals").count())) await summary.click(); }
  await expect(page.getByLabel("Before entry fundamentals preview")).toBeChecked();
  await expect(page.getByRole("dialog", { name: "NVDA fundamentals", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(page.locator("[data-fundamentals-highlight]")).toHaveCount(0);
  expect(JSON.stringify(await doc(page))).not.toContain("fundamentalsCapture");
});

test("mini charts inspect precise amounts, losses, gaps and derived quarters without saves or requests", async ({ page }) => {
  const errors = await open(page);
  const before = await doc(page), requests: string[] = [];
  page.on("request", request => { if (/\/api\/(workstation\/fundamentals|closed-trades)/.test(request.url())) requests.push(request.url()); });
  const revenue = page.locator(".ws-fundamentals-mini").first().locator(".ws-fundamentals-hit-area");
  const income = page.locator(".ws-fundamentals-mini").last().locator(".ws-fundamentals-hit-area");
  await hoverQuarter(page, revenue, 0);
  await expect(page.getByRole("tooltip")).toContainText("FY24 Q3");
  await expect(page.getByRole("tooltip")).toContainText("Period ended 2024-09-30");
  await expect(page.getByRole("tooltip")).toContainText("$298,000,000");
  await expect(page.getByRole("tooltip")).toContainText("+12.0%");
  await expect(page.getByRole("tooltip")).not.toContainText("Net income");
  await hoverQuarter(page, income, 0);
  await expect(page.getByRole("tooltip")).toContainText("-$12,500,000");
  await income.focus();
  await income.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toContainText("FY24 Q4");
  await expect(page.getByRole("tooltip")).toContainText("Derived Q4");
  await income.press("ArrowRight");
  await expect(page.getByRole("tooltip")).toContainText("FY25 Q1");
  await expect(page.getByRole("tooltip")).toContainText("Net incomeUnavailable");
  await hoverQuarter(page, income, 2);
  await expect(page.getByRole("tooltip")).toContainText("Net incomeUnavailable");
  await income.press("End");
  await expect(page.getByRole("tooltip")).toContainText("FY26 Q2");
  await income.press("Home");
  await expect(page.getByRole("tooltip")).toContainText("FY24 Q3");
  await income.press("ArrowLeft");
  await expect(page.getByRole("tooltip")).toContainText("FY24 Q3");
  await income.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect(await doc(page)).toEqual(before);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("modal synchronizes quarter highlights, preserves summary, and resets on cutoff change", async ({ page }) => {
  const errors = await open(page), before = await doc(page);
  await page.getByRole("button", { name: "View fundamentals" }).click();
  const dialog = page.getByRole("dialog", { name: "NVDA fundamentals", exact: true });
  const charts = dialog.locator(".ws-fundamentals-hit-area");
  const svg = dialog.locator(".ws-fundamentals-profile");
  const summary = await svg.locator("text").allTextContents();
  await hoverQuarter(page, charts.first(), 0);
  await expect(page.getByRole("tooltip")).toContainText("$298,000,000");
  await expect(page.getByRole("tooltip")).toContainText("-$12,500,000");
  await expect(page.getByRole("tooltip").locator("dt")).toHaveText(["YoY", "QoQ", "YoY", "QoQ"]);
  await expect(dialog.locator('[data-fundamentals-highlight="0"]')).toHaveCount(2);
  await hoverQuarter(page, charts.last(), 7);
  await expect(page.getByRole("tooltip")).toContainText("FY26 Q2");
  await expect(dialog.locator('[data-fundamentals-highlight="7"]')).toHaveCount(2);
  await tooltipFits(page);
  expect(await svg.locator("text").allTextContents()).toEqual(summary);
  // Escape dismisses a mouse tooltip even while keyboard focus is elsewhere.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await charts.last().focus();
  await charts.last().press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await charts.last().press("ArrowLeft");
  await expect(page.getByRole("tooltip")).toContainText("FY24 Q3");
  await dialog.getByLabel("Before entry fundamentals dialog").uncheck();
  await expect(dialog).toContainText("Latest available");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(dialog.locator("[data-fundamentals-highlight]")).toHaveCount(0);
  expect(await doc(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test.describe("touch fundamentals", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("tap selects periods and tooltips remain inside the narrow viewport", async ({ page }) => {
    const errors = await open(page);
    const mini = page.locator(".ws-fundamentals-mini").first().locator(".ws-fundamentals-hit-area");
    await mini.tap();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await tooltipFits(page);
    await page.getByRole("button", { name: "View fundamentals" }).tap();
    const dialog = page.getByRole("dialog", { name: "NVDA fundamentals", exact: true });
    await dialog.locator(".ws-fundamentals-hit-area").first().tap({ position: { x: 8, y: 8 } });
    await expect(page.getByRole("tooltip")).toContainText("FY24 Q3");
    await tooltipFits(page);
    await dialog.screenshot({ path: "test-results/fundamentals-tooltip-mobile.png" });
    await dialog.getByRole("heading").tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
test("the compact preview fits a narrow journal", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 950 });
  await open(page);
  const section = page.locator(".ws-fundamentals");
  expect(await section.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await section.screenshot({ path: "test-results/fundamentals-preview.png" });
});
