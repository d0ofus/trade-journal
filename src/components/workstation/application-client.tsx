"use client";
import { useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApplicationAdapter } from "@/lib/workstation/application-adapter";
import { Trade } from "@/lib/workstation/types";
import { TradesWorkstation } from "./workstation";
import { tradeFilterHref, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";
export function ApplicationWorkstation({ trades, initialId, journalView = false, filters = {} }: { trades: Trade[]; initialId?: string | null; journalView?: boolean; filters?: WorkstationTradeFilters }) {
  const adapter = useMemo(() => createApplicationAdapter(), []);
  const router = useRouter();
  const lastUpdate = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => { try { const next = localStorage.getItem("execution-lab:time-interpretation-update"); if (next === lastUpdate.current) return; lastUpdate.current = next; } catch { return; } router.refresh(); };
    try { lastUpdate.current = localStorage.getItem("execution-lab:time-interpretation-update"); } catch { /* Storage can be disabled. */ }
    const storage = (event: StorageEvent) => { if (event.key === "execution-lab:time-interpretation-update") refresh(); };
    window.addEventListener("storage", storage); window.addEventListener("workstation-time-interpretation", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("storage", storage); window.removeEventListener("workstation-time-interpretation", refresh); window.removeEventListener("focus", refresh); };
  }, [router]);
  const [pending, startTransition] = useTransition();
  return <TradesWorkstation trades={trades} adapter={adapter} initialId={initialId} journalView={journalView} filterControls={{ applied: filters, pending, apply: (next, selected) => startTransition(() => router.replace(tradeFilterHref("/trades", next, selected), { scroll: false })) }} />;
}
