import { prisma } from "@/lib/prisma";
import { lockClosedTradeForReview } from "./closed-trade-review-lock";
import { deleteEvidenceObject } from "./evidence-r2";
export { refreshR2AccountUsage } from "./r2-account-metrics";

const DAY = 86_400_000;
/** Bounded daily maintenance. No review, completed original, or other bucket is archived/deleted. */
export async function maintainEvidence(deadline = Date.now() + 45_000) {
  let uploads = 0, originals = 0, backups = 0;
  await prisma.evidenceAssetReference.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const pinnedJobs = await prisma.evidenceAssetReference.findMany({ where: { kind: "publication" }, select: { key: true }, distinct: ["key"], take: 500 });
  const finished = await prisma.notionPublishJob.findMany({ where: { state: "succeeded", id: { in: pinnedJobs.map(ref => ref.key) } }, select: { id: true } });
  if (finished.length) await prisma.evidenceAssetReference.deleteMany({ where: { kind: "publication", key: { in: finished.map(j => j.id) } } });
  // Start the seven-day clock only once the last reference actually disappears.
  await prisma.evidenceAsset.updateMany({ where: { state: "ready", unreferencedAt: null, references: { none: {} } }, data: { unreferencedAt: new Date() } });
  const expired = await prisma.evidenceUploadSession.findMany({ where: { expiresAt: { lt: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, take: 30, orderBy: { expiresAt: "asc" }, include: { asset: true } });
  for (const row of expired) {
    if (Date.now() > deadline) break;
    const claimed = await prisma.evidenceUploadSession.updateMany({ where: { id: row.id, expiresAt: { lt: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { state: row.asset ? "ready" : "cancelled", leaseUntil: new Date(Date.now() + 120_000) } });
    if (!claimed.count) continue;
    await deleteEvidenceObject(row.temporaryKey, deadline);
    // A deduplicated upload may have produced a verified redundant final copy.
    if (row.verifiedSha256) for (const key of [`originals/${row.id}/${row.verifiedSha256}.png`, `thumbnails/${row.id}/${row.verifiedSha256}.png`]) if (key !== row.asset?.objectKey && key !== row.asset?.thumbnailKey) await deleteEvidenceObject(key, deadline);
    await prisma.evidenceUploadSession.delete({ where: { id: row.id } }); uploads++;
  }
  const candidates = await prisma.evidenceAsset.findMany({ where: { OR: [{ state: "ready", unreferencedAt: { lt: new Date(Date.now() - 7 * DAY) }, references: { none: {} } }, { state: "deleting" }] }, take: 30, orderBy: { createdAt: "asc" } });
  for (const asset of candidates) {
    if (Date.now() > deadline) break;
    const claimed = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workstation-evidence-gc'))`;
      await lockClosedTradeForReview(tx, asset.tradeId);
      const current = await tx.evidenceAsset.findUnique({ where: { id: asset.id }, include: { references: true, uploads: true } });
      if (!current || current.references.length || current.uploads.some(u => u.expiresAt.getTime() > Date.now()) || current.state !== "deleting" && (!current.unreferencedAt || current.unreferencedAt.getTime() >= Date.now() - 7 * DAY)) return false;
      // An unfinished job remains authoritative even if a reference was lost in an older backup.
      const jobs = await tx.notionPublishJob.findMany({ where: { groupKey: current.tradeId, state: { notIn: ["preview", "succeeded"] } }, select: { snapshot: true } });
      if (jobs.some(job => JSON.stringify(job.snapshot).includes(current.id))) return false;
      await tx.evidenceAsset.update({ where: { id: current.id }, data: { state: "deleting" } }); return true;
    });
    if (!claimed) continue;
    await deleteEvidenceObject(asset.objectKey, deadline); await deleteEvidenceObject(asset.thumbnailKey, deadline);
    await prisma.$transaction(async tx => { await tx.evidenceUploadSession.deleteMany({ where: { assetId: asset.id } }); await tx.evidenceAsset.delete({ where: { id: asset.id } }); }); originals++;
  }
  for (const session of await prisma.evidenceBackupSession.findMany({ where: { expiresAt: { lt: new Date() } }, take: 10 })) {
    if (Date.now() > deadline) break;
    const manifest = session.manifest as { parts?: { key: string }[] };
    const remaining = [...manifest.parts ?? []];
    while (remaining.length && Date.now() < deadline) { const part = remaining.shift()!; if (part.key.startsWith(`backups/${session.id}/`)) await deleteEvidenceObject(part.key, deadline); }
    if (remaining.length) { await prisma.evidenceBackupSession.update({ where: { id: session.id }, data: { manifest: { state: "cleanup", parts: remaining } } }); break; }
    await prisma.evidenceBackupSession.delete({ where: { id: session.id } }); backups++;
  }
  return { uploads, originals, backups, bounded: Date.now() > deadline };
}
