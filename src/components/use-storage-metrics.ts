"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeStorageUsage, STORAGE_CHANGED_EVENT, STORAGE_REFRESH_MS, R2_REFRESH_MS, type StorageUsage } from "@/lib/storage-usage";

export function useStorageMetrics() {
  const [usage, setUsage] = useState<StorageUsage | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [providerError, setProviderError] = useState(""), [now, setNow] = useState(() => Date.now());
  const pending = useRef<AbortController | null>(null), nextProviderAttempt = useRef(0);
  const refreshAfterPending = useRef(false);
  const providerFailureAt = useRef(0);
  const refresh = useCallback(async function refreshReading() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    const signal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    try {
      const response = await fetch("/api/settings/storage", { cache: "no-store", signal: signal() });
      if (!response.ok) throw new Error("Application measurements are unavailable. The previous readings have been retained.");
      const body: StorageUsage = await response.json();
      if (controller.signal.aborted) return;
      setUsage(previous => mergeStorageUsage(previous, body)); setError(""); setNow(Date.now());
      const permitted = body.evidence?.accountNextRefreshAt ?? body.evidence?.account?.nextRefreshAt;
      if (Date.now() >= Math.max(nextProviderAttempt.current, permitted ? Date.parse(permitted) || 0 : 0)) {
        nextProviderAttempt.current = Date.now() + R2_REFRESH_MS;
        try {
          const result = await fetch("/api/settings/storage", { method: "POST", cache: "no-store", signal: signal() });
          if (!result.ok) throw new Error("Cloudflare metrics refresh is unavailable; the previous reading was retained.");
          const cloud = await result.json() as { account: NonNullable<StorageUsage["evidence"]>["account"]; error: string | null; nextRefreshAt: string | null };
          if (controller.signal.aborted) return;
          nextProviderAttempt.current = cloud.nextRefreshAt ? Date.parse(cloud.nextRefreshAt) || nextProviderAttempt.current : nextProviderAttempt.current;
          setProviderError(cloud.error ?? "");
          providerFailureAt.current = cloud.error ? Date.now() : 0;
          setUsage(previous => previous?.evidence ? { ...previous, evidence: { ...previous.evidence, account: cloud.account ?? previous.evidence.account,
            accountError: cloud.error, accountNextRefreshAt: cloud.nextRefreshAt } } : previous);
        } catch (failure) {
          if (!controller.signal.aborted) { setProviderError(failure instanceof Error ? failure.message : "Cloudflare refresh failed."); providerFailureAt.current = Date.now(); }
        }
      } else if (!body.evidence?.accountError && body.evidence?.account && Date.parse(body.evidence.account.measuredAt) > providerFailureAt.current) {
        setProviderError(""); providerFailureAt.current = 0;
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Metrics refresh failed.");
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) {
        setBusy(false); setNow(Date.now());
        if (refreshAfterPending.current) { refreshAfterPending.current = false; void refreshReading(); }
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const changed = () => {
      if (pending.current) refreshAfterPending.current = true;
      else visible();
    };
    const timer = setInterval(visible, STORAGE_REFRESH_MS), clock = setInterval(() => setNow(Date.now()), 10_000);
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    window.addEventListener(STORAGE_CHANGED_EVENT, changed);
    return () => {
      clearInterval(timer); clearInterval(clock); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible); window.removeEventListener(STORAGE_CHANGED_EVENT, changed); refreshAfterPending.current = false;
      pending.current?.abort(); pending.current = null;
    };
  }, [refresh]);
  return { usage, error, providerError, now, busy, refresh };
}
