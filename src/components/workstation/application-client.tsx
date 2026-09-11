"use client";
import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApplicationAdapter } from "@/lib/workstation/application-adapter";
import { Trade } from "@/lib/workstation/types";
import { TradesWorkstation } from "./workstation";
import { tradeFilterHref, type WorkstationTradeFilters } from "@/lib/workstation/trade-filters";
export function ApplicationWorkstation({ trades, initialId, journalView = false, filters = {} }: { trades: Trade[]; initialId?: string | null; journalView?: boolean; filters?: WorkstationTradeFilters }) {
  const adapter = useMemo(() => createApplicationAdapter(), []);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <TradesWorkstation trades={trades} adapter={adapter} initialId={initialId} journalView={journalView} filterControls={{ applied: filters, pending, apply: (next, selected) => startTransition(() => router.replace(tradeFilterHref("/trades", next, selected), { scroll: false })) }} />;
}
