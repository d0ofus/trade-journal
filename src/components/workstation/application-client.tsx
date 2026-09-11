"use client";
import { useMemo } from "react";
import { createApplicationAdapter } from "@/lib/workstation/application-adapter";
import { Trade } from "@/lib/workstation/types";
import { TradesWorkstation } from "./workstation";
export function ApplicationWorkstation({ trades, initialId, journalView = false }: { trades: Trade[]; initialId?: string | null; journalView?: boolean }) { const adapter = useMemo(() => createApplicationAdapter(), []); return <TradesWorkstation trades={trades} adapter={adapter} initialId={initialId} journalView={journalView} />; }
