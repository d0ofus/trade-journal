"use client";
import { useMemo, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createDemoAdapter, demoTrades } from "@/lib/workstation/demo";
import { TradesWorkstation } from "./workstation";
import { ApplicationShell } from "@/components/application-shell";
import { tradeFilterError, tradeFilterHref, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";
import { filterDemoTrades } from "@/lib/workstation/demo-filters";
export function WorkstationPreview({ initialId, journalView = false, filters = {} }: { initialId?: string; journalView?: boolean; filters?: WorkstationTradeFilters }) {
  const adapter = useMemo(() => createDemoAdapter(), []);
  const router = useRouter(), pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const trades = useMemo(() => tradeFilterError(filters) ? [] : filterDemoTrades(demoTrades, filters), [filters]);
  return <ApplicationShell mode="demo"><TradesWorkstation trades={trades} adapter={adapter} initialId={initialId} journalView={journalView} filterControls={{ applied: filters, pending, apply: (next, selected) => startTransition(() => router.replace(tradeFilterHref(pathname, next, selected), { scroll: false })) }} /></ApplicationShell>;
}
