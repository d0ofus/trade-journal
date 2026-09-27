import { describe, expect, it } from "vitest";
import { emptyDocument } from "./types";
import { documentReviewStatus, mergeReviewStatuses, startReviewOnContentEdit } from "./review-status";

describe("review status", () => {
  it("starts on text, tags, review fields and evidence, but preserves explicit status choices", () => {
    const before = emptyDocument();
    for (const patch of [{ notes: "First note" }, { tags: ["Breakout"] }, { setup: "Setup" }]) {
      expect(startReviewOnContentEdit(before, { ...before, review: { ...before.review, ...patch } }).review.status).toBe("In progress");
    }
    expect(startReviewOnContentEdit(before, { ...before, evidence: [{ id: "new" } as never] }).review.status).toBe("In progress");
    const reviewed = { ...before, review: { ...before.review, status: "Reviewed" as const } };
    expect(startReviewOnContentEdit(before, reviewed).review.status).toBe("Reviewed");
    expect(startReviewOnContentEdit(reviewed, { ...reviewed, review: { ...reviewed.review, notes: "Updated" } }).review.status).toBe("Reviewed");
    expect(startReviewOnContentEdit(reviewed, before).review.status).toBe("Not reviewed");
  });
  it("does not initiate on no-op, drawings, template selection, layout or peer metadata", () => {
    const before = emptyDocument();
    expect(startReviewOnContentEdit(before, before)).toBe(before);
    expect(startReviewOnContentEdit(before, { ...before, drawings: [{} as never] }).review.status).toBe("Not reviewed");
    expect(startReviewOnContentEdit(before, { ...before, review: { ...before.review, template: "Detailed review", notes: "Template text" } }).review.status).toBe("Not reviewed");
    const notion = { version: 1 as const, properties: {}, sections: {}, analysis: {} };
    const current = { ...before, review: { ...before.review, notion } };
    expect(startReviewOnContentEdit(current, { ...current, review: { ...current.review, notion: { ...notion, peerGroupId: "new-group" } } }).review.status).toBe("Not reviewed");
  });
  it("ignores older revisions and older timestamps without discarding equal-version corrections", () => {
    const newest = { groupKey: "a", revision: 3, updatedAt: "2026-09-27T10:00:00Z", status: "Reviewed" as const };
    const first = mergeReviewStatuses({}, [newest]);
    expect(mergeReviewStatuses(first, [{ ...newest, revision: 2, status: "Not reviewed" }])).toBe(first);
    expect(mergeReviewStatuses(first, [{ ...newest, updatedAt: "2026-09-26T10:00:00Z", status: null }])).toBe(first);
    expect(mergeReviewStatuses(first, [{ ...newest, revision: 4, status: "In progress" }]).a.status).toBe("In progress");
    expect(documentReviewStatus("a", emptyDocument()).status).toBe("Not reviewed");
  });
});
