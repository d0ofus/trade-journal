import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { listWorkstationTrades } from "@/lib/server/trade-workstation";
import { loadTradeFundamentals } from "@/lib/server/sec-fundamentals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  const auth = await requireApiSession(); if (auth) return auth;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const tradeId = request.nextUrl.searchParams.get("tradeId"), mode = request.nextUrl.searchParams.get("mode");
  if (!tradeId || tradeId.length > 200 || !["before-entry", "latest"].includes(mode ?? "")) return NextResponse.json({ error: "A trade identifier and fundamentals mode are required." }, { status: 400 });
  try {
    const trade = (await listWorkstationTrades({}, tradeId, true, true))[0];
    if (!trade) return NextResponse.json({ error: "Trade not found." }, { status: 404 });
    const result = await loadTradeFundamentals(trade, mode as "before-entry" | "latest", request.signal);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Fundamentals could not be loaded. Retry shortly." }, { status: 503 }); }
}
