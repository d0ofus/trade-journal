"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fallbackLayout, sectionChoices, templateLayoutSchema, type TemplateLayout } from "@/lib/workstation/template-layout";

type LayoutState = { layout: TemplateLayout; warning: string; pending: boolean; refresh: () => void };
export const TemplateLayoutContext = createContext<LayoutState>({ layout: fallbackLayout, warning: "", pending: false, refresh: () => {} });
export const useJournalLayout = () => useContext(TemplateLayoutContext);
export function useJournalSections(saved?: TemplateLayout) { const { layout } = useJournalLayout(); return sectionChoices(layout, saved); }
export function useTemplateLayout(mode: "application" | "demo", saved?: TemplateLayout): LayoutState {
  const [layout, setLayout] = useState<TemplateLayout | null>(null), [warning, setWarning] = useState(""), [pending, setPending] = useState(false);
  const queued = useRef<TemplateLayout | null>(null), controller = useRef<AbortController | null>(null);
  const latest = useRef(layout ?? saved); latest.current = layout ?? saved;
  const apply = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".ws-journal-content") && active.matches("input,textarea,select,[contenteditable=true],[contenteditable=true] *")) return;
    if (queued.current) { setLayout(queued.current); queued.current = null; setPending(false); }
  }, []);
  const refresh = useCallback(async (manual = false) => {
    if (mode !== "application" || controller.current || document.visibilityState === "hidden") return;
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch("/api/workstation/notion/template", { method: manual ? "POST" : "GET", signal: request.signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Section refresh unavailable.");
      const next = templateLayoutSchema.parse(result.layout);
      setWarning(typeof result.warning === "string" ? result.warning : "");
      if (next.id === "builtin" && latest.current && latest.current.id !== "builtin" && result.warning) return;
      queued.current = next; setPending(true); apply();
    } catch (error) { if (!request.signal.aborted) setWarning(error instanceof Error ? error.message : "Section refresh failed. The last layout is retained."); }
    finally { if (controller.current === request) controller.current = null; }
  }, [apply, mode]);
  useEffect(() => {
    void refresh();
    const check = () => { void refresh(); }, adopt = () => { setTimeout(apply, 0); };
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check); document.addEventListener("visibilitychange", check); document.addEventListener("focusout", adopt);
    return () => { controller.current?.abort(); controller.current = null; clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); document.removeEventListener("focusout", adopt); };
  }, [apply, refresh]);
  return { layout: layout ?? saved ?? fallbackLayout, warning, pending, refresh: () => { void refresh(true); } };
}
