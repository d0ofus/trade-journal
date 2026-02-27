import { NextRequest, NextResponse } from "next/server";

function parseCsvRows(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [] as Array<{ time: string; open: number; high: number; low: number; close: number }>;
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
    const row = {
      time: cols[idx.date],
      open: Number(cols[idx.open]),
      high: Number(cols[idx.high]),
      low: Number(cols[idx.low]),
      close: Number(cols[idx.close]),
    };
    if (!row.time || [row.open, row.high, row.low, row.close].some((v) => !Number.isFinite(v))) return [];
    return [row];
  });
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toLowerCase();
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "120");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 30), 1500) : 120;
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  const candidates = [symbol.includes(".") ? symbol : `${symbol}.us`, symbol];

  for (const candidate of candidates) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) continue;
    const csvText = await res.text();
    const rows = parseCsvRows(csvText);
    if (rows.length > 0) {
      return NextResponse.json({ symbol: candidate.toUpperCase(), candles: rows.slice(-limit) });
    }
  }

  return NextResponse.json({ error: "No candle data found." }, { status: 404 });
}
