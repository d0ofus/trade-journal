/** Requires the separate synthetic Notion/R2 fixture prepared by verify-notion-live.ts. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { evidenceStorageConfig, evidenceObjectExists } from "../src/lib/server/evidence-r2";
import { createEvidenceUpload, evidenceUploadStatus, finalizeEvidenceUpload, readOriginalAsset } from "../src/lib/server/evidence-assets";
import { readWorkstationDocument, saveWorkstationDocument } from "../src/lib/server/trade-workstation";
import { attachEvidence, removeEvidence } from "../src/lib/workstation/evidence";
import { maintainEvidence } from "../src/lib/server/evidence-maintenance";
import { createEvidenceBackup, evidenceBackupPage } from "../src/lib/server/evidence-backup";
import { verifyCompleteEvidenceBackup, restoreCompleteEvidenceBackupToIsolated } from "../src/lib/server/evidence-backup-restore";

const tradeId = "NOTION-R2-VALIDATION-20260924", owner = "local-user", DAY = 86400000;
let stage = "guard";
const report = (value: object) => console.log(JSON.stringify(value));
async function main() {
  const target = assertTestDatabaseSafety(process.env).databaseUrl;
  assert.equal(target.host, "127.0.0.1:55439");
  assert.equal(target.database, "trade_journal_evidence_notion_live_test");
  assert.equal(process.env.ALLOW_LIVE_R2_TEST, "1");
  assert.equal(process.env.EVIDENCE_R2_WRITES_ENABLED, "1");
  assert.notEqual(process.env.VERCEL_ENV, "production");
  assert.equal(evidenceStorageConfig().bucket, "trade-journal-evidence-nonproduction");
  let doc = await readWorkstationDocument(tradeId);
  assert.equal(doc.evidence.length, 3, "Prepare the isolated synthetic fixture first.");
  assert(doc.evidence.every(item => item.asset));
  const initialEvidence = structuredClone(doc.evidence);
  const initialAssignments = structuredClone(doc.review.notion);
  const id = randomUUID(), bytes = await sharp(randomBytes(1300 * 1200 * 3), { raw: { width: 1300, height: 1200, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  stage = "uncertain-upload-recovery-and-finalization";
  const upload = await createEvidenceUpload(tradeId, owner, id, bytes.length);
  assert(upload.url && upload.headers);
  const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  assert.equal((await evidenceUploadStatus(upload.id, tradeId, owner)).uploaded, true);
  assert.equal((await createEvidenceUpload(tradeId, owner, id, bytes.length)).id, upload.id);
  const asset = await finalizeEvidenceUpload(upload.id, tradeId, owner);
  assert.deepEqual(await finalizeEvidenceUpload(upload.id, tradeId, owner), asset);
  assert((await readOriginalAsset(asset.id, tradeId)).bytes.equals(bytes));
  await assert.rejects(finalizeEvidenceUpload(upload.id, tradeId, "another-owner"), /not found/i);
  const duplicate = await createEvidenceUpload(tradeId, owner, `${id}-duplicate`, bytes.length);
  assert(duplicate.url && duplicate.headers);
  assert.equal((await fetch(duplicate.url, { method: "PUT", headers: duplicate.headers, body: bytes, signal: AbortSignal.timeout(30000) })).status, 200);
  assert.equal((await finalizeEvidenceUpload(duplicate.id, tradeId, owner)).id, asset.id);
  report({ check: stage, passed: true, deduplicated: true, originalBytes: bytes.length });

  stage = "metadata-only-review-and-retention";
  doc = await saveWorkstationDocument(tradeId, attachEvidence(doc, { id, name: "Generated live-storage test only", asset, image: "", origin: "upload", timeframe: "", time: Date.now() / 1000, revision: doc.revision }, "peers"), doc.revision);
  assert(doc.evidence.reduce((sum, item) => sum + (item.asset?.bytes ?? 0), 0) > 4000000);
  const stored = await prisma.closedTradeNote.findUniqueOrThrow({ where: { groupKey: tradeId } });
  assert(!stored.workstationJson?.includes("data:image/"));
  assert(Buffer.byteLength(JSON.stringify(doc)) < 100000);
  assert((await readOriginalAsset(asset.id, tradeId)).bytes.equals(bytes));
  doc = await saveWorkstationDocument(tradeId, removeEvidence(doc, id), doc.revision);
  assert.deepEqual(doc.evidence, initialEvidence);
  // The seeded fixture already has a Peers assignment; adding/removing one image preserves all of it.
  assert.deepEqual(doc.review.notion, initialAssignments);
  await maintainEvidence(); assert(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } }));
  const row = await prisma.evidenceAsset.findUniqueOrThrow({ where: { id: asset.id } });
  const sessions = await prisma.evidenceUploadSession.findMany({ where: { id: { in: [upload.id, duplicate.id] } } });
  assert.equal(sessions.length, 2);
  const pinKey = `live-validation:${id}`;
  await prisma.evidenceAssetReference.create({ data: { assetId: asset.id, kind: "backup", key: pinKey, expiresAt: new Date(Date.now() + DAY) } });
  await prisma.evidenceUploadSession.updateMany({ where: { id: { in: sessions.map(s => s.id) } }, data: { expiresAt: new Date(Date.now() - DAY) } });
  await prisma.evidenceAsset.update({ where: { id: asset.id }, data: { unreferencedAt: new Date(Date.now() - 8 * DAY) } });
  await maintainEvidence(); assert(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } }));
  await prisma.evidenceAssetReference.deleteMany({ where: { assetId: asset.id, kind: "backup", key: pinKey } });
  const cleanup = await maintainEvidence();
  assert.equal(await prisma.evidenceAsset.findUnique({ where: { id: asset.id } }), null);
  for (const key of [row.objectKey, row.thumbnailKey, ...sessions.flatMap(s => [s.temporaryKey, `originals/${s.id}/${asset.sha256}.png`, `thumbnails/${s.id}/${asset.sha256}.png`])]) assert.equal(await evidenceObjectExists(key), null);
  report({ check: stage, passed: true, expiredUnreferencedOriginalsRemoved: cleanup.originals, liveFixtureOriginalsRetained: 3 });

  stage = "complete-live-backup-and-restore";
  const backup = await createEvidenceBackup(owner), files: Record<string, Uint8Array> = {};
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await evidenceBackupPage(backup.id, owner, offset);
    if (page.manifest) files["manifest.json"] = Buffer.from(JSON.stringify(page.manifest));
    for (const file of page.files) {
      const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200); files[file.name] = new Uint8Array(await response.arrayBuffer());
    }
    offset = page.next;
  }
  const zip = zipSync(files), unpacked = unzipSync(zip), verified = verifyCompleteEvidenceBackup(unpacked);
  assert.equal(verified.manifest.originals.length, 3);
  for (const item of initialEvidence) assert(Buffer.from(unpacked[`originals/${item.asset!.id}.png`]).equals((await readOriginalAsset(item.asset!.id, tradeId)).bytes));
  // Preserve source connection identity and keep the shared Prisma client attached to it.
  const source = { database: process.env.DATABASE_URL, direct: process.env.DIRECT_URL };
  try {
    const restore = new URL(process.env.DIRECT_URL!); restore.pathname = "/trade_journal_evidence_live_restore_test";
    process.env.DATABASE_URL = restore.href; process.env.DIRECT_URL = restore.href; process.env.EVIDENCE_RESTORE_APPROVED = "1";
    const result = await restoreCompleteEvidenceBackupToIsolated(unpacked);
    assert.equal(result.originals, 3);
    await assert.rejects(restoreCompleteEvidenceBackupToIsolated(unpacked), /not empty/i);
    report({ check: stage, passed: true, selfContainedZipBytes: zip.length, originalChecksumsMatch: true, ...result });
  } finally { process.env.DATABASE_URL = source.database; process.env.DIRECT_URL = source.direct; }
}
main().catch(error => {
  let message = error instanceof Error ? error.message : "Unknown validation error";
  for (const [name, value] of Object.entries(process.env)) if (value && value.length > 8 && /TOKEN|SECRET|PASSWORD|ACCESS_KEY|DATABASE_URL|DIRECT_URL/.test(name)) message = message.replaceAll(value, "[redacted]");
  message = message.replace(/(?:https?|postgres(?:ql)?):\/\/[^\s]+/g, "[redacted URL]");
  report({ check: stage, passed: false, errorType: error instanceof Error ? error.name : "unknown", message, status: (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode, credentialsLogged: false });
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
