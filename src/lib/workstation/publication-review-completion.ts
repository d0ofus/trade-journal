import type { Autosave } from "@/lib/journal/autosave";
import type { TradeDocument } from "./types";
import type { PublicationReviewCompletion } from "./notion-publication-state";

/** A server acknowledgement is metadata, not another deliberate edit or save. */
export function acceptPublicationReviewCompletion(session: Autosave<TradeDocument>, completion: PublicationReviewCompletion) {
  if (!completion || completion.outcome === "superseded" || !["updated", "already-reviewed"].includes(completion.outcome)) return false;
  if (!Number.isInteger(completion.sourceRevision) || completion.revision !== completion.sourceRevision + (completion.outcome === "updated" ? 1 : 0) ||
    [completion.noteUpdatedAt, completion.journalUpdatedAt, completion.previousNoteUpdatedAt, completion.previousJournalUpdatedAt].some(value => value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) return false;
  const state = session.getSnapshot(), doc = state.value;
  if (state.dirty || state.saving || state.error || doc.revision !== completion.sourceRevision ||
    (doc.noteUpdatedAt ?? null) !== completion.previousNoteUpdatedAt || (doc.journalUpdatedAt ?? null) !== completion.previousJournalUpdatedAt) return false;
  session.metadata(value => ({ ...value, review: { ...value.review, status: "Reviewed" }, revision: completion.revision,
    updatedAt: completion.noteUpdatedAt, noteUpdatedAt: completion.noteUpdatedAt, journalUpdatedAt: completion.journalUpdatedAt }));
  return true;
}
