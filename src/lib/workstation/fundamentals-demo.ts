import { emptyFundamentals, fundamentalsCutoff, type FundamentalQuarter, type FundamentalsMode } from "./fundamentals";
import type { Trade } from "./types";

/** Preview-only fixtures. Never imported by the application data service. */
export function demoFundamentals(trade: Trade, mode: FundamentalsMode) {
  const cutoff = mode === "before-entry" ? fundamentalsCutoff(trade) : null;
  const rows: FundamentalQuarter[] = Array.from({ length: 10 }, (_, i) => {
    const year = 2024 + Math.floor(i / 4), q = i % 4 + 1;
    const periodEnd = new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10);
    const filed = new Date(Date.UTC(year, q * 3 + 1, 5)).toISOString().slice(0, 10);
    const sources = [{ filed, accession: "0000000001-26-000001", form: q === 4 ? "10-K" : "10-Q", tag: "Revenues" }];
    return { fiscalYear: year, fiscalQuarter: q, periodEnd, revenue: { value: (220 + i * 39) * 1e6, sources, derived: false }, netIncome: { value: (-15 + i * 9) * 1e6, sources: sources.map(s => ({ ...s, tag: "NetIncomeLoss" })), derived: false }, revenueYoY: i < 4 ? null : 19.7 + i, revenueQoQ: i ? 10 + i : null, netIncomeYoY: i < 4 ? null : 50 + i * 5, netIncomeQoQ: i ? 40 - i * 2 : null };
  });
  return { ...emptyFundamentals(trade.symbol, mode, cutoff), issuer: { cik: "0000000001", name: `${trade.symbol} · illustrative preview` }, fetchedAt: "2026-09-08T00:00:00.000Z", quarters: rows.filter(q => !cutoff || q.revenue!.sources[0].filed < cutoff).slice(-8), status: "ready" as const };
}
