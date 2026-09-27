import type { Review, TradeDocument } from "./types";

export type ReviewStatus = Review["status"];
export type ReviewStatusSummary = { groupKey: string; status: ReviewStatus | null; revision: number; updatedAt: string | null };
export const reviewStatuses = ["Not reviewed", "In progress", "Reviewed"] as const;
export function reviewStatus(value: unknown): ReviewStatus | null {
  return reviewStatuses.includes(value as ReviewStatus) ? value as ReviewStatus : null;
}
export function mergeReviewStatuses(previous: Record<string, ReviewStatusSummary>, incoming: ReviewStatusSummary[]) {
  let next = previous;
  for (const item of incoming) {
    const old = next[item.groupKey];
    if (old && (old.revision > item.revision || old.revision === item.revision && Date.parse(old.updatedAt ?? "1970-01-01") > Date.parse(item.updatedAt ?? "1970-01-01"))) continue;
    if (old?.status === item.status && old.revision === item.revision && old.updatedAt === item.updatedAt) continue;
    if (next === previous) next = { ...previous };
    next[item.groupKey] = item;
  }
  return next;
}
function content(review: Review) {
  const { status: _status, template: _template, notion, ...fields } = review;
  if (!notion) return fields;
  const { layout: _layout, peerGroupId: _peers, version: _version, executedTradeDefaults: _defaults, ...journal } = notion;
  return { ...fields, notion: journal };
}
/** Call only for deliberate journal/evidence edits, never for loading or recovery. */
export function startReviewOnContentEdit(before: TradeDocument, after: TradeDocument): TradeDocument {
  if (before.review.status !== "Not reviewed" || after.review.status !== before.review.status || before.review.template !== after.review.template) return after;
  const changed = JSON.stringify(content(before.review)) !== JSON.stringify(content(after.review)) || before.evidence.length !== after.evidence.length || before.evidence.some((item, index) => item.id !== after.evidence[index]?.id);
  return changed ? { ...after, review: { ...after.review, status: "In progress" } } : after;
}
export function documentReviewStatus(groupKey: string, document: TradeDocument): ReviewStatusSummary {
  return { groupKey, status: reviewStatus(document.review.status), revision: document.revision, updatedAt: document.noteUpdatedAt ?? document.updatedAt };
}
