"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Autosave, type SaveState } from "@/lib/journal/autosave";
import { RecoveryStore } from "@/lib/journal/recovery";

export type JournalDraft<F, C> = { id: string | null; updatedAt: string | null; form: F; pendingCharts: C[]; autoDraft: boolean };
const ACTIVE_ENTITY = "execution-lab:journal:active-entity";

/** Keeps editable state outside the expensive journal/chart workspace. */
export function useJournalDraft<F, C>(initial: JournalDraft<F, C>, options: {
  automatic: boolean;
  save(value: JournalDraft<F, C>, session: Autosave<JournalDraft<F, C>>): Promise<JournalDraft<F, C>>;
  publish(state: SaveState<JournalDraft<F, C>>): void;
}) {
  type Draft = JournalDraft<F, C>;
  const initialRef = useRef(initial), callbacks = useRef(options);
  const current = useRef<Autosave<Draft> | null>(null), recovery = useRef<RecoveryStore<Draft> | null>(null);
  const generation = useRef(0);
  const [session, setSession] = useState<Autosave<Draft> | null>(null);
  const [backupError, setBackupError] = useState("");
  callbacks.current = options;
  const open = useCallback(async (value: Draft, discard = false, resume = false) => {
    const own = ++generation.current;
    current.current?.dispose(); current.current = null; setSession(null); setBackupError("");
    if (discard) await recovery.current?.discard().catch(() => setBackupError("Could not remove the local recovery copy."));
    let store = new RecoveryStore<Draft>(`journal:${value.id ?? "new"}`);
    let restored: Draft | null = null;
    try {
      // A newly created capture can still have /journal (without entryId) in
      // its URL. Remember its entity in this tab so its next edits survive reload.
      if (resume && !value.id) {
        let lastId: string | null = null;
        try { lastId = sessionStorage.getItem(ACTIVE_ENTITY); } catch { /* fall back to entity-scoped IndexedDB recovery */ }
        if (lastId) {
          const previous = new RecoveryStore<Draft>(`journal:${lastId}`);
          restored = await previous.load();
          if (restored) store = previous;
        }
      }
      if (!restored) restored = await store.load();
      if (own !== generation.current) return;
      if (discard) restored = null;
      if (restored) await store.write(restored, 1);
    } catch { setBackupError("Local recovery storage could not be read. Existing recovery data has been retained."); }
    if (own !== generation.current) return;
    recovery.current = store;
    try {
      if ((restored ?? value).id) sessionStorage.setItem(ACTIVE_ENTITY, (restored ?? value).id!);
      else sessionStorage.removeItem(ACTIVE_ENTITY);
    } catch { /* IndexedDB remains available for the explicit entry URL. */ }
    // Recover an unsaved new entry's server identity after its first successful creation.
    if (!value.id && restored?.id) {
      try {
        const response = await fetch(`/api/journal/${restored.id}`);
        if (!response.ok) throw new Error("Could not verify the recovered draft's saved version.");
        const data = await response.json();
        value = { ...value, id: restored.id, updatedAt: data.entry.updatedAt };
      } catch { value = { ...value, updatedAt: "unverified" }; }
    }
    if (own !== generation.current) return;
    const active = new Autosave<Draft>(restored ?? value, {
      automatic: callbacks.current.automatic && !!(restored ?? value).id,
      dirty: !!restored,
      error: restored && restored.updatedAt !== value.updatedAt ? "Recovered draft conflicts with a newer saved entry. Export your draft before reloading the saved version." : "",
      save: async draft => {
        const saved = await callbacks.current.save(draft, active);
        if (!draft.id && saved.id) {
          try { sessionStorage.setItem(ACTIVE_ENTITY, saved.id); } catch { /* keep the existing recovery scope if storage is unavailable */ }
          const next = new RecoveryStore<Draft>(`journal:${saved.id}`);
          try {
            await next.load();
            await next.write({ ...active.getSnapshot().value, id: saved.id, updatedAt: saved.updatedAt }, active.getSnapshot().version);
            await store.clear(active.getSnapshot().version);
            store = next; recovery.current = next;
          } catch { if (own === generation.current) setBackupError("Saved to server, but the local recovery copy could not be moved to the new entry."); }
        }
        return saved;
      },
      merge: (latest, saved) => ({ ...latest, id: saved.id, updatedAt: saved.updatedAt }),
      checkpoint: (draft, version) => store.write(draft, version),
      clearCheckpoint: version => store.clear(version),
    });
    current.current = active;
    active.subscribe(() => { if (own === generation.current) callbacks.current.publish(active.getSnapshot()); });
    callbacks.current.publish(active.getSnapshot()); setSession(active);
  }, []);
  useEffect(() => {
    let cancelled = false; const lifetime = generation, active = current;
    queueMicrotask(() => { if (!cancelled) void open(initialRef.current, false, true); });
    return () => { cancelled = true; lifetime.current++; active.current?.dispose(); active.current = null; };
  }, [open]);
  useEffect(() => { session?.setAutomatic(options.automatic && !!session.getSnapshot().value.id); }, [options.automatic, session]);
  useEffect(() => {
    const checkpoint = () => { void current.current?.checkpoint(); };
    const hidden = () => { if (document.visibilityState === "hidden") checkpoint(); };
    const warn = (event: BeforeUnloadEvent) => { if (current.current?.getSnapshot().dirty) { checkpoint(); event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("blur", checkpoint); document.addEventListener("visibilitychange", hidden); window.addEventListener("beforeunload", warn); window.addEventListener("pagehide", checkpoint);
    return () => { window.removeEventListener("blur", checkpoint); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("beforeunload", warn); window.removeEventListener("pagehide", checkpoint); };
  }, []);
  return { session, current, open, backupError };
}
