import { test, expect, type BrowserContext } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { prisma } from "../../src/lib/prisma";
import { refreshMaterializedClosedTrades } from "../../src/lib/server/closed-trades-materialized";
import { verifyEvidencePng } from "../../src/lib/server/evidence-r2";
import { assetReference } from "../../src/lib/server/evidence-assets";
import { defaultPreferences } from "../../src/lib/workstation/types";
import { candleFixture } from "./candle-fixture";

// Real application authentication, review API and isolated PostgreSQL; only object transport is mocked.
let tradeId: string, instrumentId: string, accountId: string;
const endpoint = () => `/api/closed-trades/${encodeURIComponent(tradeId)}/workstation`;
async function login(context: BrowserContext) {
  const { csrfToken } = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", { form: { csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
  expect((await (await context.request.get("/api/auth/session")).json()).user.name).toBe("phase2-reviewer");
}
test.beforeAll(async () => {
  const account = await prisma.account.upsert({ where: { ibkrAccount: "DEMO-WORKSTATION" }, create: { ibkrAccount: "DEMO-WORKSTATION", name: "Isolated evidence validation", baseCurrency: "USD" }, update: {} }); accountId = account.id;
  const instrument = await prisma.instrument.create({ data: { symbol: "R2TEST", exchange: randomUUID(), assetType: "STOCK", currency: "USD" } }); instrumentId = instrument.id;
  for (const [index, side, price] of [[0, "BUY", 100], [1, "SELL", 110]] as const) await prisma.execution.create({ data: { dedupeKey: randomUUID(), accountId, instrumentId, executedAt: new Date(`2026-09-10T${index ? "15" : "14"}:30:00Z`), side, quantity: 10, price, currency: "USD" } });
  await refreshMaterializedClosedTrades({ accountIds: [accountId] });
  tradeId = (await prisma.closedTrade.findFirstOrThrow({ where: { accountId, instrumentId, isStale: false } })).groupKey;
});
test.afterAll(async () => {
  if (tradeId) {
    await prisma.evidenceAssetReference.deleteMany({ where: { asset: { tradeId } } }); await prisma.evidenceUploadSession.deleteMany({ where: { tradeId } }); await prisma.evidenceAsset.deleteMany({ where: { tradeId } });
    await prisma.journalEntry.deleteMany({ where: { links: { some: { targetId: tradeId } } } }); await prisma.journalLink.deleteMany({ where: { targetId: tradeId } }); await prisma.closedTradeNote.deleteMany({ where: { groupKey: tradeId } }); await prisma.workstationTradeView.deleteMany({ where: { groupKey: tradeId } });
    await prisma.closedTrade.deleteMany({ where: { instrumentId } }); await prisma.execution.deleteMany({ where: { instrumentId } }); await prisma.instrument.delete({ where: { id: instrumentId } });
  }
  await prisma.$disconnect();
});
test.beforeEach(async ({ context, page }) => {
  await context.route("**/api/workstation/candles?**", route => route.fulfill({ json: candleFixture(route.request().url()) }));
  await context.route("**/api/workstation/notion/**", route => route.fulfill({ status: 503, json: { error: "Notion is intentionally disconnected in isolated image tests." } }));
  await context.route("**/market-metrics**", route => route.fulfill({ status: 503, json: { error: "No live provider in this test" } }));
  await context.route("**/api/workstation/peer-candles**", route => route.fulfill({ status: 503, json: { error: "No live provider in this test" } }));
  await page.addInitScript(prefs => localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify({ ...prefs, journal: true, panels: [{ id: "chart-1", interval: "1d" }] })), defaultPreferences());
});
test("private image interfaces require authentication and reject cross-origin writes", async ({ context }) => {
  expect([401, 307]).toContain((await context.request.get(`/api/closed-trades/${encodeURIComponent(tradeId)}/evidence?upload=missing`, { maxRedirects: 0 })).status());
  await login(context);
  expect((await context.request.post(`/api/closed-trades/${encodeURIComponent(tradeId)}/evidence`, { headers: { Origin: "https://untrusted.invalid" }, data: { action: "create", clientKey: "one", bytes: 1 } })).status()).toBe(403);
  expect((await context.request.get(`/api/closed-trades/${encodeURIComponent(tradeId)}/evidence?asset=missing`)).status()).toBe(404);
});
test("large originals upload while text stays editable, then survive authenticated save/reload/export", async ({ page, context }) => {
  test.setTimeout(120_000); await login(context);
  let original: Buffer | undefined, thumbnail: Buffer | undefined, reference: ReturnType<typeof assetReference> | undefined;
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/__e2e-evidence/*", async route => {
    if (route.request().method() === "PUT") { original = route.request().postDataBuffer()!; await gate; await route.fulfill({ status: 200 }); }
    else await route.fulfill({ status: 200, contentType: "image/png", body: route.request().url().endsWith("thumbnail") ? thumbnail! : original! });
  });
  await page.route("**/api/closed-trades/*/evidence**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { url: `http://127.0.0.1:3101/__e2e-evidence/${new URL(route.request().url()).searchParams.get("variant") === "thumbnail" ? "thumbnail" : "original"}` } });
    const body = route.request().postDataJSON();
    if (body.action === "create") return route.fulfill({ json: { id: "isolated-upload", url: "http://127.0.0.1:3101/__e2e-evidence/original", headers: { "Content-Type": "image/png" } } });
    const verified = await verifyEvidencePng(original!); thumbnail = verified.thumbnail;
    const key = randomUUID();
    const asset = await prisma.evidenceAsset.create({ data: { tradeId, ownerId: "local-user", sha256: verified.sha256, notionHash: verified.notionHash, bytes: verified.bytes, width: verified.width, height: verified.height, thumbnailBytes: thumbnail.length, objectKey: `originals/${key}/${verified.sha256}.png`, thumbnailKey: `thumbnails/${key}/${verified.sha256}.png` } }); reference = assetReference(asset);
    return route.fulfill({ json: { asset: reference } });
  });
  await page.goto(`/trades?groupKey=${encodeURIComponent(tradeId)}`);
  await page.locator("summary").filter({ hasText: /^Takeaways$/ }).click();
  await page.getByRole("button", { name: "Attach image", exact: true }).click();
  const png = await sharp(randomBytes(1300 * 1200 * 3), { raw: { width: 1300, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const dialog = page.getByRole("dialog", { name: "Attach image", exact: true });
  await dialog.getByLabel("Choose image").setInputFiles({ name: "large-original.png", mimeType: "image/png", buffer: png });
  await dialog.getByRole("button", { name: "Attach image to Takeaways" }).click(); await expect(dialog).toHaveCount(0);
  await expect.poll(() => original?.length ?? 0).toBeGreaterThan(4_500_000);
  await page.getByRole("textbox", { name: "Takeaways", exact: true }).fill("Edited while the original uploads");
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.takeaway).toContain("Edited while"); release();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).evidence.length).toBe(1);
  const saved = await (await context.request.get(endpoint())).json(); expect(saved.evidence[0]).toMatchObject({ image: "", asset: reference }); expect(saved.review.takeaway).toContain("Edited while");
  expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThan(100_000);
  await page.reload(); await page.getByRole("button", { name: "Show Evidence", exact: true }).click();
  const item = page.locator(".ws-evidence-grid > div").first(); await item.locator("summary").click(); await item.getByLabel("Peers", { exact: true }).check();
  await expect.poll(async () => (await (await context.request.get(endpoint())).json()).review.notion?.sections?.peers?.evidenceIds ?? []).toEqual([saved.evidence[0].id]);
  await page.getByRole("button", { name: "Export review for Notion", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Review page ZIP", exact: true }).click();
  const files = unzipSync(await readFile((await (await download).path())!)), originals = Object.entries(files).filter(([name]) => name.endsWith(".png"));
  expect(originals).toHaveLength(1); expect(createHash("sha256").update(originals[0][1]).digest("hex")).toBe(reference!.sha256);
  const latest = await (await context.request.get(endpoint())).json();
  const oldTab = await context.request.patch(endpoint(), { data: { expectedRevision: latest.revision, document: { ...latest, evidenceProtocol: undefined } } }); expect(oldTab.status()).toBe(409);
  expect((await oldTab.json()).error).toMatch(/reload/i);
});
