import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { listWorkstationTrades } from "@/lib/server/trade-workstation";
import { loadTradeMetrics } from "@/lib/server/workstation-metrics";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: NextRequest, context: { params: Promise<{ groupKey: string }> }) {
  const denied = await requireApiSession(); if (denied) return denied;
  const { groupKey: id } = await context.params;
  const trades = await listWorkstationTrades({}, id, false, true), trade = trades.find(t => t.id === id);
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  try { return NextResponse.json(await loadTradeMetrics(trade, request.signal), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Pre-trade metrics unavailable. Retry shortly." }, { status: 503 }); }
}
