import { prisma } from "@/lib/prisma";
import type { CandleSession } from "@/lib/workstation/types";
import type { WorkstationCandles } from "./workstation-candles";

/** Chart metadata only. No changes to the ingestion loader or candle values. */
export async function workstationCandleSession(loaded: WorkstationCandles): Promise<CandleSession> {
  const unknown: CandleSession = { timezone: null, calendar: "unknown", marketHours: "unknown" };
  let usEquity = loaded.coverage?.timezone === "America/New_York";
  if (!usEquity) {
    const instruments = await prisma.instrument.findMany({ where: { symbol: loaded.symbol }, select: { assetType: true, currency: true, exchange: true }, take: 25 });
    usEquity = instruments.length > 0 && instruments.every(i => ["STOCK", "ETF"].includes(i.assetType) && i.currency === "USD" && ["SMART", "NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM", "NYSE", "NYSEARCA", "AMEX", "ARCA", "ISLAND", "BATS", "IEX", "CBOE"].includes((i.exchange ?? "").toUpperCase()));
  }
  // Stooq daily timestamps are UTC date labels, unlike Yahoo's session-open timestamps.
  if (loaded.source === "stooq") return { timezone: "UTC", calendar: "utc", marketHours: "unknown" };
  return usEquity ? { timezone: "America/New_York", calendar: "exchange", marketHours: loaded.source === "yahoo" ? "regular" : "unknown" } : unknown;
}
