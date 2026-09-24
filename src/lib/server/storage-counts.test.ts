import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadStorageUsage } from "./storage-usage";
import { getBackupTableRowCounts, getLatestBackupRelevantUpdateAt } from "./queries";
import { buildBackupSourceMetadata } from "./backup-freshness";

// Physical allocation is checked independently against production. These fixtures test record counts,
// not directory-scanning every unrelated database on the developer's PostgreSQL instance.
vi.mock("./storage-physical", () => ({ readPhysicalStorage: vi.fn(async () => ({ currentBytes: BigInt(1000), branchBytes: BigInt(2000), cacheBytes: BigInt(100), metricCacheBytes: BigInt(10), measuredAt: new Date() })) }));

afterAll(() => prisma.$disconnect());

describe("authoritative storage counts", () => {
  it("counts drawings, legacy candles and deduplicated assets independently of assignments without writing", async () => {
    const key = `metrics-${crypto.randomUUID()}`, image = "data:image/png;base64,aGVsbG8=";
    const before = await loadStorageUsage();
    const asset = (id: string, bytes: number) => ({ id, tradeId: key, ownerId: key, sha256: id, notionHash: id,
      objectKey: `originals/${id}`, thumbnailKey: `thumbnails/${id}`, bytes, thumbnailBytes: 100, width: 10, height: 10 });
    const doc = { schema: 1, drawings: [{ id: "visible" }, { id: "hidden", hidden: true }],
      comparison: { drawings: { AAA: [{ id: "peer" }], BBB: [{ id: "peer2" }] } },
      review: { attachmentRefs: { peers: ["one", "two"], entry: ["one"] } },
      evidence: [{ id: "one", image: "", asset: { id: key, storage: "r2" } }, { id: "two", image: "", asset: { id: key, storage: "r2" } },
        { id: "legacy", image }, { id: "broken", image: "", asset: { id: key + "-missing", storage: "r2" } },
        { id: "wrong-owner", image: "", asset: { id: key + "-foreign", storage: "r2" } }] };
    try {
      await prisma.evidenceAsset.createMany({ data: [asset(key, 5000), asset(key + "-retained", 2000), { ...asset(key + "-foreign", 3000), tradeId: key + "-elsewhere" }] });
      await prisma.evidenceAssetReference.createMany({ data: [
        { assetId: key, kind: "review", key }, { assetId: key + "-retained", kind: "publication", key },
        { assetId: key, kind: "backup", key },
      ] });
      await prisma.closedTradeNote.createMany({ data: [
        { groupKey: key, content: "private text", workstationJson: JSON.stringify(doc) },
        { groupKey: key + "-invalid", content: "keep", workstationJson: "{broken" },
        { groupKey: key + "-shape", content: "keep", workstationJson: JSON.stringify({ drawings: {} }) },
      ] });
      await prisma.journalEntry.create({ data: { id: key, symbol: "METRICSTEST" } });
      await prisma.journalChart.createMany({ data: [
        { id: key, journalEntryId: key, symbol: "METRICSTEST", screenshotUrl: image },
        { id: key + "-bad", journalEntryId: key, symbol: "METRICSTEST", screenshotUrl: "data:image/png;base64,?" },
        { id: key + "-local", journalEntryId: key, symbol: "METRICSTEST", screenshotKey: "local:private.png" },
        { id: key + "-external", journalEntryId: key, symbol: "METRICSTEST", screenshotKey: "private/screenshot.png" },
      ] });
      await prisma.marketCandle.create({ data: { symbol: key, timeframe: "1d", source: "synthetic", time: new Date(), open: 1, high: 1, low: 1, close: 1 } });
      await prisma.workstationCandleChunk.create({ data: { key, symbol: key, timeframe: "1d", source: "synthetic", start: new Date(), end: new Date(), payload: Buffer.from("synthetic"), checksum: key, barCount: 25 } });
      await prisma.evidenceUploadSession.createMany({ data: [
        { tradeId: key, ownerId: key, clientKey: "pending", temporaryKey: `pending/${key}`, expectedBytes: 9000, expiresAt: new Date(Date.now() + 3600_000) },
        { tradeId: key, ownerId: key, clientKey: "expired", temporaryKey: `pending/${key}-expired`, expectedBytes: 8000, expiresAt: new Date(Date.now() - 3600_000) },
      ] });
      await prisma.evidenceBackupSession.create({ data: { id: key, ownerId: key, expiresAt: new Date(Date.now() + 3600_000), manifest: { parts: [{ bytes: 321 }], originals: [{ bytes: 5000 }] } } });
      const notesBefore = await prisma.closedTradeNote.findMany({ where: { groupKey: { startsWith: key } } });
      const after = await loadStorageUsage();
      expect(after.workstation!.reviews - before.workstation!.reviews).toBe(1);
      expect(after.workstation!.drawings - before.workstation!.drawings).toBe(2);
      expect(after.workstation!.comparisonDrawings - before.workstation!.comparisonDrawings).toBe(2);
      expect(after.workstation!.evidenceEntries - before.workstation!.evidenceEntries).toBe(5);
      expect(after.workstation!.r2EvidenceEntries - before.workstation!.r2EvidenceEntries).toBe(2);
      expect(after.workstation!.brokenAssetReferences - before.workstation!.brokenAssetReferences).toBe(2);
      expect(after.workstation!.invalidReviews - before.workstation!.invalidReviews).toBe(2);
      expect(after.evidence!.assets - before.evidence!.assets).toBe(3);
      expect(after.evidence!.originals - before.evidence!.originals).toBe(10000);
      expect(after.evidence!.retainedAssets! - before.evidence!.retainedAssets!).toBe(2);
      expect(after.evidence!.retainedOriginalBytes! - before.evidence!.retainedOriginalBytes!).toBe(5000);
      expect(after.evidence!.pending - before.evidence!.pending).toBe(9000);
      expect(after.evidence!.pendingCount! - before.evidence!.pendingCount!).toBe(1);
      expect(after.evidence!.expiredUploads! - before.evidence!.expiredUploads!).toBe(1);
      expect(after.evidence!.backupPartBytes! - before.evidence!.backupPartBytes!).toBe(321);
      expect(after.backup!.requiredR2Originals - before.backup!.requiredR2Originals).toBe(3);
      expect(after.legacy!.journalEntries - before.legacy!.journalEntries).toBe(1);
      expect(after.legacy!.journalCharts - before.legacy!.journalCharts).toBe(4);
      expect(after.legacy!.inlineImages - before.legacy!.inlineImages).toBe(2);
      expect(after.legacy!.invalidInlineImages - before.legacy!.invalidInlineImages).toBe(1);
      expect(after.legacy!.localImages - before.legacy!.localImages).toBe(1);
      expect(after.legacy!.externalImages - before.legacy!.externalImages).toBe(1);
      expect(after.candles!.legacyRows - before.candles!.legacyRows).toBe(1);
      expect(after.candles!.chunks - before.candles!.chunks).toBe(1);
      expect(after.candles!.storedBars - before.candles!.storedBars).toBe(25);
      expect(after.groups!.workstation!.complete).toBe(false);
      expect(after.groups!.activity!.complete).toBe(true);
      expect(new Set(["workstation", "legacy", "evidence", "candles"].map(group => after.groups![group as "workstation"]!.measuredAt)).size).toBe(1);
      expect(JSON.stringify(after)).not.toContain("private text"); expect(JSON.stringify(after)).not.toContain(key);
      expect(await prisma.closedTradeNote.findMany({ where: { groupKey: { startsWith: key } } })).toEqual(notesBefore);

      // Removing a section assignment cannot change evidence or storage counts.
      doc.review.attachmentRefs.entry = [];
      await prisma.closedTradeNote.update({ where: { groupKey: key }, data: { workstationJson: JSON.stringify(doc) } });
      const detached = await loadStorageUsage();
      expect(detached.workstation!.evidenceEntries).toBe(after.workstation!.evidenceEntries);
      expect(detached.evidence!.originals).toBe(after.evidence!.originals);
      // Removing all review assignments retains immutable assets until normal retention cleanup.
      await prisma.closedTradeNote.update({ where: { groupKey: key }, data: { workstationJson: JSON.stringify({ ...doc, evidence: [], drawings: [], comparison: { drawings: {} } }) } });
      const cleared = await loadStorageUsage();
      expect(cleared.workstation!.drawings).toBe(before.workstation!.drawings);
      expect(cleared.evidence!.originals).toBe(after.evidence!.originals);
      expect(cleared.evidence!.retainedAssets).toBe(after.evidence!.retainedAssets! + 1);
    } finally {
      await prisma.closedTradeNote.deleteMany({ where: { groupKey: { startsWith: key } } });
      await prisma.journalEntry.deleteMany({ where: { id: key } });
      await prisma.marketCandle.deleteMany({ where: { symbol: key } });
      await prisma.workstationCandleChunk.deleteMany({ where: { key } });
      await prisma.evidenceUploadSession.deleteMany({ where: { ownerId: key } });
      await prisma.evidenceAssetReference.deleteMany({ where: { key } });
      await prisma.evidenceBackupSession.deleteMany({ where: { id: key } });
      await prisma.evidenceAsset.deleteMany({ where: { ownerId: key } });
    }
  });

  it("does not turn malformed backup-part metadata into a complete zero-usage reading", async () => {
    const id = crypto.randomUUID();
    try {
      await prisma.evidenceBackupSession.create({ data: { id, ownerId: "synthetic", expiresAt: new Date(), manifest: { parts: [{ bytes: "wrong" }] } } });
      const usage = await loadStorageUsage();
      expect(usage.evidence!.invalidBackupManifests).toBeGreaterThan(0);
      expect(usage.groups!.evidence!.complete).toBe(false);
    } finally { await prisma.evidenceBackupSession.deleteMany({ where: { id } }); }
  });

  it("agrees with existing database-backup signatures and detects later saved edits", async () => {
    const id = crypto.randomUUID();
    try {
      const rowCounts = await getBackupTableRowCounts(), latestDataChangeAt = await getLatestBackupRelevantUpdateAt();
      const source = buildBackupSourceMetadata({ rowCounts, latestDataChangeAt });
      const verifiedAt = new Date();
      await prisma.backupAudit.create({ data: { id, sha256: "synthetic-backup-digest", exportedAt: verifiedAt, verifiedAt,
        payloadBytes: 1000, totalRows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0), tableCount: Object.keys(rowCounts).length,
        sourceSignature: source.signature, sourceCountsJson: JSON.stringify(rowCounts), sourceLatestDataChangeAt: latestDataChangeAt } });
      const current = await loadStorageUsage();
      expect(current.backup!.databaseFreshness).toBe("current");
      expect(Date.parse(current.backup!.latestAudit!.verifiedAt)).toBe(verifiedAt.getTime());
      expect((await loadStorageUsage()).backup!.databaseFreshness).toBe("current");
      await prisma.closedTradeNote.create({ data: { groupKey: id, content: "synthetic edit", workstationJson: "{}" } });
      expect((await loadStorageUsage()).backup!.databaseFreshness).toBe("needs-backup");
    } finally {
      await prisma.closedTradeNote.deleteMany({ where: { groupKey: id } });
      await prisma.backupAudit.deleteMany({ where: { id } });
    }
  });
});
