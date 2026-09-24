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
  if (p.get("metadataOnly") === "1") {
    const symbol = (p.get("symbol") ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(symbol)) return NextResponse.json({ error: "Invalid peer symbol." }, { status: 400 });
    try {
      const { workstationCandlePolicy } = await import("@/lib/server/workstation-candle-policy");
      const { loadStockSplits } = await import("@/lib/server/workstation-stock-splits");
      const credentials = workstationCandlePolicy().credentials;
      if (!credentials) throw new Error("Missing credentials");
      return NextResponse.json({ symbol, splitAdjustment: await loadStockSplits(symbol, credentials, request.signal, true) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch { return NextResponse.json({ error: "Ticker-specific split adjustments could not be verified. Drawings are disabled until verification succeeds; other charts remain available." }, { status: 503 }); }
  }
  const parsed = peerCandleQuerySchema.safeParse({ symbols: (p.get("symbols") ?? "").split(","), timeframe: p.get("timeframe"), session: p.get("session"), adjustment: p.get("adjustment"), from: Number(p.get("from")), to: Number(p.get("to")) });
  if (!parsed.success) return NextResponse.json({ error: "Invalid peer candle request." }, { status: 400 });
  try {
    return NextResponse.json({ series: await loadPeerCandles(parsed.data, request.signal) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Peer charts are unavailable. Check the workstation Alpaca configuration and retry." }, { status: 503 });
  }
}
