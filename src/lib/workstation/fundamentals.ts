import { firstExecution } from "./before-entry";
import { executionTimeResolved } from "./execution-time-provenance";
import type { Trade } from "./types";

export type FundamentalsMode = "before-entry" | "latest";
export type AccountingStandard = "us-gaap" | "ifrs-full";
export type FundamentalSource = { filed: string; accession: string; form: string; tag: string; taxonomy?: string; kind?: "companyfacts" | "xbrl" | "statement"; document?: string; label?: string };
export type FundamentalMetric = { value: number; sources: FundamentalSource[]; derived: boolean; currency?: string; accountingStandard?: AccountingStandard; incomeBasis?: "owners" | "consolidated" };
export type FundamentalQuarter = {
  fiscalYear: number; fiscalQuarter: number; periodEnd: string;
  revenue: FundamentalMetric | null; netIncome: FundamentalMetric | null;
  revenueYoY: number | null; revenueQoQ: number | null; netIncomeYoY: number | null; netIncomeQoQ: number | null;
};
export type FundamentalsSnapshot = {
  symbol: string; mode: FundamentalsMode; cutoff: string | null;
  issuer: { cik: string; name: string } | null; quarters: FundamentalQuarter[];
  currency?: string;
  coverage?: "complete" | "partial" | "no-quarterly-data" | "unsupported-format";
  status: "ready" | "empty" | "unresolved-date" | "unknown-ticker" | "unsupported" | "unavailable";
  fetchedAt: string | null; stale: boolean; message: string | null; retryable: boolean;
};
export type FundamentalsCapture = Pick<FundamentalsSnapshot, "symbol" | "mode" | "cutoff" | "issuer" | "quarters" | "fetchedAt" | "stale" | "currency" | "coverage"> & { capturedAt: string; seriesVisibility?: import("./fundamentals-series").FundamentalsSeriesVisibility };
export function fundamentalsCutoff(trade: Trade): string | null {
  const first = firstExecution(trade);
  if (!first || !executionTimeResolved(first) || ["pending", "stale", "unresolved"].includes(first.provenance?.interpretationStatus ?? "")) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.time * 1000));
}
export function emptyFundamentals(symbol: string, mode: FundamentalsMode, cutoff: string | null): FundamentalsSnapshot {
  return { symbol, mode, cutoff, issuer: null, quarters: [], status: "empty", fetchedAt: null, stale: false, message: null, retryable: false };
}
export function fundamentalPeriod(q: FundamentalQuarter) { return `FY${String(q.fiscalYear).slice(-2)} Q${q.fiscalQuarter}`; }
export function fundamentalMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
}
export function fundamentalPercent(value: number | null | undefined) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
export function fundamentalSources(q: FundamentalQuarter) {
  return [...new Map([...(q.revenue?.sources ?? []), ...(q.netIncome?.sources ?? [])].map(s => [`${s.accession}:${s.document ?? ""}:${s.tag}`, s])).values()];
}
