import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { isCandleRequestAbort, SAFE_SYMBOL_PATTERN, summarizeCandleResponse } from "@/lib/server/market-candles";
import { loadWorkstationCandles } from "@/lib/server/workstation-candles";
import { intervals, Interval } from "@/lib/workstation/types";
import { workstationCandleSession } from "@/lib/server/workstation-candle-session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  const timeframe = params.get("timeframe") ?? "5m";
  const sessionMode = params.get("session") ?? "regular";
  const mode = params.get("mode") ?? "complete";
  if (!["cache", "fill", "refresh", "complete"].includes(mode)) return NextResponse.json({ error: "Invalid cache mode." }, { status: 400 });
  if (!["regular", "extended"].includes(sessionMode)) return NextResponse.json({ error: "Invalid chart session." }, { status: 400 });
  const from = Number(params.get("from")), to = Number(params.get("to"));
  const limit = Number(params.get("limit") ?? "30000");
  if (!SAFE_SYMBOL_PATTERN.test(symbol) || !intervals.includes(timeframe as Interval) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to > 8_640_000_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 30000) {
    return NextResponse.json({ error: "Invalid workstation candle request." }, { status: 400 });
  }
  try {
    const started = performance.now();
    const loaded = await loadWorkstationCandles({ symbol, timeframe: timeframe as Interval, range: { from, to }, limit: limit + 1, signal: request.signal, identity: params.get("identity"), session: sessionMode as "regular" | "extended", mode: mode as "cache" | "fill" | "refresh" | "complete" });
    const candles = loaded.candles.slice(-limit);
    const metadata = summarizeCandleResponse({ candles, range: { from, to }, limit, loadedCount: loaded.candles.length });
    if (loaded.cache?.enabled && !loaded.cache.missing.length) {
      // Sparse sessions and exchange closures are valid completed queries; candle presence
      // alone must not override the durable coverage ledger.
      metadata.warnings = metadata.warnings.filter(w => !w.startsWith("Candle data starts") && !w.startsWith("Candle data ends"));
      if (!candles.length) metadata.warnings.push("Provider query completed with no eligible candles in this period.");
    }
    if (mode === "complete" && loaded.cache?.missing.length) {
      metadata.truncated = true;
      metadata.warnings.push("This large or queued history request is incomplete. Coverage metadata identifies the remaining ranges.");
    }
    const session = await workstationCandleSession(loaded).catch(() => ({ timezone: null, calendar: "unknown", marketHours: "unknown" }));
    return NextResponse.json({ symbol, timeframe, candles, source: loaded.source, provider: loaded.provider, metadata: { ...metadata, session, cache: loaded.cache, coverage: loaded.coverage ?? null, warnings: [...new Set([...metadata.warnings, ...(loaded.warnings ?? [])])] } }, { headers: { "Server-Timing": `history;dur=${(performance.now() - started).toFixed(1)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isCandleRequestAbort(error, request.signal)) throw error;
    // Only controlled configuration/provider messages reach the client; never raw fetch errors or credentials.
    return NextResponse.json({ error: "Workstation history unavailable. Check the chart provider configuration and data access, then retry." }, { status: 503 });
  }
}
