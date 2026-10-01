"use client";
import { useSyncExternalStore } from "react";
import type { ReviewStatusSummary } from "@/lib/workstation/review-status";
import type { useTradeDocument } from "./use-trade-document";

const empty = () => null, subscribe = () => () => {};
export function ReviewStatusDot({ summary, persistence }: { summary?: ReviewStatusSummary; persistence?: Pick<ReturnType<typeof useTradeDocument>, "subscribe" | "getSnapshot"> }) {
  const snapshot = useSyncExternalStore(persistence?.subscribe ?? subscribe, persistence?.getSnapshot ?? empty, empty);
  const unsaved = !!snapshot?.dirty;
  const status = unsaved ? snapshot!.value.review.status : summary?.status ?? null;
  const state = status === "Reviewed" ? "reviewed" : status === "In progress" ? "in-progress" : status === "Not reviewed" ? "not-reviewed" : "unavailable";
  const label = `Review status: ${status ?? "Unavailable"}${unsaved ? snapshot?.error ? " · unsaved draft; resolve save issue" : " · unsaved changes" : ""}`;
  return <span className="ws-review-dot" role="img" aria-label={label} title={label} data-review-state={state} data-unsaved={unsaved || undefined} />;
}
