import { writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

const created: string[] = [];
async function login(context: BrowserContext) {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
}
async function openCapture(page: Page, id: string) {
  await page.goto(`/journal?entryId=${id}`);
  await expect(page.getByTestId("journal-save-status")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Thesis", exact: true })).toBeVisible();
}
async function newDraft(context: BrowserContext) {
  const res = await context.request.post("/api/journal/drafts", { data: { symbol: "SAVEQA", thesis: "Baseline", trigger: "Preserved trigger", tags: { SETUP: ["save-test"] } } });
  expect(res.ok()).toBe(true); const { entry } = await res.json(); created.push(entry.id); return entry.id as string;
}
const read = async (context: BrowserContext, id: string) => (await (await context.request.get(`/api/journal/${id}`)).json()).entry;
test.beforeEach(async ({ context }) => {
  await login(context);
  // Keep external widgets out of the persistence test; app-owned charts still mount.
  await context.route("https://s3.tradingview.com/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await context.route("**/api/market/candles**", route => route.fulfill({ json: { candles: [], metadata: { warnings: [] } } }));
  await context.route("**/api/market-context**", route => route.fulfill({ json: {} }));
});
test.afterAll(async () => { await prisma.journalEntry.deleteMany({ where: { id: { in: created } } }); await prisma.$disconnect(); });

test("creating and refreshing a capture keeps one entry and recovers later edits at /journal", async ({ page, context }) => {
  await page.goto("/journal"); await expect(page.getByTestId("journal-save-status")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("textbox", { name: "Symbol", exact: true }).fill("NEWQA");
  await page.getByRole("textbox", { name: "Thesis", exact: true }).fill("Created capture");
  const creation = page.waitForResponse(response => response.url().endsWith("/api/journal") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create Draft" }).click();
  const { entry } = await (await creation).json(); created.push(entry.id);
  await expect(page.getByTestId("journal-save-status")).toHaveText("Saved");
  let posts = 0; page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/journal")) posts++; });
  await page.getByRole("button", { name: "Refresh Draft" }).click();
  await expect(page.getByTestId("journal-save-status")).toHaveText("Saved"); expect(posts).toBe(0);
  await page.route(`**/api/journal/${entry.id}`, route => route.request().method() === "PATCH" ? route.abort() : route.continue());
  await page.getByRole("textbox", { name: "Thesis", exact: true }).fill("Later unsaved capture");
  await expect(page.getByTestId("journal-save-status")).toContainText("Save paused");
  const storage = await page.evaluate(() => ({ tab: sessionStorage.getItem("execution-lab:recovery-tab"), entity: sessionStorage.getItem("execution-lab:journal:active-entity") }));
  await page.close();
  const recovered = await context.newPage();
  await recovered.addInitScript(({ tab, entity }) => { if (tab) sessionStorage.setItem("execution-lab:recovery-tab", tab); if (entity) sessionStorage.setItem("execution-lab:journal:active-entity", entity); }, storage);
  await recovered.goto("/journal"); await expect(recovered.getByTestId("journal-save-status")).toBeVisible({ timeout: 30000 });
  await recovered.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(recovered.getByRole("textbox", { name: "Thesis", exact: true })).toHaveValue("Later unsaved capture");
  await expect.poll(async () => (await read(context, entry.id)).thesis).toBe("Later unsaved capture");
});

test("Quick Capture uses trailing saves, retains newer typing, and shares revisions with Full Entry and uploads", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const id = await newDraft(context); await openCapture(page, id); await page.clock.install({ time: new Date("2026-09-16T08:00:00Z") }); await page.clock.pauseAt(new Date("2026-09-16T08:00:00Z"));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: Array<{ thesis: string; expectedUpdatedAt: string }> = []; let active = 0, peak = 0;
  await page.route(`**/api/journal/${id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes.push(route.request().postDataJSON()); active++; peak = Math.max(peak, active);
    if (writes.length === 1) await gate;
    const response = await route.fetch(); active--; await route.fulfill({ response });
  });
  const thesis = page.getByRole("textbox", { name: "Thesis", exact: true });
  await thesis.fill("First edit"); await page.clock.runFor(1000);
  await thesis.fill("First saved draft"); await page.clock.runFor(1199); expect(writes).toHaveLength(0);
  await page.clock.runFor(1); await expect.poll(() => writes.length).toBe(1);
  await thesis.fill("Newer text during the request"); await page.clock.runFor(500); release();
  await expect(page.getByTestId("journal-save-status")).toContainText("Unsaved changes");
  await expect(thesis).toHaveValue("Newer text during the request"); expect(writes).toHaveLength(1);
  await page.clock.runFor(700); await expect.poll(() => writes.length).toBe(2);
  await expect(page.getByTestId("journal-save-status")).toHaveText("Saved", { timeout: 30000 });
  expect((await read(context, id)).thesis).toBe("Newer text during the request"); expect(peak).toBe(1);
  expect(writes[1].expectedUpdatedAt).not.toBe(writes[0].expectedUpdatedAt);
  await page.clock.resume();
  await page.getByRole("button", { name: "Full Entry", exact: true }).last().click();
  const setup = page.getByRole("textbox", { name: "Setup", exact: true });
  await setup.fill("Manual Full Entry edit"); await page.clock.runFor(2000); expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Save Entry", exact: true }).click();
  await expect(page.getByTestId("journal-save-status")).toHaveText("Saved", { timeout: 30000 });
  expect((await read(context, id)).setup).toBe("Manual Full Entry edit");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await thesis.fill("Text saved with screenshot");
  await page.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+p0AAAAASUVORK5CYII=", "base64") });
  await expect(page.getByTestId("journal-save-status")).toHaveText("Saved", { timeout: 30000 });
  await expect.poll(async () => (await read(context, id)).charts.length).toBe(1);
  await thesis.fill("Immediately before navigation");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  expect((await read(context, id)).thesis).toBe("Immediately before navigation"); expect(errors).toEqual([]);
});

test("Quick Capture recovers failed saves and preserves conflicting tab drafts", async ({ page, context }) => {
  const id = await newDraft(context); await openCapture(page, id);
  await page.route(`**/api/journal/${id}`, route => route.request().method() === "PATCH" ? route.abort() : route.continue());
  await page.getByRole("textbox", { name: "Thesis", exact: true }).fill("Offline recovered text");
  await expect(page.getByTestId("journal-save-status")).toContainText("Save paused");
  const ownTab = await page.evaluate(() => sessionStorage.getItem("execution-lab:recovery-tab"));
  await page.close();
  const recovered = await context.newPage();
  await recovered.addInitScript(tab => { if (tab) sessionStorage.setItem("execution-lab:recovery-tab", tab); }, ownTab);
  await openCapture(recovered, id);
  await expect(recovered.getByRole("textbox", { name: "Thesis", exact: true })).toHaveValue("Offline recovered text");
  await expect.poll(async () => (await read(context, id)).thesis).toBe("Offline recovered text");
  const other = await context.newPage();
  const recoveredTab = await recovered.evaluate(() => sessionStorage.getItem("execution-lab:recovery-tab"));
  await other.addInitScript(tab => { if (tab) sessionStorage.setItem("execution-lab:recovery-tab", tab); }, recoveredTab);
  await openCapture(other, id);
  expect(await other.evaluate(() => sessionStorage.getItem("execution-lab:recovery-tab"))).not.toBe(recoveredTab);
  await recovered.getByRole("textbox", { name: "Thesis", exact: true }).fill("Winning draft");
  await expect.poll(async () => (await read(context, id)).thesis).toBe("Winning draft");
  await other.getByRole("textbox", { name: "Thesis", exact: true }).fill("Conflicting draft");
  await expect(other.getByTestId("journal-save-status")).toContainText("Save paused");
  const download = other.waitForEvent("download"); await other.getByRole("button", { name: "Export recovery draft" }).click();
  expect((await download).suggestedFilename()).toBe("journal-recovery.json");
  other.once("dialog", dialog => dialog.accept()); await other.getByRole("button", { name: "Reload saved entry" }).click();
  await expect(other.getByRole("textbox", { name: "Thesis", exact: true })).toHaveValue("Winning draft");
  expect((await read(context, id)).trigger).toBe("Preserved trigger");
});

test("rapid Quick Capture typing leaves chart rendering and full-draft serialization off the input path", async ({ page, context }, info) => {
  const id = await newDraft(context); await openCapture(page, id);
  await page.route(`**/api/journal/${id}/charts`, route => route.fulfill({ status: 503, json: { error: "Temporary attachment failure" } }));
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext("2d")!, pixels = ctx.createImageData(400, 400);
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
    ctx.putImageData(pixels, 0, 0); return canvas.toDataURL().split(",")[1];
  });
  for (let i = 0; i < 3; i++) {
    await page.locator('input[type="file"]').setInputFiles({ name: `heavy-${i}.png`, mimeType: "image/png", buffer: Buffer.from(image, "base64") });
    await expect(page.getByTestId("journal-save-status")).toContainText("Save paused");
  }
  const thesis = page.getByRole("textbox", { name: "Thesis", exact: true }); await thesis.fill("Profile ");
  await page.evaluate(() => {
    const profile = { serializations: 0, mutations: 0, latency: [] as number[] }; Object.assign(window, { captureProfile: profile });
    const stringify = JSON.stringify;
    JSON.stringify = function (value, ...rest) {
      if (value && typeof value === "object" && ("thesis" in value || "form" in value)) profile.serializations++;
      return Reflect.apply(stringify, JSON, [value, ...rest]);
    };
    const chart = document.querySelector("canvas")?.parentElement;
    if (chart) new MutationObserver(records => { profile.mutations += records.length; }).observe(chart, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("input", () => { const start = performance.now(); requestAnimationFrame(() => profile.latency.push(performance.now() - start)); });
  });
  const text = "Rapid typing with large pending screenshots. ".repeat(3); await thesis.pressSequentially(text, { delay: 5 });
  await expect(thesis).toHaveValue(`Profile ${text}`);
  const profile = await page.evaluate(() => (window as unknown as { captureProfile: { serializations: number; mutations: number; latency: number[] } }).captureProfile);
  expect(profile.serializations).toBe(0); expect(profile.mutations).toBe(0);
  const sorted = [...profile.latency].sort((a, b) => a - b);
  writeFileSync("artifacts/quick-capture-typing-profile.json", JSON.stringify({ ...profile, p95: sorted[Math.floor(sorted.length * .95)] }, null, 2));
  await info.attach("quick-capture-typing", { body: JSON.stringify({ ...profile, p95: sorted[Math.floor(sorted.length * .95)] }), contentType: "application/json" });
  await page.setViewportSize({ width: 1366, height: 900 }); await page.screenshot({ path: "artifacts/quick-capture-laptop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: "artifacts/quick-capture-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
