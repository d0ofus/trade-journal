import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { loadPeerCandles } from "@/lib/server/peer-candles";
import { peerCandleQuerySchema } from "@/lib/workstation/peers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const p = request.nextUrl.searchParams;
  const parsed = peerCandleQuerySchema.safeParse({ symbols: (p.get("symbols") ?? "").split(","), timeframe: p.get("timeframe"), session: p.get("session"), adjustment: p.get("adjustment"), from: Number(p.get("from")), to: Number(p.get("to")) });
  if (!parsed.success) return NextResponse.json({ error: "Invalid peer candle request." }, { status: 400 });
  try {
    return NextResponse.json({ series: await loadPeerCandles(parsed.data, request.signal) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Peer charts are unavailable. Check the workstation Alpaca configuration and retry." }, { status: 503 });
  }
}
