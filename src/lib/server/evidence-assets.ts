import { randomUUID } from "node:crypto";
import { Prisma, type EvidenceAsset } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertEvidenceCapacity, EVIDENCE_PROTOCOL, IMAGE_MAX_BYTES, type ImageAssetReference } from "@/lib/workstation/image-assets";
import type { TradeDocument } from "@/lib/workstation/types";
import { lockClosedTradeForReview } from "./closed-trade-review-lock";
import { EvidenceStorageError, evidenceWritesEnabled, signEvidencePut, readEvidenceObject, verifyEvidencePng, putEvidenceObject, evidenceObjectExists } from "./evidence-r2";

const DAY = 86_400_000;
export const assetReference = (a: Pick<EvidenceAsset, "id" | "sha256" | "bytes" | "width" | "height">): ImageAssetReference => ({ id: a.id, storage: "r2", sha256: a.sha256, bytes: a.bytes, width: a.width, height: a.height, mime: "image/png" });
export async function assertEvidenceTrade(tradeId: string, tx: Prisma.TransactionClient = prisma, writing = true) {
  const trade = await tx.closedTrade.findUnique({ where: { groupKey: tradeId }, select: { isStale: true, account: { select: { ibkrAccount: true } } } });
  if (!trade) throw new EvidenceStorageError("Trade not found.", 404);
  if (writing && trade.isStale) throw new EvidenceStorageError("Stale trades are read-only.");
  if (writing && process.env.E2E_DEMO_ONLY_WRITES === "1" && trade.account.ibkrAccount !== "DEMO") {
    const { isDemoAccountCode } = await import("@/lib/demo-safety");
    if (!isDemoAccountCode(trade.account.ibkrAccount)) throw new EvidenceStorageError("Browser tests may only edit demo trades.", 403);
  }
  return trade;
}
export async function createEvidenceUpload(tradeId: string, ownerId: string, clientKey: string, bytes: number) {
  if (!evidenceWritesEnabled()) throw new EvidenceStorageError("New private evidence uploads are disabled until storage validation is complete.", 503);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > IMAGE_MAX_BYTES) throw new EvidenceStorageError("Image must be at most 20,000,000 bytes.", 413);
  await assertEvidenceTrade(tradeId);
  const session = await prisma.$transaction(async tx => {
    await lockClosedTradeForReview(tx, tradeId);
    // Limit abandoned reservations, not account storage. Two active transfers per client remain allowed.
    const existing = await tx.evidenceUploadSession.findUnique({ where: { ownerId_tradeId_clientKey: { ownerId, tradeId, clientKey } } });
    if (existing) {
      if (existing.expectedBytes !== bytes) throw new EvidenceStorageError("This upload identifier belongs to a different image.");
      if (existing.state === "cancelled" || existing.expiresAt.getTime() < Date.now()) throw new EvidenceStorageError("This upload expired. Start a new attachment.", 410);
      return tx.evidenceUploadSession.update({ where: { id: existing.id }, data: { expiresAt: new Date(Date.now() + DAY) } });
    }
    if (await tx.evidenceUploadSession.count({ where: { ownerId, state: { in: ["pending", "verifying"] }, expiresAt: { gt: new Date() } } }) >= 60) throw new EvidenceStorageError("Too many pending uploads. Resume or cancel previous attachments.", 429);
    return tx.evidenceUploadSession.create({ data: { tradeId, ownerId, clientKey, expectedBytes: bytes, temporaryKey: `pending/${randomUUID()}.png`, expiresAt: new Date(Date.now() + DAY) } });
  });
  if (session.assetId) return { id: session.id, state: "ready", asset: assetReference(await prisma.evidenceAsset.findUniqueOrThrow({ where: { id: session.assetId } })) };
  return { id: session.id, state: session.state, url: await signEvidencePut(session.temporaryKey, session.expectedBytes), headers: { "Content-Type": "image/png", "If-None-Match": "*" }, expiresIn: 300 };
}
export async function evidenceUploadStatus(id: string, tradeId: string, ownerId: string) {
  await assertEvidenceTrade(tradeId, prisma, false);
  const session = await prisma.evidenceUploadSession.findFirst({ where: { id, tradeId, ownerId }, include: { asset: true } });
  if (!session) throw new EvidenceStorageError("Upload not found.", 404);
  const expired = session.expiresAt.getTime() < Date.now();
  if (!expired && session.state !== "cancelled") await prisma.evidenceUploadSession.updateMany({ where: { id, tradeId, ownerId, state: { not: "cancelled" }, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() + DAY) } });
  return { id, state: session.state, error: session.error, expired, asset: session.asset ? assetReference(session.asset) : undefined, uploaded: session.asset ? true : !expired && session.state === "pending" && !!await evidenceObjectExists(session.temporaryKey) };
}
export async function finalizeEvidenceUpload(id: string, tradeId: string, ownerId: string) {
  await assertEvidenceTrade(tradeId);
  const leaseUntil = new Date(Date.now() + 120_000);
  const session = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "EvidenceUploadSession" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.evidenceUploadSession.findFirst({ where: { id, tradeId, ownerId }, include: { asset: true } });
    if (!row) throw new EvidenceStorageError("Upload not found.", 404);
    if (row.asset) return row;
    if (row.state === "cancelled" || row.expiresAt.getTime() < Date.now()) throw new EvidenceStorageError("The upload expired or was cancelled.", 410);
    if (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) throw new EvidenceStorageError("This image is still being verified. Check progress shortly.", 202);
    await tx.evidenceUploadSession.update({ where: { id }, data: { state: "verifying", leaseUntil, error: null, expiresAt: new Date(Date.now() + DAY) } });
    return row;
  });
  if (session.asset) return assetReference(session.asset);
  try {
    const bytes = await readEvidenceObject(session.temporaryKey, session.expectedBytes);
    const verified = await verifyEvidencePng(bytes);
    const verifiedClaim = await prisma.evidenceUploadSession.updateMany({ where: { id, state: "verifying", leaseUntil }, data: { verifiedSha256: verified.sha256 } });
    if (!verifiedClaim.count) throw new EvidenceStorageError("This upload was cancelled during verification.");
    // Only the server can address immutable final keys. Reused temporary PUT URLs cannot change them.
    const key = `originals/${id}/${verified.sha256}.png`, thumbnailKey = `thumbnails/${id}/${verified.sha256}.png`;
    for (const [objectKey, body] of [[key, bytes], [thumbnailKey, verified.thumbnail]] as const) {
      try { await putEvidenceObject(objectKey, body); }
      catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
        const existing = await readEvidenceObject(objectKey, body.length);
        if (!existing.equals(body)) throw new EvidenceStorageError("Stored object checksum mismatch; attachment stopped.");
      }
    }
    return await prisma.$transaction(async tx => {
      await lockClosedTradeForReview(tx, tradeId);
      await assertEvidenceTrade(tradeId, tx);
      const claimed = await tx.evidenceUploadSession.updateMany({ where: { id, ownerId, tradeId, state: "verifying", leaseUntil }, data: { state: "ready", leaseUntil: null } });
      if (claimed.count !== 1) throw new EvidenceStorageError("The upload was cancelled or verification ownership changed.");
      // Trade lock serializes deduplication, quota checks, review attachment and garbage collection.
      const existing = await tx.evidenceAsset.findUnique({ where: { tradeId_sha256: { tradeId, sha256: verified.sha256 } } });
      if (existing && existing.state !== "ready") throw new EvidenceStorageError("This image is being removed. Retry after cleanup.");
      const asset = existing ?? await tx.evidenceAsset.create({ data: { tradeId, ownerId, sha256: verified.sha256, notionHash: verified.notionHash, objectKey: key, thumbnailKey, bytes: verified.bytes, thumbnailBytes: verified.thumbnail.length, width: verified.width, height: verified.height } });
      const referenced = await tx.evidenceAssetReference.count({ where: { assetId: asset.id } });
      await tx.evidenceAsset.update({ where: { id: asset.id }, data: { unreferencedAt: referenced ? null : new Date() } });
      await tx.evidenceUploadSession.update({ where: { id }, data: { assetId: asset.id } });
      return assetReference(asset);
    });
  } catch (error) {
    await prisma.evidenceUploadSession.updateMany({ where: { id, state: "verifying", leaseUntil }, data: { state: "pending", leaseUntil: null, error: error instanceof EvidenceStorageError ? error.message : "Storage verification failed. Check progress or retry this image." } });
    throw error;
  }
}
export async function cancelEvidenceUpload(id: string, tradeId: string, ownerId: string) {
  await prisma.evidenceUploadSession.updateMany({ where: { id, tradeId, ownerId, state: { in: ["pending", "verifying"] } }, data: { state: "cancelled", leaseUntil: null, expiresAt: new Date(Date.now() + 600_000) } });
}

/** Called under the existing trade review lock. Asset metadata from clients is not authoritative. */
export async function validateReviewAssets(tx: Prisma.TransactionClient, tradeId: string, incoming: TradeDocument, previous: TradeDocument) {
  if (evidenceWritesEnabled() && incoming.evidence.some(e => !e.asset && !previous.evidence.some(old => old.id === e.id && old.image === e.image))) throw new EvidenceStorageError("New images must use private storage. Reload this older browser tab and retry the attachment.");
  if (previous.evidenceProtocol === EVIDENCE_PROTOCOL && incoming.evidenceProtocol !== EVIDENCE_PROTOCOL) throw new EvidenceStorageError("This browser tab uses an older image format. Reload before saving; your local draft is preserved.");
  const ids = [...new Set(incoming.evidence.flatMap(e => e.asset ? [e.asset.id] : []))];
  if (!ids.length && !previous.evidence.some(e => e.asset)) { assertEvidenceCapacity(incoming.evidence); return; }
  const rows = await tx.evidenceAsset.findMany({ where: { id: { in: ids }, tradeId, state: "ready" } });
  for (const e of incoming.evidence) if (e.asset) {
    const row = rows.find(a => a.id === e.asset!.id);
    if (!row || e.asset.storage !== "r2" || JSON.stringify(assetReference(row)) !== JSON.stringify({ id: e.asset.id, storage: e.asset.storage, sha256: e.asset.sha256, bytes: e.asset.bytes, width: e.asset.width, height: e.asset.height, mime: e.asset.mime })) throw new EvidenceStorageError("An evidence asset is unavailable, belongs to another trade, or has invalid metadata.", 400);
    e.asset = assetReference(row); e.image = "";
  }
  assertEvidenceCapacity(incoming.evidence);
  const oldIds = previous.evidence.flatMap(e => e.asset ? [e.asset.id] : []);
  await tx.evidenceAssetReference.deleteMany({ where: { kind: "review", key: tradeId, assetId: { notIn: ids } } });
  for (const id of ids) {
    await tx.evidenceAssetReference.upsert({ where: { assetId_kind_key: { assetId: id, kind: "review", key: tradeId } }, create: { assetId: id, kind: "review", key: tradeId }, update: {} });
    await tx.evidenceAsset.update({ where: { id }, data: { unreferencedAt: null } });
  }
  await tx.evidenceAsset.updateMany({ where: { id: { in: oldIds.filter(id => !ids.includes(id)) }, references: { none: {} } }, data: { unreferencedAt: new Date() } });
  if (ids.length) incoming.evidenceProtocol = EVIDENCE_PROTOCOL;
}

export async function readOriginalAsset(id: string, tradeId?: string) {
  const asset = await prisma.evidenceAsset.findFirst({ where: { id, ...tradeId ? { tradeId } : {}, state: "ready" } });
  if (!asset) throw new EvidenceStorageError("Original evidence is unavailable.", 404);
  const bytes = await readEvidenceObject(asset.objectKey, asset.bytes);
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new EvidenceStorageError("Original evidence checksum mismatch.", 502);
  return { asset, bytes };
}
