import { documentReviewStatus, type ReviewStatusSummary } from "./review-status";
import type { TradeDocument } from "./types";
export const reviewStatusEvent = "execution-lab-review-status";
export const reviewStatusStorageKey = (mode: string) => `execution-lab:review-status:${mode}:v1`;
export function announceReviewStatus(mode: string, groupKey: string, document: TradeDocument, saved = false) {
  const summary = documentReviewStatus(groupKey, document);
  window.dispatchEvent(new CustomEvent(reviewStatusEvent, { detail: { mode, summary } }));
  if (saved) try { localStorage.setItem(reviewStatusStorageKey(mode), JSON.stringify(summary)); } catch { /* Focus refresh remains available when storage is disabled. */ }
}
export type ReviewStatusEvent = CustomEvent<{ mode: string; summary: ReviewStatusSummary }>;
