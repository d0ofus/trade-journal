"use client";
import { useEffect, useRef, useState } from "react";
import { discardPendingEvidence, forgetPendingEvidence, pendingEvidence, resumePendingImage } from "@/lib/workstation/evidence-storage";
import type { Evidence } from "@/lib/workstation/types";
import type { ReviewSectionKey } from "@/lib/workstation/notion-template";
export function PendingEvidence({ tradeId, mode, savedIds, readOnly, onRecover }: { tradeId: string; mode: "demo" | "application"; savedIds: string[]; readOnly: boolean; onRecover: (evidence: Evidence, section?: ReviewSectionKey) => Promise<void> }) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof pendingEvidence>>>([]), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null), ids = savedIds.join("\0");
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => { let alive = true; const refresh = () => void pendingEvidence(tradeId, mode).then(items => { if (alive) setPending(items.filter(item => !savedIds.includes(item.evidence.id))); }).catch(() => {}); refresh(); const timer = setInterval(refresh, 3000); return () => { alive = false; clearInterval(timer); }; }, [tradeId, mode, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pending.length) return null;
  return <details><summary>Pending image recovery ({pending.length})</summary><p>Originals are preserved on this device. Recovery restores the selected section when available; older pending images remain unassigned in Evidence.</p>{pending.map(item => <div key={item.key}><span>{item.evidence.name}</span><button type="button" disabled={readOnly || busy} onClick={() => {
    const controller = new AbortController(); active.current = controller; setBusy(true); setMessage("Uploading/verifying recovered original…");
    void resumePendingImage(item, controller.signal).then(async image => {
      controller.signal.throwIfAborted(); await onRecover(image, item.section); await forgetPendingEvidence(tradeId, mode, image.id);
      if (!controller.signal.aborted) { setPending(items => items.filter(p => p.key !== item.key)); setMessage("Recovered and saved."); }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Recovery failed"); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
  }}>Resume attachment</button><button type="button" disabled={readOnly || busy} onClick={() => {
    setBusy(true); void discardPendingEvidence(item).then(() => setPending(items => items.filter(p => p.key !== item.key))).catch(error => setMessage(error instanceof Error ? error.message : "Cancellation failed; the original remains on this device.")).finally(() => setBusy(false));
  }}>Discard local pending image</button></div>)}<p role="status">{message}</p></details>;
}
