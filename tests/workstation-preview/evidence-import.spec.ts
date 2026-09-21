import { expect, test, type Page } from "@playwright/test";
import { defaultPreferences, type TradeDocument } from "../../src/lib/workstation/types";
import { DEMO_PREFIX, demoTrades, initialDemoDocument } from "../../src/lib/workstation/demo";
import { reviewSections } from "../../src/lib/workstation/notion-template";
import { sectionEvidenceIds } from "../../src/lib/workstation/evidence";

const key = DEMO_PREFIX + demoTrades[0].id;
async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.abort());
  await page.addInitScript(({ preferences, doc, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(doc));
    const pref = "execution-lab:workstation:preferences:demo:v1";
    if (!localStorage.getItem(pref)) localStorage.setItem(pref, JSON.stringify(preferences));
  }, { key, doc: { ...initialDemoDocument(demoTrades[0]), evidence: [] }, preferences: { ...defaultPreferences(), panels: [{ id: "chart-1", interval: "5m" }], journal: true } });
  await page.goto(`/preview/trades?groupKey=${demoTrades[0].id}`);
  await expect(page.locator(".ws-notion-review")).toBeVisible();
  return errors;
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!) as TradeDocument, key);
async function pixels(page: Page, type = "image/png") {
  return page.evaluate(type => { const c = document.createElement("canvas"); c.width = 32; c.height = 24; const ctx = c.getContext("2d")!; ctx.fillStyle = "#4455dd"; ctx.fillRect(0, 0, 32, 24); return c.toDataURL(type).split(",")[1]; }, type);
}
async function imageDialog(page: Page, label: string) {
  if (label === "Previous review fields") {
    await page.getByRole("button", { name: "Review details", exact: false }).click();
    await page.getByRole("dialog", { name: "Review details", exact: true }).getByRole("button", { name: "Attach image", exact: true }).click();
    return page.getByRole("dialog", { name: "Attach image", exact: true });
  }
  const section = page.locator("details.ws-template-section").filter({ has: page.locator("summary").filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
  if (!(await section.getAttribute("open"))) { if (!await section.getByRole("button", { name: "Attach image", exact: true }).isVisible()) await section.locator("summary").first().click(); }
  await section.getByRole("button", { name: "Attach image", exact: true }).click();
  return page.getByRole("dialog", { name: "Attach image", exact: true });
}

for (const replay of [false, true]) test(`external images attach to every section with previews, central assignments and reload${replay ? " during replay" : ""}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await open(page), png = await pixels(page);
  if (replay) await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  for (const [i, [section, label]] of reviewSections.entries()) {
    const dialog = await imageDialog(page, label);
    await dialog.getByLabel("Choose image").setInputFiles({ name: `evidence-${i}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(dialog.getByRole("img")).toBeVisible();
    await dialog.getByRole("button", { name: `Attach image to ${section === "previousReview" ? "Review details" : label}`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await saved(page)).evidence.length).toBe(i + 1);
    const doc = await saved(page);
    expect(sectionEvidenceIds(doc.review.notion, section)).toContain(doc.evidence[i].id);
    expect(doc.evidence[i]).toMatchObject({ origin: "upload", timeframe: "" });
  }
  await expect(page.getByText("Captured charts", { exact: true })).toHaveCount(0);
  await expect(page.locator(".ws-section-preview figcaption").first()).toHaveText("Detach");
  const first = page.locator(".ws-evidence-grid > div").first();
  await first.locator("summary").click();
  await first.getByLabel("Takeaways", { exact: true }).check();
  await expect.poll(async () => sectionEvidenceIds((await saved(page)).review.notion, "takeaways").length).toBe(2);
  await page.reload();
  if (replay) await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  const section = page.locator("details.ws-template-section").filter({ has: page.locator("summary").filter({ hasText: /^Takeaways$/ }) });
  await expect(section.locator(".ws-section-preview")).toHaveCount(2);
  await section.getByRole("button", { name: /^Detach evidence-0/ }).click();
  await expect.poll(async () => sectionEvidenceIds((await saved(page)).review.notion, "takeaways").length).toBe(1);
  expect((await saved(page)).evidence.length).toBe(reviewSections.length);
  await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  await first.getByTitle("Remove attachment", { exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(reviewSections.length - 1);
  await page.screenshot({ path: "test-results/evidence-sections.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("replay playback does not cancel a pending clipboard import", async ({ page }) => {
  const errors = await open(page), png = await pixels(page);
  await page.getByRole("button", { name: "Replay trade", exact: true }).click();
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  const dialog = await imageDialog(page, "Takeaways");
  const before = await page.getByLabel("Replay time", { exact: true }).inputValue();
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", { ...descriptor, set(value: string) {
      if (value.startsWith("blob:")) { Object.assign(window, { releaseImageDecode: () => descriptor.set!.call(this, value) }); return; }
      descriptor.set!.call(this, value);
    } });
  });
  await dialog.getByRole("group", { name: "Paste screenshot" }).evaluate((area, data) => {
    const clipboardData = new DataTransfer(); clipboardData.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], "image.png", { type: "image/png" }));
    area.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, png);
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect.poll(() => page.getByLabel("Replay time", { exact: true }).inputValue()).not.toBe(before);
  await page.evaluate(() => (window as unknown as { releaseImageDecode?: () => void }).releaseImageDecode?.());
  await expect(dialog.getByRole("img")).toBeVisible();
  await dialog.getByRole("button", { name: "Attach image to Takeaways", exact: true }).click();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  expect((await saved(page)).evidence[0].origin).toBe("clipboard");
  expect(errors).toEqual([]);
});

test("JPEG, WebP and clipboard images normalize without intercepting text paste", async ({ page }) => {
  const errors = await open(page);
  for (const [i, type] of ["image/jpeg", "image/webp", "image/png"].entries()) {
    const data = await pixels(page, type), dialog = await imageDialog(page, "Takeaways");
    if (i < 2) await dialog.getByLabel("Choose image").setInputFiles({ name: `external.${i ? "webp" : "jpg"}`, mimeType: type, buffer: Buffer.from(data, "base64") });
    else await dialog.getByRole("group", { name: "Paste screenshot" }).evaluate((area, data) => {
      const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], "image.png", { type: "image/png" }));
      area.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, data);
    await expect(dialog.getByRole("img")).toBeVisible();
    await dialog.getByRole("button", { name: "Attach image to Takeaways", exact: true }).click();
    await expect.poll(async () => (await saved(page)).evidence.length).toBe(i + 1);
  }
  const doc = await saved(page);
  expect(doc.evidence.map(e => e.origin)).toEqual(["upload", "upload", "clipboard"]);
  expect(doc.evidence.every(e => e.image.startsWith("data:image/png;base64,"))).toBe(true);
  const text = page.getByRole("textbox", { name: "Takeaways", exact: true });
  await text.focus();
  await text.evaluate(element => { const data = new DataTransfer(); data.setData("text/plain", "Pasted journal text"); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(text).toContainText("Pasted journal text");
  expect((await saved(page)).evidence.length).toBe(3);
  expect(errors).toEqual([]);
});

test("invalid uploads and cancelled previews do not change evidence", async ({ page }) => {
  await open(page);
  const dialog = await imageDialog(page, "Takeaways");
  for (const file of [{ name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("test") }, { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("invalid") }, { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(4_000_001) }]) {
    await dialog.getByLabel("Choose image").setInputFiles(file);
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Attach image to Takeaways" })).toBeDisabled();
  }
  const data = await pixels(page);
  await dialog.getByLabel("Choose image").setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") });
  await expect(dialog.getByRole("img")).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.locator(".ws-trade-card").filter({ hasText: "AAPL" }).click();
  await expect(page.locator(".ws-trade-card.active")).toContainText("AAPL");
  expect((await saved(page)).evidence).toEqual([]);
});

test("an interrupted image save recovers on reload without duplicating the asset", async ({ page }) => {
  await open(page);
  const dialog = await imageDialog(page, "Takeaways"), png = await pixels(page);
  await dialog.getByLabel("Choose image").setInputFiles({ name: "recover.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(dialog.getByRole("img")).toBeVisible();
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, value) { if (this === localStorage && k === key) throw new DOMException("Synthetic save failure", "QuotaExceededError"); original.call(this, k, value); };
  }, key);
  await dialog.getByRole("button", { name: "Attach image to Takeaways", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("recovery draft");
  expect((await saved(page)).evidence).toEqual([]);
  await page.reload();
  await expect.poll(async () => (await saved(page)).evidence.length).toBe(1);
  const doc = await saved(page);
  expect(sectionEvidenceIds(doc.review.notion, "takeaways")).toEqual([doc.evidence[0].id]);
  expect(doc.evidence[0]).toMatchObject({ origin: "upload", name: "recover.png" });
});

test("trade navigation cancels an image still decoding", async ({ page }) => {
  await open(page);
  const dialog = await imageDialog(page, "Takeaways"), png = await pixels(page);
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
    Object.defineProperty(HTMLImageElement.prototype, "src", { ...descriptor, set(value: string) {
      if (value.startsWith("blob:")) { Object.assign(window, { releaseImageDecode: () => descriptor.set!.call(this, value) }); return; }
      descriptor.set!.call(this, value);
    } });
  });
  await dialog.getByLabel("Choose image").setInputFiles({ name: "late.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(dialog.getByRole("status")).toBeVisible();
  // Simulate navigation arriving while the attachment dialog owns focus.
  await page.locator(".ws-trade-card").filter({ hasText: "AAPL" }).locator(".ws-trade-card-main").evaluate((el: HTMLElement) => el.click());
  await expect(page.locator(".ws-trade-card.active")).toContainText("AAPL");
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { releaseImageDecode?: () => void }).releaseImageDecode?.());
  expect((await saved(page)).evidence).toEqual([]);
  expect(await page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + "demo-aapl") || '{"evidence":[]}').evidence, DEMO_PREFIX)).toEqual([]);
});
