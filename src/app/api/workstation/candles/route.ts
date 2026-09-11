import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { isCandleRequestAbort, SAFE_SYMBOL_PATTERN, summarizeCandleResponse } from "@/lib/server/market-candles";
import { loadWorkstationCandles } from "@/lib/server/workstation-candles";
import { intervals, Interval } from "@/lib/workstation/types";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  const timeframe = params.get("timeframe") ?? "5m";
  const from = Number(params.get("from")), to = Number(params.get("to"));
  const limit = Number(params.get("limit") ?? "30000");
  if (!SAFE_SYMBOL_PATTERN.test(symbol) || !intervals.includes(timeframe as Interval) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to > 8_640_000_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 30000) {
    return NextResponse.json({ error: "Invalid workstation candle request." }, { status: 400 });
  }
  try {
    const loaded = await loadWorkstationCandles({ symbol, timeframe: timeframe as Interval, range: { from, to }, limit: limit + 1, signal: request.signal, identity: params.get("identity") });
    const candles = loaded.candles.slice(-limit);
    const metadata = summarizeCandleResponse({ candles, range: { from, to }, limit, loadedCount: loaded.candles.length });
    return NextResponse.json({ symbol, timeframe, candles, source: loaded.source, provider: loaded.provider, metadata: { ...metadata, coverage: loaded.coverage ?? null, warnings: [...new Set([...metadata.warnings, ...(loaded.warnings ?? [])])] } });
  } catch (error) {
    if (isCandleRequestAbort(error, request.signal)) throw error;
    // Only controlled configuration/provider messages reach the client; never raw fetch errors or credentials.
    return NextResponse.json({ error: "Workstation history unavailable. Check the chart provider configuration and data access, then retry." }, { status: 503 });
  }
}
