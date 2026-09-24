import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { emptyDocument, type TradeDocument } from "@/lib/workstation/types";
import { createEvidenceUpload, finalizeEvidenceUpload, validateReviewAssets } from "./evidence-assets";
import { putEvidenceObject, readEvidenceObject } from "./evidence-r2";
import { lockClosedTradeForReview } from "./closed-trade-review-lock";

/** Copies first, verifies second, CAS-replaces image fields last. No journal/scalar/legacy rewrite. */
export async function migrateInlineReviewEvidence(groupKey: string, ownerId: string) {
  const note = await prisma.closedTradeNote.findUnique({ where: { groupKey } });
  if (!note?.workstationJson) return { migrated: 0, skipped: true };
  const source = JSON.parse(note.workstationJson), next = structuredClone(source);
  let count = 0;
  for (const image of next.evidence ?? []) {
    if (image.asset) continue;
    if (typeof image.image !== "string" || !image.image.startsWith("data:image/png;base64,")) throw new Error("Legacy image is not a readable normalized PNG; source left untouched.");
    const bytes = Buffer.from(image.image.split(",")[1], "base64"), hash = createHash("sha256").update(bytes).digest("hex");
    const upload = await createEvidenceUpload(groupKey, ownerId, `migration:${createHash("sha256").update(JSON.stringify([image.id, hash])).digest("hex")}`, bytes.length);
    if (upload.asset) image.asset = upload.asset;
    else {
      const row = await prisma.evidenceUploadSession.findUniqueOrThrow({ where: { id: upload.id } });
      try { await putEvidenceObject(row.temporaryKey, bytes); }
      catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error; if (!(await readEvidenceObject(row.temporaryKey, bytes.length)).equals(bytes)) throw new Error("Migration upload differs from original bytes."); }
      image.asset = await finalizeEvidenceUpload(upload.id, groupKey, ownerId);
    }
    if (image.asset.sha256 !== hash || image.asset.bytes !== bytes.length) throw new Error("Legacy migration checksum mismatch. Source retained.");
    image.image = ""; count++;
  }
  if (!count) return { migrated: 0, skipped: true };
  next.evidenceProtocol = 2; next.revision = note.workstationVersion + 1;
  await prisma.$transaction(async tx => {
    const trade = await lockClosedTradeForReview(tx, groupKey); if (!trade || trade.isStale) throw new Error("Stale/missing trade; migration did not replace its review.");
    const current = await tx.closedTradeNote.findUniqueOrThrow({ where: { groupKey } });
    if (current.workstationVersion !== note.workstationVersion || current.workstationJson !== note.workstationJson || current.updatedAt.getTime() !== note.updatedAt.getTime()) throw new Error("Review changed during migration. Retry from the latest version; original content was not overwritten.");
    await validateReviewAssets(tx, groupKey, { ...emptyDocument(), ...next } as TradeDocument, { ...emptyDocument(), ...source } as TradeDocument);
    await tx.closedTradeNote.update({ where: { groupKey }, data: { workstationJson: JSON.stringify(next), workstationVersion: next.revision } });
  });
  return { migrated: count, revision: next.revision };
}
