"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeReviewStatuses, type ReviewStatusSummary } from "@/lib/workstation/review-status";
import { reviewStatusEvent, reviewStatusStorageKey, type ReviewStatusEvent } from "@/lib/workstation/review-status-events";
import type { Trade, WorkstationAdapter } from "@/lib/workstation/types";

export function useReviewStatuses(adapter: WorkstationAdapter, trades: Trade[], initial: ReviewStatusSummary[]) {
  const [summaries, setSummaries] = useState(() => mergeReviewStatuses({}, initial));
  const identity = trades.map(t => t.id).join("\n");
  const keys = useMemo(() => identity ? identity.split("\n") : [], [identity]);
  const active = useRef<AbortController | null>(null);
  const receive = useCallback((rows: ReviewStatusSummary[]) => setSummaries(old => mergeReviewStatuses(old, rows)), []);
  useEffect(() => receive(initial), [initial, receive]);
  const refresh = useCallback(async () => {
    active.current?.abort();
    if (!adapter.reviewStatuses || !keys.length) return;
    const controller = new AbortController(); active.current = controller;
    try {
      const rows: ReviewStatusSummary[] = [];
      for (let i = 0; i < keys.length; i += 500) rows.push(...await adapter.reviewStatuses(keys.slice(i, i + 500), controller.signal));
      if (!controller.signal.aborted) receive(rows);
    } catch { /* Retain known saved values; never convert a failed read to Not reviewed. */ }
  }, [adapter, keys, receive]);
  useEffect(() => {
    // Server-supplied summaries avoid a second initial request in the application.
    if (keys.some(key => !initial.some(row => row.groupKey === key))) void refresh();
    const saved = (event: Event) => { const { mode, summary } = (event as ReviewStatusEvent).detail; if (mode === adapter.mode && keys.includes(summary.groupKey)) receive([summary]); };
    const storage = (event: StorageEvent) => { if (event.key === reviewStatusStorageKey(adapter.mode)) void refresh(); };
    const focus = () => { void refresh(); };
    window.addEventListener(reviewStatusEvent, saved); window.addEventListener("storage", storage); window.addEventListener("focus", focus);
    return () => { active.current?.abort(); window.removeEventListener(reviewStatusEvent, saved); window.removeEventListener("storage", storage); window.removeEventListener("focus", focus); };
  }, [adapter.mode, initial, keys, receive, refresh]);
  return summaries;
}
