import type { Prisma } from "@prisma/client";
import type { PublicationReviewCompletion } from "@/lib/workstation/notion-publication-state";
import { lockClosedTradeForReview, lockLinkedJournalForReview } from "./closed-trade-review-lock";
import { readWorkstationDocument } from "./trade-workstation";
import { jsonHash } from "./notion-client";

/** Called only inside the fenced publication-success transaction. Never replays a review save. */
export async function completePublishedReview(tx: Prisma.TransactionClient, groupKey: string, sourceRevision: number, digest: string): Promise<PublicationReviewCompletion> {
  const superseded = { outcome: "superseded" as const, sourceRevision };
  const trade = await lockClosedTradeForReview(tx, groupKey);
  if (!trade || trade.isStale) return superseded;
  const link = await tx.journalLink.findFirst({ where: { linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: groupKey }, orderBy: { createdAt: "asc" }, select: { journalEntryId: true } });
  if (link) await lockLinkedJournalForReview(tx, link.journalEntryId);
  const current = await readWorkstationDocument(groupKey, tx);
  if (current.revision !== sourceRevision || jsonHash(current) !== digest) return superseded;
  const previousNoteUpdatedAt = current.noteUpdatedAt ?? null, previousJournalUpdatedAt = current.journalUpdatedAt ?? null;
  const base = { sourceRevision, previousNoteUpdatedAt, previousJournalUpdatedAt, journalUpdatedAt: previousJournalUpdatedAt };
  if (current.review.status === "Reviewed") return { ...base, outcome: "already-reviewed", revision: current.revision, noteUpdatedAt: previousNoteUpdatedAt };
  const revision = current.revision + 1;
  const updatedAt = new Date(Math.max(Date.now(), previousNoteUpdatedAt ? Date.parse(previousNoteUpdatedAt) + 1 : 0));
  // Keep unknown saved fields, evidence, drawings, commentary and the linked journal intact.
  const note = await tx.closedTradeNote.findUnique({ where: { groupKey } });
  const stored = note?.workstationJson ? JSON.parse(note.workstationJson) : current;
  const workstationJson = JSON.stringify({ ...stored, revision, review: { ...stored.review, status: "Reviewed" } });
  await tx.closedTradeNote.upsert({ where: { groupKey }, create: { groupKey, content: current.review.notes, workstationVersion: revision, workstationJson, updatedAt }, update: { workstationVersion: revision, workstationJson, updatedAt } });
  return { ...base, outcome: "updated", revision, noteUpdatedAt: updatedAt.toISOString() };
}
