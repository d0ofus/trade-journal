import { NextRequest, NextResponse } from "next/server";

function apiBase() {
  return process.env.MARKET_OVERVIEW_API_BASE?.replace(/\/+$/, "") ?? "";
}

async function fetchMarketOverview(path: string) {
  const base = apiBase();
  if (!base) return { ok: false, error: "MARKET_OVERVIEW_API_BASE is not configured.", data: null };
  const headers: HeadersInit = {};
  if (process.env.MARKET_OVERVIEW_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MARKET_OVERVIEW_API_TOKEN}`;
  }
  const res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
  if (!res.ok) {
    return { ok: false, error: `Market overview request failed (${res.status}).`, data: null };
  }
  return { ok: true, error: null, data: await res.json() };
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const [detail, metrics] = await Promise.all([
    fetchMarketOverview(`/api/peer-groups/ticker/${encodeURIComponent(symbol)}`),
    fetchMarketOverview(`/api/peer-groups/ticker/${encodeURIComponent(symbol)}/metrics`),
  ]);

  const webBase = process.env.MARKET_OVERVIEW_WEB_BASE?.replace(/\/+$/, "") ?? "https://market-overview-nu.vercel.app";
  return NextResponse.json({
    symbol,
    peerGroupsUrl: `${webBase}/peer-groups`,
    detail: detail.data,
    metrics: metrics.data,
    errors: [detail.error, metrics.error].filter(Boolean),
  });
}
