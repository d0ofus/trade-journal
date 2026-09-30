import { describe, expect, it, vi } from "vitest";
import { Autosave } from "@/lib/journal/autosave";
import { emptyDocument } from "./types";
import { acceptPublicationReviewCompletion } from "./publication-review-completion";
import type { PublicationReviewCompletion } from "./notion-publication-state";

const completion: PublicationReviewCompletion = { outcome: "updated", sourceRevision: 2, revision: 3, previousNoteUpdatedAt: null, previousJournalUpdatedAt: null, noteUpdatedAt: "2026-09-30T00:00:01.000Z", journalUpdatedAt: null };
function session() {
  const doc = emptyDocument(); doc.revision = 2; doc.review.status = "In progress"; doc.review.notes = "Keep commentary";
  const save = vi.fn(async () => doc), store = new Autosave(doc, { automatic: false, save, merge: (_, saved) => saved });
  return { store, save, doc };
}
describe("publication acknowledgements", () => {
  it("updates a clean editor and revision without autosaving or replacing content", async () => {
    const { store, save, doc } = session();
    expect(acceptPublicationReviewCompletion(store, completion)).toBe(true);
    expect(store.getSnapshot().value).toMatchObject({ revision: 3, review: { status: "Reviewed", notes: doc.review.notes } });
    expect(store.getSnapshot().dirty).toBe(false); await store.flush(); expect(save).not.toHaveBeenCalled();
    expect(acceptPublicationReviewCompletion(store, completion)).toBe(false);
    store.dispose();
  });
  it.each(["dirty", "saving", "revision", "note", "journal", "conflict", "superseded"])("preserves a %s editor without applying stale status", async reason => {
    const { store } = session();
    if (reason === "dirty") store.change(value => ({ ...value, review: { ...value.review, notes: "Unsaved local draft" } }));
    if (reason === "saving") store.getSnapshot().saving = true;
    if (reason === "revision") store.metadata(value => ({ ...value, revision: 4 }));
    if (reason === "note") store.metadata(value => ({ ...value, noteUpdatedAt: "2026-09-30T00:00:02Z" }));
    if (reason === "journal") store.metadata(value => ({ ...value, journalUpdatedAt: "2026-09-30T00:00:02Z" }));
    if (reason === "conflict") store.pause("Conflict; draft preserved");
    const before = structuredClone(store.getSnapshot());
    expect(acceptPublicationReviewCompletion(store, reason === "superseded" ? { sourceRevision: 2, outcome: "superseded" } : completion)).toBe(false);
    expect(store.getSnapshot()).toEqual(before); store.dispose();
  });
});
