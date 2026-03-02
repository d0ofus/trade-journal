import { NextRequest, NextResponse } from "next/server";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type CandleTimeframe = "5m" | "1h" | "1d";

const TIMEFRAME_CONFIG: Record<CandleTimeframe, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "1d": { interval: "1d", range: "10y" },
};

function parseCsvRows(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [] as Candle[];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    date: headers.indexOf("date"),
    open: headers.indexOf("open"),
    high: headers.indexOf("high"),
    low: headers.indexOf("low"),
    close: headers.indexOf("close"),
  };

  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",");
    const rawTime = cols[idx.date];
    const ts = rawTime ? Date.parse(`${rawTime}T00:00:00.000Z`) : Number.NaN;
    const row = {
      time: Number.isFinite(ts) ? Math.floor(ts / 1000) : Number.NaN,
      open: Number(cols[idx.open]),
      high: Number(cols[idx.high]),
      low: Number(cols[idx.low]),
      close: Number(cols[idx.close]),
    };
    if (!row.time || [row.open, row.high, row.low, row.close].some((v) => !Number.isFinite(v))) return [];
    return [row];
  });
}

function parseYahooRows(payload: unknown) {
  const result = (payload as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> } }> } })?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) return [] as Candle[];

  const open = quote.open ?? [];
  const high = quote.high ?? [];
  const low = quote.low ?? [];
  const close = quote.close ?? [];
  const size = Math.min(timestamps.length, open.length, high.length, low.length, close.length);

  const rows: Candle[] = [];
  for (let i = 0; i < size; i += 1) {
    const row = {
      time: timestamps[i],
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
    };
    if (
      Number.isFinite(row.time) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close)
    ) {
      rows.push({
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
      });
    }
  }

  return rows;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const timeframeRaw = (req.nextUrl.searchParams.get("timeframe") ?? "1d").trim().toLowerCase();
  const timeframe: CandleTimeframe = timeframeRaw === "5m" || timeframeRaw === "1h" || timeframeRaw === "1d" ? timeframeRaw : "1d";
  const config = TIMEFRAME_CONFIG[timeframe];
  const fromRaw = Number(req.nextUrl.searchParams.get("from") ?? "");
  const toRaw = Number(req.nextUrl.searchParams.get("to") ?? "");
  const hasCustomRange = Number.isFinite(fromRaw) && Number.isFinite(toRaw) && fromRaw > 0 && toRaw > fromRaw;
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 30), 5000) : 120;
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  yahooUrl.searchParams.set("interval", config.interval);
  if (hasCustomRange) {
    yahooUrl.searchParams.set("period1", String(Math.floor(fromRaw)));
    yahooUrl.searchParams.set("period2", String(Math.ceil(toRaw)));
  } else {
    yahooUrl.searchParams.set("range", config.range);
  }
  yahooUrl.searchParams.set("includePrePost", "false");
  yahooUrl.searchParams.set("events", "div,splits");

  const yahooRes = await fetch(yahooUrl.toString(), { cache: "no-store" });
  if (yahooRes.ok) {
    const payload = await yahooRes.json();
    const rows = parseYahooRows(payload);
    if (rows.length > 0) {
      return NextResponse.json({ symbol, timeframe, candles: rows.slice(-limit) });
    }
  }

  if (timeframe === "1d") {
    const candidates = [symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`, symbol.toLowerCase()];

    for (const candidate of candidates) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const csvText = await res.text();
      const rows = parseCsvRows(csvText);
      if (rows.length > 0) {
        return NextResponse.json({ symbol: candidate.toUpperCase(), timeframe, candles: rows.slice(-limit) });
      }
    }
  }

  return NextResponse.json({ error: "No candle data found." }, { status: 404 });
}
