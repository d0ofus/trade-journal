import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, emptyDocument } from "../../src/lib/workstation/types";
import { demoTrades, DEMO_PREFIX } from "../../src/lib/workstation/demo";
const id = demoTrades[0].id, legacyKey = `execution-lab:workstation:draft:demo:${id}`;
async function reveal(page: Page) {
  const field = page.getByRole("textbox", { name: "Takeaways", exact: true });
  if (!await field.isVisible()) await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  return field;
}

test("migrates old recovery safely, isolates screenshot-heavy typing, and restores image references", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const doc = emptyDocument(); doc.review.takeaway = "Migrated recovery";
  await page.addInitScript(({ doc, legacyKey, prefs }) => {
    if (sessionStorage.getItem("seeded-recovery")) return;
    sessionStorage.setItem("seeded-recovery", "1");
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 300;
    const ctx = canvas.getContext("2d")!, pixels = ctx.createImageData(300, 300);
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    ctx.putImageData(pixels, 0, 0); const image = canvas.toDataURL();
    doc.evidence = Array.from({ length: 6 }, (_, i) => ({ id: `heavy-${i}`, image, name: `Saved chart ${i}`, time: 100, revision: 0, timeframe: "1D" }));
    localStorage.setItem(legacyKey, JSON.stringify(doc));
    localStorage.setItem("execution-lab:workstation:preferences:demo:v1", JSON.stringify({ ...prefs, journal: true, list: false }));
  }, { doc, legacyKey, prefs: defaultPreferences() });
  await page.goto("/preview/trades?groupKey=demo-nvda"); const field = await reveal(page);
  await expect(field).toHaveText("Migrated recovery");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), legacyKey)).toBeNull();
  await expect(page.locator(".ws-journal-save")).toContainText("Saved on this device");
  await field.fill("");
  await page.evaluate(() => {
    const telemetry = { serializations: 0, chartMutations: 0, latency: [] as number[] };
    Object.assign(window, { journalTelemetry: telemetry });
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
      if (value && typeof value === "object" && (("review" in value && "evidence" in value) || ("document" in value && value.document?.review))) telemetry.serializations++;
      return Reflect.apply(stringify, JSON, [value, ...rest]);
    };
    const chart = document.querySelector(".ws-chart");
    if (chart) new MutationObserver(records => { telemetry.chartMutations += records.length; }).observe(chart, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("input", () => { const time = performance.now(); requestAnimationFrame(() => telemetry.latency.push(performance.now() - time)); });
  });
  const text = "Typing stays immediate while six large screenshots remain attached. ".repeat(2);
  await field.pressSequentially(text, { delay: 5 });
  await expect(field).toHaveText(text.trim());
  const profile = await page.evaluate(() => (window as unknown as { journalTelemetry: { serializations: number; chartMutations: number; latency: number[] } }).journalTelemetry);
  expect(profile.serializations).toBe(0); expect(profile.chartMutations).toBe(0); expect(profile.latency.length).toBeGreaterThan(100);
  const ordered = [...profile.latency].sort((a, b) => a - b);
  writeFileSync("artifacts/workstation-typing-profile.json", JSON.stringify({ ...profile, p95: ordered[Math.floor(ordered.length * .95)] }, null, 2));
  await info.attach("typing-profile", { body: JSON.stringify({ ...profile, p95: ordered[Math.floor(ordered.length * .95)] }), contentType: "application/json" });
  await expect(page.locator(".ws-journal-save")).toContainText("Saved on this device");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).evidence.length, DEMO_PREFIX + id)).toBe(6);
  await page.screenshot({ path: "artifacts/journal-saving-workstation-laptop.png", fullPage: true });
  await page.reload(); await expect(await reveal(page)).toHaveText(text.trim());
  expect(errors).toEqual([]);
});

test("retains legacy localStorage when IndexedDB migration fails", async ({ page }) => {
  const doc = emptyDocument(); doc.review.takeaway = "Do not lose this draft";
  await page.addInitScript(({ doc, legacyKey, prefs }) => {
    localStorage.setItem(legacyKey, JSON.stringify(doc));
    localStorage.setItem("execution-lab:workstation:preferences:demo:v1", JSON.stringify({ ...prefs, journal: true }));
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === "drafts") throw new DOMException("Quota", "QuotaExceededError"); return original.call(this, value, key); };
  }, { doc, legacyKey, prefs: defaultPreferences() });
  await page.goto("/preview/trades?groupKey=demo-nvda"); await expect(await reveal(page)).toHaveText("Do not lose this draft");
  expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).not.toBeNull();
  await expect(page.locator(".ws-error")).toContainText("Local recovery");
});
