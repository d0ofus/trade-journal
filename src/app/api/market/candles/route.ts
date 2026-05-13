import { NextRequest, NextResponse } from "next/server";
import { loadCandlesForSymbol, parseCandleTimeframe, SAFE_SYMBOL_PATTERN } from "@/lib/server/market-candles";

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const timeframe = parseCandleTimeframe(req.nextUrl.searchParams.get("timeframe"));
  const compareSymbolRaw = (req.nextUrl.searchParams.get("compare") ?? "").trim().toUpperCase();
  const compareSymbol = SAFE_SYMBOL_PATTERN.test(compareSymbolRaw) ? compareSymbolRaw : null;
  const fromRaw = Number(req.nextUrl.searchParams.get("from") ?? "");
  const toRaw = Number(req.nextUrl.searchParams.get("to") ?? "");
  const hasCustomRange = Number.isFinite(fromRaw) && Number.isFinite(toRaw) && fromRaw > 0 && toRaw > fromRaw;
  const range = hasCustomRange ? { from: fromRaw, to: toRaw } : null;
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 30), 5000) : 120;

  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  if (compareSymbol) {
    const [primary, compare] = await Promise.all([
      loadCandlesForSymbol({ symbol, timeframe, range, limit }),
      loadCandlesForSymbol({ symbol: compareSymbol, timeframe, range, limit }),
    ]);

    if (!primary) {
      return NextResponse.json({ error: "No candle data found." }, { status: 404 });
    }

    return NextResponse.json({
      symbol: primary.symbol,
      timeframe,
      candles: primary.candles,
      compare: compare
        ? {
            symbol: compare.symbol,
            candles: compare.candles,
          }
        : null,
      compareError: compare ? null : "No comparison candle data found.",
    });
  }

  const primary = await loadCandlesForSymbol({ symbol, timeframe, range, limit });
  if (!primary) {
    return NextResponse.json({ error: "No candle data found." }, { status: 404 });
  }

  return NextResponse.json({ symbol: primary.symbol, timeframe, candles: primary.candles });
}
