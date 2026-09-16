import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import { isCandleRequestAbort, SAFE_SYMBOL_PATTERN, summarizeCandleResponse } from "@/lib/server/market-candles";
import { loadWorkstationCandles } from "@/lib/server/workstation-candles";
import { loadSplitAdjustedWorkstationCandles } from "@/lib/server/workstation-split-candles";
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
  const purpose = params.get("purpose");
  const adjustment = params.get("adjustment") ?? "raw";
  if (!["raw", "split"].includes(adjustment)) return NextResponse.json({ error: "Invalid chart adjustment." }, { status: 400 });
  if (purpose !== null && (purpose !== "benchmark" || !["SPY", "QQQ"].includes(symbol))) return NextResponse.json({ error: "Invalid supplementary symbol or purpose." }, { status: 400 });
  if (!["cache", "fill", "refresh", "complete"].includes(mode)) return NextResponse.json({ error: "Invalid cache mode." }, { status: 400 });
  if (!["regular", "extended"].includes(sessionMode)) return NextResponse.json({ error: "Invalid chart session." }, { status: 400 });
  const from = Number(params.get("from")), to = Number(params.get("to"));
  const limit = Number(params.get("limit") ?? "30000");
  if (!SAFE_SYMBOL_PATTERN.test(symbol) || !intervals.includes(timeframe as Interval) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from || to > 8_640_000_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 30000) {
    return NextResponse.json({ error: "Invalid workstation candle request." }, { status: 400 });
  }
  try {
    const started = performance.now();
    const loaded = await (adjustment === "split" ? loadSplitAdjustedWorkstationCandles : loadWorkstationCandles)({ ...(purpose === "benchmark" ? { purpose: "benchmark" as const } : {}), symbol, timeframe: timeframe as Interval, range: { from, to }, limit: limit + 1, signal: request.signal, identity: params.get("identity"), session: sessionMode as "regular" | "extended", mode: mode as "cache" | "fill" | "refresh" | "complete" });
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
    const timings = loaded.cache?.timings;
    const serverTiming = [`history;dur=${(performance.now() - started).toFixed(1)}`];
    if (timings) for (const [name, value] of Object.entries({ cache: timings.cacheReadMs, queue: timings.queueWaitMs, provider: timings.providerFetchMs, persist: timings.persistenceMs, storage: timings.storageCheckMs })) {
      if (typeof value === "number" && Number.isFinite(value)) serverTiming.push(`${name};dur=${value.toFixed(1)}`);
    }
    return NextResponse.json({ symbol, timeframe, candles, source: loaded.source, provider: loaded.provider, metadata: { ...metadata, splitAdjustment: "splitAdjustment" in loaded ? loaded.splitAdjustment : undefined, session, cache: loaded.cache, coverage: loaded.coverage ?? null, warnings: [...new Set([...metadata.warnings, ...(loaded.warnings ?? [])])] } }, { headers: { "Server-Timing": serverTiming.join(", "), "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isCandleRequestAbort(error, request.signal)) throw error;
    // Only controlled configuration/provider messages reach the client; never raw fetch errors or credentials.
    return NextResponse.json({ error: "Workstation history unavailable. Check the chart provider configuration and data access, then retry." }, { status: 503 });
  }
}
