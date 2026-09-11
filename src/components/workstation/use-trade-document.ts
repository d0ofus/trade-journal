"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TradeDocument, WorkstationAdapter } from "@/lib/workstation/types";

export function useTradeDocument(adapter: WorkstationAdapter, id: string) {
  const [document, setDocument] = useState<TradeDocument | null>(null);
  const [status, setStatus] = useState("Loading review…");
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const state = useRef<{ doc: TradeDocument | null; dirty: boolean; generation: number; job: Promise<boolean> | null; failed: boolean }>({ doc: null, dirty: false, generation: 0, job: null, failed: false });
  const key = `execution-lab:workstation:draft:${adapter.mode}:${id}`;
  const load = useCallback(async (discard = false) => {
    const generation = ++state.current.generation;
    state.current.dirty = false; state.current.failed = false; state.current.doc = null;
    setDocument(null); setLoadedFor(""); setError(""); setStatus(id ? "Loading review…" : "Select a trade");
    if (!id) return;
    try {
      if (discard) localStorage.removeItem(key);
      const saved = await adapter.load(id);
      if (generation !== state.current.generation) return;
      const raw = localStorage.getItem(key);
      const draft = raw ? JSON.parse(raw) as TradeDocument : null;
      const current = draft ?? saved;
      state.current.doc = current; state.current.dirty = !!draft;
      setDocument(current);
      setLoadedFor(id);
      if (draft && (draft.revision !== saved.revision || (draft.noteUpdatedAt ?? null) !== (saved.noteUpdatedAt ?? null) || (draft.journalUpdatedAt ?? null) !== (saved.journalUpdatedAt ?? null))) { state.current.failed = true; setError("Recovered draft conflicts with a newer saved review. Export the draft, then reload the saved review."); setStatus("Conflict · draft preserved"); }
      else setStatus(draft ? "Recovered local draft" : adapter.mode === "demo" ? "Saved on this device" : "All changes saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load review"); setStatus("Unable to load"); }
  }, [adapter, id, key]);
  useEffect(() => { const current = state.current; void load(); return () => { current.generation++; }; }, [load]);
  const change = useCallback((update: (doc: TradeDocument) => TradeDocument) => {
    const s = state.current; if (!s.doc) return;
    const next = update(s.doc); s.doc = next; s.dirty = true; setDocument(next);
    try { localStorage.setItem(key, JSON.stringify(next)); if (!s.failed) setStatus("Unsaved changes…"); }
    catch { setError("Device storage is full. Keep this tab open and export your review."); setStatus("Draft not backed up"); }
  }, [key]);
  const flush = useCallback((): Promise<boolean> => {
    const s = state.current;
    if (s.job) return s.job;
    if (s.failed) return Promise.resolve(false);
    if (!s.dirty || !s.doc) return Promise.resolve(true);
    const generation = s.generation;
    s.job = (async () => {
      try {
        while (s.dirty && s.doc && generation === s.generation) {
          const snapshot = s.doc; s.dirty = false; setStatus("Saving…");
          const saved = await adapter.save(id, snapshot, snapshot.revision);
          if (generation !== s.generation) return false;
          s.doc = s.dirty ? { ...s.doc!, revision: saved.revision, updatedAt: saved.updatedAt, noteUpdatedAt: saved.noteUpdatedAt, journalEntryId: saved.journalEntryId, journalUpdatedAt: saved.journalUpdatedAt } : saved;
          setDocument(s.doc);
          if (s.dirty) localStorage.setItem(key, JSON.stringify(s.doc)); else localStorage.removeItem(key);
        }
        setStatus(adapter.mode === "demo" ? "Saved on this device" : "All changes saved"); setError(""); return true;
      } catch (e) { s.dirty = true; s.failed = true; setError(e instanceof Error ? e.message : "Save failed"); setStatus("Save paused · draft preserved"); return false; }
      finally { s.job = null; }
    })();
    return s.job;
  }, [adapter, id, key]);
  useEffect(() => { if (!document || !state.current.dirty || state.current.failed) return; const timer = setTimeout(() => void flush(), 700); return () => clearTimeout(timer); }, [document, flush]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (state.current.dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, []);
  const retry = useCallback(() => { state.current.failed = false; return flush(); }, [flush]);
  return { document: loadedFor === id ? document : null, change, flush, status, error, retry, reload: () => load(true), getDocument: () => state.current.doc };
}
