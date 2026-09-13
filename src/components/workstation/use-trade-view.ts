"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkstationAdapter } from "@/lib/workstation/types";
import { emptyTradeView, tradeViewSchema, type SavedTradeView, type TradeView } from "@/lib/workstation/trade-view";

type Session = { id: string; key: string; saved: SavedTradeView; pending: TradeView | null; busy: Promise<boolean> | null; blocked: boolean };
/** Independent of the canonical review. A failed/stale view save never overwrites journal text. */
export function useTradeView(adapter: WorkstationAdapter, id: string, enabled: boolean, restore: (view: TradeView) => void) {
  const current = useRef<Session | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRef = useRef(restore); restoreRef.current = restore;
  const [ready, setReady] = useState(""), [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const report = useCallback((session: Session, message: string) => { if (current.current === session) setError(message); }, []);
  const persist = useCallback(async (session: Session): Promise<boolean> => {
    if (session.busy) return session.busy;
    if (!session.pending || !adapter.saveView || session.blocked) return !session.blocked;
    session.busy = (async () => {
      try {
        while (session.pending) {
          const snapshot = session.pending;
          session.saved = await adapter.saveView!(session.id, snapshot, session.saved.revision);
          if (session.pending === snapshot) { session.pending = null; try { localStorage.removeItem(session.key); } catch { /* server copy is durable */ } }
          else localStorage.setItem(session.key, JSON.stringify({ revision: session.saved.revision, view: session.pending }));
        }
        report(session, ""); return true;
      } catch (failure) {
        session.blocked = true;
        report(session, failure instanceof Error ? failure.message : "Chart view save failed. Your pending view is kept on this device.");
        return false;
      } finally { session.busy = null; }
    })();
    return session.busy;
  }, [adapter, report]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    return current.current ? persist(current.current) : true;
  }, [persist]);
  useEffect(() => {
    if (!enabled || !id) return;
    let disposed = false;
    const session: Session = { id, key: `execution-lab:trade-view:${adapter.mode}:${id}:v1`, saved: emptyTradeView(), pending: null, busy: null, blocked: false };
    current.current = session; setReady(""); setError("");
    void (async () => {
      try {
        session.saved = await adapter.loadView?.(id) ?? emptyTradeView();
        if (disposed) return;
        const raw = localStorage.getItem(session.key);
        if (raw) {
          const draft = JSON.parse(raw), view = tradeViewSchema.parse(draft.view);
          session.pending = view;
          if (draft.revision !== session.saved.revision) { session.blocked = true; report(session, "Chart view changed in another tab. Recovered local view is preserved; use the saved view to resolve."); }
        }
        const view = session.pending ?? session.saved.view;
        if (view) restoreRef.current(view);
        setReady(id);
        if (session.pending && !session.blocked) void persist(session);
      } catch {
        if (!disposed) { session.blocked = true; report(session, "Saved chart view could not be loaded. Retry before saving a replacement."); setReady(id); }
      }
    })();
    return () => { disposed = true; if (timer.current) clearTimeout(timer.current); void persist(session); };
  }, [adapter, id, enabled, generation, persist, report]);
  const change = useCallback((view: TradeView) => {
    const session = current.current;
    if (!session || session.id !== id || ready !== id) return;
    const next = tradeViewSchema.parse(view);
    if (JSON.stringify(session.pending ?? session.saved.view) === JSON.stringify(next)) return;
    session.pending = next;
    try { localStorage.setItem(session.key, JSON.stringify({ revision: session.saved.revision, view: next })); }
    catch { report(session, "Device storage is full. Keep this page open until the chart view is saved."); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist(session); }, 1000);
  }, [id, ready, persist, report]);
  useEffect(() => { const hide = () => { if (document.visibilityState === "hidden") void flush(); }; document.addEventListener("visibilitychange", hide); return () => document.removeEventListener("visibilitychange", hide); }, [flush]);
  return { ready: ready === id, error, change, flush, generation, useSaved: () => { const session = current.current; if (session) localStorage.removeItem(session.key); setReady(""); setGeneration(value => value + 1); } };
}
