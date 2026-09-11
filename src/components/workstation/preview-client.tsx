"use client";
import { useMemo } from "react";
import { createDemoAdapter, demoTrades } from "@/lib/workstation/demo";
import { TradesWorkstation } from "./workstation";
export function WorkstationPreview({ initialId, journalView = false }: { initialId?: string; journalView?: boolean }) { const adapter = useMemo(() => createDemoAdapter(), []); return <TradesWorkstation trades={demoTrades} adapter={adapter} initialId={initialId} journalView={journalView} />; }
