import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/api-auth";
import {
  type Candle,
  type CandleRange,
  type CandleTimeframe,
  isCandleRequestAbort,
  loadCandlesForSymbol,
  parseCandleTimeframe,
  SAFE_SYMBOL_PATTERN,
  summarizeCandleResponse,
} from "@/lib/server/market-candles";

export const dynamic = "force-dynamic";

const CANDLE_SERVICE_UNAVAILABLE_WARNING = "Candle service unavailable; no candle data returned.";

function buildCandlePayload(input: {
  candles: Candle[];
  limit: number;
  range: CandleRange;
  warnings?: string[];
}) {
  const returnedCandles = input.candles.slice(-input.limit);
  const metadata = summarizeCandleResponse({
    candles: returnedCandles,
    range: input.range,
    limit: input.limit,
    loadedCount: input.candles.length,
  });
  return {
    candles: returnedCandles,
    metadata: {
      ...metadata,
      warnings: [...metadata.warnings, ...(input.warnings ?? [])],
    },
  };
}

async function loadCandlesForRoute(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: CandleRange;
  limit: number;
  signal: AbortSignal;
}) {
  let loaded;
  try {
    loaded = await loadCandlesForSymbol({
      ...input,
      limit: input.limit + 1,
    });
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    loaded = {
      symbol: input.symbol,
      candles: [],
      source: null,
      warnings: [CANDLE_SERVICE_UNAVAILABLE_WARNING],
    };
  }
  if (!loaded) return null;
  const payload = buildCandlePayload({ candles: loaded.candles, range: input.range, limit: input.limit, warnings: loaded.warnings });
  return { ...loaded, ...payload };
}

export async function GET(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const timeframe = parseCandleTimeframe(req.nextUrl.searchParams.get("timeframe"));
  const compareSymbolRaw = (req.nextUrl.searchParams.get("compare") ?? "").trim().toUpperCase();
  const hasCompareSymbol = compareSymbolRaw.length > 0;
  const compareSymbol = hasCompareSymbol && SAFE_SYMBOL_PATTERN.test(compareSymbolRaw) ? compareSymbolRaw : null;
  const hasRangeParams = req.nextUrl.searchParams.has("from") || req.nextUrl.searchParams.has("to");
  const fromRaw = Number(req.nextUrl.searchParams.get("from") ?? "");
  const toRaw = Number(req.nextUrl.searchParams.get("to") ?? "");
  const hasValidCustomRange = Number.isFinite(fromRaw) && Number.isFinite(toRaw) && fromRaw > 0 && toRaw > fromRaw;
  const range = hasRangeParams && hasValidCustomRange ? { from: fromRaw, to: toRaw } : null;
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 30), 30000) : 120;

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }
  if (!SAFE_SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  }
  if (hasCompareSymbol && !compareSymbol) {
    return NextResponse.json({ error: "invalid compare symbol" }, { status: 400 });
  }
  if (hasRangeParams && !hasValidCustomRange) {
    return NextResponse.json({ error: "invalid candle range" }, { status: 400 });
  }

  if (compareSymbol) {
    const [primaryResult, compareResult] = await Promise.allSettled([
      loadCandlesForRoute({ symbol, timeframe, range, limit, signal: req.signal }),
      loadCandlesForRoute({ symbol: compareSymbol, timeframe, range, limit, signal: req.signal }),
    ]);
    const rejected = [primaryResult, compareResult].find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    const primary = primaryResult.status === "fulfilled" ? primaryResult.value : null;
    const compare = compareResult.status === "fulfilled" ? compareResult.value : null;

    if (!primary) {
      return NextResponse.json({ error: "No candle data found." }, { status: 404 });
    }

    return NextResponse.json({
      symbol: primary.symbol,
      timeframe,
      candles: primary.candles,
      source: primary.source ?? null,
      cacheKind: primary.cacheKind ?? null,
      metadata: primary.metadata,
      compare: compare
        ? {
            symbol: compare.symbol,
            candles: compare.candles,
            source: compare.source ?? null,
            cacheKind: compare.cacheKind ?? null,
            metadata: compare.metadata,
          }
        : null,
      compareError: compare ? null : "No comparison candle data found.",
    });
  }

  const primary = await loadCandlesForRoute({ symbol, timeframe, range, limit, signal: req.signal });
  if (!primary) {
    return NextResponse.json({ error: "No candle data found." }, { status: 404 });
  }

  return NextResponse.json({
    symbol: primary.symbol,
    timeframe,
    candles: primary.candles,
    source: primary.source ?? null,
    cacheKind: primary.cacheKind ?? null,
    metadata: primary.metadata,
  });
}
