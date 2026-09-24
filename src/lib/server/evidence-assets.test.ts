import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { createEvidenceUpload, finalizeEvidenceUpload, evidenceUploadStatus, cancelEvidenceUpload } from "./evidence-assets";
import { verifyEvidencePng } from "./evidence-r2";
import { readWorkstationDocument, saveWorkstationDocument } from "./trade-workstation";
import { attachEvidence, removeEvidence } from "@/lib/workstation/evidence";
import { maintainEvidence } from "./evidence-maintenance";
import { migrateInlineReviewEvidence } from "./evidence-migration";
import { createEvidenceBackup, evidenceBackupPage } from "./evidence-backup";
import { verifyCompleteEvidenceBackup, restoreEvidenceObjectsToNonProduction, restoreCompleteEvidenceBackupToIsolated } from "./evidence-backup-restore";
import { randomBytes } from "node:crypto";
import { assetReference, readOriginalAsset, validateReviewAssets } from "./evidence-assets";
import { databaseBackup } from "./database-backup";
import type { Evidence } from "@/lib/workstation/types";

const objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("./evidence-r2", async original => ({ ...await original<typeof import("./evidence-r2")>(), signEvidencePut: vi.fn(async key => `https://isolated.invalid/${key}`), signEvidenceGet: vi.fn(async key => `https://isolated.invalid/${key}`), putEvidenceObject: vi.fn(async (key: string, bytes: Buffer) => { if (objects.has(key)) throw { $metadata: { httpStatusCode: 412 } }; objects.set(key, Buffer.from(bytes)); }), readEvidenceObject: vi.fn(async (key: string, bytes?: number) => { const value = objects.get(key); if (!value || bytes !== undefined && value.length !== bytes) throw new Error("Missing or invalid bytes"); return Buffer.from(value); }), deleteEvidenceObject: vi.fn(async key => { objects.delete(key); }), evidenceObjectExists: vi.fn(async key => objects.has(key) ? { bytes: objects.get(key)!.length } : null) }));
const fixtures: { groupKey: string; accountId: string; instrumentId: string }[] = [];
async function fixture() {
  const groupKey = `asset-test-${crypto.randomUUID()}`;
  const account = await prisma.account.create({ data: { ibkrAccount: groupKey, name: groupKey, baseCurrency: "USD" } });
  const instrument = await prisma.instrument.create({ data: { symbol: "ASSETTEST", exchange: groupKey, assetType: "STOCK", currency: "USD" } });
  fixtures.push({ groupKey, accountId: account.id, instrumentId: instrument.id });
  await prisma.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol: "ASSETTEST", direction: "LONG", openTime: new Date("2024-09-10T14:30Z"), closeTime: new Date("2024-09-10T15:30Z"), tradeDate: new Date("2024-09-10"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 98, totalCommission: 2 } });
  return groupKey;
}
const png = () => sharp({ create: { width: 120, height: 80, channels: 4, background: "#112233" } }).png().toBuffer();
async function upload(trade: string, clientKey: string, bytes: Buffer) {
  const session = await createEvidenceUpload(trade, "owner", clientKey, bytes.length);
  const row = await prisma.evidenceUploadSession.findUniqueOrThrow({ where: { id: session.id } }); objects.set(row.temporaryKey, bytes);
  return { session, row, asset: await finalizeEvidenceUpload(session.id, trade, "owner") };
}
beforeEach(() => { objects.clear(); vi.stubEnv("EVIDENCE_R2_WRITES_ENABLED", "1"); vi.stubEnv("E2E_DEMO_ONLY_WRITES", "0"); });
afterEach(async () => {
  await prisma.evidenceBackupSession.deleteMany({ where: { ownerId: "evidence-test" } });
  for (const f of fixtures.splice(0)) {
    await prisma.evidenceAssetReference.deleteMany({ where: { asset: { tradeId: f.groupKey } } }); await prisma.evidenceUploadSession.deleteMany({ where: { tradeId: f.groupKey } }); await prisma.evidenceAsset.deleteMany({ where: { tradeId: f.groupKey } });
    await prisma.journalEntry.deleteMany({ where: { links: { some: { targetId: f.groupKey } } } }); await prisma.journalLink.deleteMany({ where: { targetId: f.groupKey } }); await prisma.closedTradeNote.deleteMany({ where: { groupKey: f.groupKey } }); await prisma.closedTrade.deleteMany({ where: { groupKey: f.groupKey } }); await prisma.instrument.delete({ where: { id: f.instrumentId } }); await prisma.account.delete({ where: { id: f.accountId } });
  }
  vi.unstubAllEnvs();
});
describe("private originals against isolated PostgreSQL and an in-memory object store", () => {
  it("accepts an original above Vercel's buffered payload limit while saving only metadata", async () => {
    const trade = await fixture(), bytes = await sharp(randomBytes(1300 * 1200 * 3), { raw: { width: 1300, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    expect(bytes.length).toBeGreaterThan(4_500_000);
    const { asset } = await upload(trade, "large", bytes), initial = await readWorkstationDocument(trade);
    const doc = await saveWorkstationDocument(trade, attachEvidence(initial, { id: "large", asset, image: "", name: "Large lossless capture", timeframe: "1d", time: 1, revision: 0 }, "peers"), 0);
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(100_000);
    expect((await readOriginalAsset(asset.id, trade)).bytes).toEqual(bytes);
  });
  it("enforces aggregate original-byte quotas server-side and counts repeated originals once", async () => {
    const trade = await fixture(), initial = await readWorkstationDocument(trade), evidence: Evidence[] = [];
    for (const [i, bytes] of [20_000_000, 20_000_000, 10_000_000, 1].entries()) {
      const sha256 = String(i).repeat(64), row = await prisma.evidenceAsset.create({ data: { tradeId: trade, ownerId: "owner", sha256, notionHash: sha256, bytes, width: 10, height: 10, thumbnailBytes: 1, objectKey: `originals/quota/${sha256}.png`, thumbnailKey: `thumbnails/quota/${sha256}.png` } });
      evidence.push({ id: `quota-${i}`, name: "Quota fixture", image: "", asset: assetReference(row), time: 1, timeframe: "1d", revision: 0 });
    }
    const exact = { ...initial, evidence: evidence.slice(0, 3) };
    await prisma.$transaction(tx => validateReviewAssets(tx, trade, exact, initial));
    await expect(prisma.$transaction(tx => validateReviewAssets(tx, trade, { ...initial, evidenceProtocol: 2, evidence }, exact))).rejects.toThrow(/50,000,000/);
    await prisma.$transaction(tx => validateReviewAssets(tx, trade, { ...exact, evidence: [...exact.evidence, { ...evidence[0], id: "duplicate" }] }, exact));
  });
  it("freezes a complete checksum-verified backup and restores identical originals idempotently", async () => {
    const trade = await fixture(), bytes = await png(), { asset } = await upload(trade, "backup", bytes), initial = await readWorkstationDocument(trade);
    await saveWorkstationDocument(trade, attachEvidence(initial, { id: "backup", asset, image: "", name: "Backup original", timeframe: "1d", time: 1, revision: 0 }, "peers"), 0);
    const metadata = await (await databaseBackup()).json(); expect(metadata.errors).toBeUndefined();
    const backup = await createEvidenceBackup("evidence-test");
    const files: Record<string, Uint8Array> = {}; let offset: number | null = 0;
    while (offset !== null) {
      const page = await evidenceBackupPage(backup.id, "evidence-test", offset);
      if (page.manifest) files["manifest.json"] = Buffer.from(JSON.stringify(page.manifest));
      for (const file of page.files) files[file.name] = objects.get(new URL(file.url).pathname.slice(1))!;
      offset = page.next;
    }
    const verified = verifyCompleteEvidenceBackup(files);
    expect(verified.manifest.originals.some(a => a.id === asset.id)).toBe(true);
    expect(files[`originals/${asset.id}.png`]).toEqual(bytes);
    expect(await prisma.evidenceAssetReference.count({ where: { assetId: asset.id, kind: "backup", key: backup.id } })).toBe(1);
    expect(() => verifyCompleteEvidenceBackup({ ...files, [`originals/${asset.id}.png`]: Buffer.from("corrupt") })).toThrow(/corrupt/);
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("EVIDENCE_R2_ACCOUNT_ID", "test"); vi.stubEnv("EVIDENCE_R2_BUCKET", "trade-journal-evidence-nonproduction"); vi.stubEnv("EVIDENCE_R2_ACCESS_KEY_ID", "test"); vi.stubEnv("EVIDENCE_R2_SECRET_ACCESS_KEY", "test");
    objects.clear(); await restoreEvidenceObjectsToNonProduction(files); await restoreEvidenceObjectsToNonProduction(files);
    expect((await readOriginalAsset(asset.id)).bytes).toEqual(bytes);
    if (process.env.TEST_EVIDENCE_RESTORE_DATABASE_URL) {
      // An optional second empty disposable database exercises the real restore transaction.
      // Never clear a populated target to make this test pass.
      vi.stubEnv("DATABASE_URL", process.env.TEST_EVIDENCE_RESTORE_DATABASE_URL); vi.stubEnv("DIRECT_URL", process.env.TEST_EVIDENCE_RESTORE_DATABASE_URL); vi.stubEnv("EVIDENCE_RESTORE_APPROVED", "1");
      expect(await restoreCompleteEvidenceBackupToIsolated(files)).toMatchObject({ restored: true, originals: verified.manifest.originals.length, rows: verified.plan.totalRows });
      await expect(restoreCompleteEvidenceBackupToIsolated(files)).rejects.toThrow(/not empty/);
    }
    vi.stubEnv("VERCEL_ENV", "production"); await expect(restoreEvidenceObjectsToNonProduction(files)).rejects.toThrow(/production/);
  });
  it("decodes PNGs without changing originals and rejects corrupt/oversized data", async () => {
    const bytes = await png(), original = Buffer.from(bytes), verified = await verifyEvidencePng(bytes);
    expect(bytes.equals(original)).toBe(true); expect(verified).toMatchObject({ width: 120, height: 80, bytes: bytes.length }); expect(verified.thumbnail.length).toBeGreaterThan(0);
    await expect(verifyEvidencePng(Buffer.from("not a png"))).rejects.toThrow(/PNG/); await expect(verifyEvidencePng(bytes.subarray(0, 35))).rejects.toThrow(/corrupt/); await expect(verifyEvidencePng(Buffer.alloc(20_000_001))).rejects.toThrow(/20,000,000/);
  });
  it("reconciles completed PUTs, finalizes idempotently, and deduplicates within a trade", async () => {
    const trade = await fixture(), bytes = await png(), first = await upload(trade, "one", bytes), second = await upload(trade, "two", bytes);
    expect(second.asset.id).toBe(first.asset.id); expect(await finalizeEvidenceUpload(first.session.id, trade, "owner")).toEqual(first.asset);
    expect((await evidenceUploadStatus(first.session.id, trade, "owner")).state).toBe("ready"); expect(await prisma.evidenceAsset.count({ where: { tradeId: trade } })).toBe(1);
    objects.set(first.row.temporaryKey, Buffer.from("later overwritten temporary data"));
    const asset = await prisma.evidenceAsset.findUniqueOrThrow({ where: { id: first.asset.id } }); expect(objects.get(asset.objectKey)).toEqual(bytes);
  });
  it("blocks another owner/trade, stale finalization, and cancelled sessions", async () => {
    const trade = await fixture(), other = await fixture(), bytes = await png();
    const session = await createEvidenceUpload(trade, "owner", "one", bytes.length);
    await expect(finalizeEvidenceUpload(session.id, other, "owner")).rejects.toThrow(/not found/);
    await expect(finalizeEvidenceUpload(session.id, trade, "another-owner")).rejects.toThrow(/not found/);
    await cancelEvidenceUpload(session.id, trade, "owner"); await expect(finalizeEvidenceUpload(session.id, trade, "owner")).rejects.toThrow(/cancelled/);
    await prisma.closedTrade.update({ where: { groupKey: trade }, data: { isStale: true } }); await expect(createEvidenceUpload(trade, "owner", "two", bytes.length)).rejects.toThrow(/Stale/);
  });
  it("saves metadata only, preserves comparison drawings and rejects stale clients or forged metadata", async () => {
    const trade = await fixture(), { asset } = await upload(trade, "one", await png());
    let doc = await readWorkstationDocument(trade); doc = attachEvidence(doc, { id: "one", asset, image: "", name: "Original", time: 1, timeframe: "1d", revision: 0 }, "peers"); doc.evidenceProtocol = 2;
    doc.comparison = { drawings: { ABC: [{ id: "pin", tool: "pin", points: [{ time: 100, price: 5 }], text: "comparison only", width: 1, color: "#ffffff", dashed: false, hidden: false, locked: false, panel: null, createdAt: 1 }] }, arrangements: { group: { order: ["ABC", "DEF"], hidden: ["DEF"] } } };
    doc = await saveWorkstationDocument(trade, doc, 0);
    const stored = await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: trade } }); expect(stored.workstationJson).not.toContain("data:image"); expect((await readWorkstationDocument(trade)).comparison).toEqual(doc.comparison);
    await expect(saveWorkstationDocument(trade, { ...doc, evidenceProtocol: undefined }, doc.revision)).rejects.toThrow(/older image format/);
    await expect(saveWorkstationDocument(trade, { ...doc, evidence: [{ ...doc.evidence[0], asset: { ...asset, bytes: asset.bytes + 1 } }] }, doc.revision)).rejects.toThrow(/invalid metadata/);
  });
  it("retains referenced assets, delays deletion seven days, and honors backup pins", async () => {
    const trade = await fixture(), { asset } = await upload(trade, "one", await png());
    let doc = await readWorkstationDocument(trade); doc = await saveWorkstationDocument(trade, { ...attachEvidence(doc, { id: "one", asset, image: "", name: "Original", time: 1, timeframe: "1d", revision: 0 }, "peers"), evidenceProtocol: 2 }, 0);
    await maintainEvidence(); expect(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    await saveWorkstationDocument(trade, removeEvidence(doc, "one"), doc.revision); await maintainEvidence(); expect(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    await prisma.evidenceUploadSession.deleteMany({ where: { assetId: asset.id } });
    await prisma.evidenceAsset.update({ where: { id: asset.id }, data: { unreferencedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await prisma.evidenceAssetReference.create({ data: { assetId: asset.id, kind: "backup", key: "active-backup", expiresAt: new Date(Date.now() + 3600_000) } });
    await maintainEvidence(); expect(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
    await prisma.evidenceAssetReference.deleteMany({ where: { assetId: asset.id } }); await maintainEvidence(); expect(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } })).toBeNull();
  });
  it("migrates exact legacy bytes without changing scalar notes, assignments or snapshots", async () => {
    const trade = await fixture(), bytes = await png(); vi.stubEnv("EVIDENCE_R2_WRITES_ENABLED", "0");
    let doc = await readWorkstationDocument(trade); doc.review.notes = "Preserve older scalar notes"; doc = await saveWorkstationDocument(trade, attachEvidence(doc, { id: "legacy", name: "Old capture", image: `data:image/png;base64,${bytes.toString("base64")}`, time: 1, timeframe: "1d", revision: 0 }, "peers"), 0);
    const before = await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: trade } }); doc = await readWorkstationDocument(trade); vi.stubEnv("EVIDENCE_R2_WRITES_ENABLED", "1");
    expect((await migrateInlineReviewEvidence(trade, "owner")).migrated).toBe(1);
    const after = await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: trade } }), loaded = await readWorkstationDocument(trade);
    expect(after.content).toBe(before.content); expect(loaded.review.notion).toEqual(doc.review.notion); expect(loaded.evidence[0].id).toBe("legacy"); expect(loaded.evidence[0].image).toBe("");
    expect((await migrateInlineReviewEvidence(trade, "owner")).migrated).toBe(0);
  });
});
