"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TradeDocument, WorkstationAdapter } from "@/lib/workstation/types";
import { Autosave, type SaveState } from "@/lib/journal/autosave";
import { RecoveryStore } from "@/lib/journal/recovery";
import { sameEvidenceAssignments } from "@/lib/workstation/evidence";

export function documentSaveStatus(state: SaveState<TradeDocument>, mode: string) {
  if (state.error) return /conflict|another tab/i.test(state.error) ? "Conflict \u00b7 draft preserved" : "Save paused \u00b7 draft preserved";
  if (state.saving) return "Saving\u2026";
  if (state.dirty) return "Unsaved changes\u2026";
  return mode === "demo" ? "Saved on this device" : "All changes saved";
}
export function useTradeDocument(adapter: WorkstationAdapter, id: string) {
  const [document, setDocument] = useState<TradeDocument | null>(null), [loadedFor, setLoadedFor] = useState("");
  const [error, setError] = useState("");
  const state = useRef<Autosave<TradeDocument> | null>(null), recovery = useRef<RecoveryStore<TradeDocument> | null>(null);
  const generation = useRef(0), listeners = useRef(new Set<() => void>()), published = useRef<TradeDocument | null>(null);
  const key = `execution-lab:workstation:draft:${adapter.mode}:${id}`;
  const emit = useCallback(() => { listeners.current.forEach(listener => listener()); }, []);
  const subscribe = useCallback((listener: () => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const getSnapshot = useCallback(() => state.current?.getSnapshot() ?? null, []);
  const load = useCallback(async (discard = false) => {
    const own = ++generation.current;
    state.current?.dispose(); state.current = null; emit();
    setDocument(null); published.current = null; setLoadedFor(""); setError("");
    if (!id) return;
    try {
      if (discard) { await recovery.current?.discard(); localStorage.removeItem(key); }
      const store = new RecoveryStore<TradeDocument>(`workstation:${adapter.mode}:${id}`);
      recovery.current = store;
      const saved = await adapter.load(id);
      if (own !== generation.current) return;
      let draft: TradeDocument | null = null, backupError = "";
      try { draft = await store.load(); }
      catch { backupError = "Local recovery storage could not be read. Existing recovery data has been retained."; }
      if (own !== generation.current) return;
      try {
        const raw = localStorage.getItem(key);
        if (!draft && raw && !discard) {
          draft = JSON.parse(raw) as TradeDocument;
          await store.write(draft, 1);
          if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
        }
        if (discard) draft = null;
        else if (draft) await store.write(draft, 1);
      } catch { backupError = "Local recovery backup could not be migrated. Existing recovery data has been retained."; }
      if (own !== generation.current) return;
      const conflict = draft && (draft.revision !== saved.revision || (draft.noteUpdatedAt ?? null) !== (saved.noteUpdatedAt ?? null) || (draft.journalUpdatedAt ?? null) !== (saved.journalUpdatedAt ?? null));
      const session = new Autosave(draft ?? saved, {
        dirty: !!draft,
        error: conflict ? "Recovered draft conflicts with a newer saved review. Export the draft, then reload the saved review." : "",
        save: doc => adapter.save(id, doc, doc.revision),
        merge: (doc, next) => ({ ...doc, evidenceProtocol: next.evidenceProtocol ?? doc.evidenceProtocol, evidence: doc.evidence.map(e => { const saved = next.evidence.find(s => s.id === e.id); return !e.asset && saved?.asset ? { ...e, image: "", asset: saved.asset } : e; }), revision: next.revision, updatedAt: next.updatedAt, noteUpdatedAt: next.noteUpdatedAt, journalUpdatedAt: next.journalUpdatedAt, journalEntryId: next.journalEntryId }),
        checkpoint: store.write, clearCheckpoint: store.clear,
      });
      state.current = session;
      const publish = () => {
        if (own !== generation.current) return;
        const next = session.getSnapshot().value, previous = published.current;
        // Text subscribers update immediately; charts only see structural changes.
        if (!previous || previous.comparison !== next.comparison || previous.drawings !== next.drawings || previous.evidence !== next.evidence || previous.review.status !== next.review.status || !sameEvidenceAssignments(previous.review.notion, next.review.notion)) {
          published.current = next; setDocument(next);
        }
        emit();
      };
      session.subscribe(publish); publish(); setLoadedFor(id); setError(backupError);
    } catch (failure) { if (own === generation.current) setError(failure instanceof Error ? failure.message : "Could not load review"); }
  }, [adapter, id, key, emit]);
  useEffect(() => {
    let cancelled = false; const lifetime = generation, active = state;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; lifetime.current++; active.current?.dispose(); active.current = null; };
  }, [load]);
  useEffect(() => {
    const checkpoint = () => { void state.current?.checkpoint(); };
    const hidden = () => { if (window.document.visibilityState === "hidden") checkpoint(); };
    const warn = (event: BeforeUnloadEvent) => { if (state.current?.getSnapshot().dirty) { checkpoint(); event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("blur", checkpoint); window.addEventListener("pagehide", checkpoint); window.addEventListener("beforeunload", warn); window.document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", checkpoint); window.removeEventListener("pagehide", checkpoint); window.removeEventListener("beforeunload", warn); window.document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const change = useCallback((update: (doc: TradeDocument) => TradeDocument) => state.current?.change(update), []);
  const flush = useCallback(() => state.current?.flush() ?? Promise.resolve(false), []);
  const retry = useCallback(() => state.current?.retry() ?? Promise.resolve(false), []);
  const getDocument = useCallback(() => state.current?.getSnapshot().value ?? null, []);
  return { document: loadedFor === id ? document : null, subscribe, getSnapshot, change, flush, error, retry, reload: () => load(true), getDocument };
}
