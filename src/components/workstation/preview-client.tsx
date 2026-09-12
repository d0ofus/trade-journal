"use client";
import { useMemo, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createDemoAdapter, demoTrades } from "@/lib/workstation/demo";
import { TradesWorkstation } from "./workstation";
import { ApplicationShell } from "@/components/application-shell";
import { tradeFilterError, tradeFilterHref, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";
import { filterDemoTrades } from "@/lib/workstation/demo-filters";
import { timingDemoTrade } from "@/lib/workstation/timing-demo";
import { diagnosticDemoTrade } from "@/lib/workstation/diagnostic-demo";
export function WorkstationPreview({ initialId, journalView = false, filters = {}, diagnostic = false, timing = false, interpreted = true }: { initialId?: string; journalView?: boolean; filters?: WorkstationTradeFilters; diagnostic?: boolean; timing?: boolean; interpreted?: boolean }) {
  const samples = useMemo(() => timing ? [timingDemoTrade(interpreted), ...demoTrades] : diagnostic ? [diagnosticDemoTrade, ...demoTrades] : demoTrades, [diagnostic, timing, interpreted]);
  const adapter = useMemo(() => createDemoAdapter(samples), [samples]);
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const trades = useMemo(() => tradeFilterError(filters) ? [] : filterDemoTrades(samples, filters), [filters, samples]);
  return <ApplicationShell mode="demo"><TradesWorkstation trades={trades} adapter={adapter} initialId={initialId ?? (timing ? "demo-mu-timing" : diagnostic ? diagnosticDemoTrade.id : undefined)} journalView={journalView} filterControls={{ applied: filters, pending, apply: (next, selected) => startTransition(() => { const href = new URL(tradeFilterHref(pathname, next, selected), window.location.origin); if (diagnostic) href.searchParams.set("scenario", "execution-mismatch"); if (timing) { href.searchParams.set("scenario", "execution-timing"); href.searchParams.set("interpretation", interpreted ? "eastern" : "original"); } router.replace(href.pathname + href.search, { scroll: false }); }) }} /></ApplicationShell>;
}
