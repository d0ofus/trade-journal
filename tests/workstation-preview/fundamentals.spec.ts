import { expect, test, type Page } from "@playwright/test";
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
test("section, shared cutoff, complete snapshot, save/reload and removal", async ({ page }) => {
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
  await dialog.screenshot({ path: "test-results/fundamentals-modal.png" });
  await dialog.getByRole("button", { name: "Attach snapshot", exact: true }).click();
  await expect.poll(async () => (await doc(page))?.evidence?.length).toBe(1);
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
  await page.getByRole("dialog", { name: "NVDA fundamentals", exact: true }).press("Escape");
  await page.locator(".ws-trade-card").filter({ hasText: "TSLA" }).click();
  const summary = page.locator("summary").filter({ hasText: /^Fundamentals$/ });
  if (!(await summary.locator("..").getAttribute("open"))) { if (!(await page.locator(".ws-fundamentals").count())) await summary.click(); }
  await expect(page.getByLabel("Before entry fundamentals preview")).toBeChecked();
  await expect(page.getByRole("dialog", { name: "NVDA fundamentals", exact: true })).toHaveCount(0);
  expect(JSON.stringify(await doc(page))).not.toContain("fundamentalsCapture");
});
test("the compact preview fits a narrow journal", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 950 });
  await open(page);
  const section = page.locator(".ws-fundamentals");
  expect(await section.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await section.screenshot({ path: "test-results/fundamentals-preview.png" });
});
