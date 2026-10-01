import type { FundamentalQuarter } from "./fundamentals";

export const fundamentalsBarSeries = ["revenue", "netIncome"] as const;
export const fundamentalsGrowthSeries = ["revenueYoY", "revenueQoQ", "netIncomeYoY", "netIncomeQoQ"] as const;
export const fundamentalsSeries = [...fundamentalsBarSeries, ...fundamentalsGrowthSeries] as const;
export type FundamentalsSeries = typeof fundamentalsSeries[number];
export type FundamentalsSeriesVisibility = Record<FundamentalsSeries, boolean>;
export const allFundamentalsSeries: FundamentalsSeriesVisibility = Object.freeze({ revenue: true, netIncome: true, revenueYoY: true, revenueQoQ: true, netIncomeYoY: true, netIncomeQoQ: true });

export function fundamentalSeriesValue(quarter: FundamentalQuarter, series: FundamentalsSeries) {
  return series === "revenue" || series === "netIncome" ? quarter[series]?.value : quarter[series];
}

/** Missing values never become zero. Every amount/percentage domain includes zero. */
export function fundamentalsSeriesDomain(quarters: FundamentalQuarter[], series: readonly FundamentalsSeries[]) {
  const values = quarters.flatMap(q => series.map(s => fundamentalSeriesValue(q, s))).filter((v): v is number => v != null && Number.isFinite(v));
  if (!values.length) return null;
  const min = Math.min(0, ...values), max = Math.max(0, ...values), pad = (max - min || 1) * .12;
  return { min: min < 0 ? min - pad : 0, max: max + pad };
}

export function hasVisibleFundamentals(quarters: FundamentalQuarter[], visibility: FundamentalsSeriesVisibility) {
  return quarters.some(q => fundamentalsSeries.some(s => visibility[s] && Number.isFinite(fundamentalSeriesValue(q, s))));
}
