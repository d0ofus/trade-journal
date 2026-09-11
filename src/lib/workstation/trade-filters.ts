import { format, subDays, subMonths, subWeeks, subYears } from "date-fns";

export type WorkstationTradeFilters = {
  from?: string; to?: string; symbol?: string; direction?: string; account?: string;
  tag?: string; strategy?: string; includeStale?: boolean;
};
export type TradeFilterControls = {
  applied: WorkstationTradeFilters;
  apply(filters: WorkstationTradeFilters, selectedId: string): void;
  pending?: boolean;
};
export const tradeFilterKeys = ["from", "to", "symbol", "direction", "account", "tag", "strategy"] as const;
export function normalizeWorkstationFilters(input: Record<string, unknown>): WorkstationTradeFilters {
  const result: WorkstationTradeFilters = {};
  for (const key of tradeFilterKeys) {
    const raw = key === "direction" ? input.direction ?? input.side : input[key];
    if (typeof raw === "string" && raw.trim()) result[key] = raw.trim();
  }
  if (result.symbol) result.symbol = result.symbol.toUpperCase();
  if (result.tag) result.tag = result.tag.replace(/^#+/, "").toLowerCase();
  if (result.direction) {
    const direction = result.direction.toUpperCase();
    result.direction = direction === "BUY" ? "LONG" : direction === "SELL" ? "SHORT" : direction;
  }
  if ([true, "1", "true", "on"].includes(input.includeStale as string | boolean)) result.includeStale = true;
  return result;
}
export function tradeFilterError(filters: WorkstationTradeFilters): string {
  for (const [label, value] of [["From", filters.from], ["To", filters.to]]) {
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return `${label} must be a valid date.`;
  }
  if (filters.from && filters.to && filters.from > filters.to) return "From must be on or before To.";
  if (filters.direction && !["LONG", "SHORT"].includes(filters.direction)) return "Choose a valid direction.";
  return "";
}
export const quickTradeRanges = ["5D", "2W", "1M", "1Y"] as const;
export function quickTradeRange(range: typeof quickTradeRanges[number], now = new Date()): WorkstationTradeFilters {
  const from = range === "5D" ? subDays(now, 4) : range === "2W" ? subWeeks(now, 2) : range === "1M" ? subMonths(now, 1) : subYears(now, 1);
  return { from: format(from, "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
}
export function filterDateSummary(filters: WorkstationTradeFilters) {
  if (filters.from && filters.to) return `${filters.from} – ${filters.to}`;
  if (filters.from) return `From ${filters.from}`;
  if (filters.to) return `Through ${filters.to}`;
  return "All time";
}
export function tradeFilterCount(filters: WorkstationTradeFilters) {
  return Number(!!(filters.from || filters.to)) + [filters.symbol, filters.direction, filters.account, filters.tag, filters.strategy, filters.includeStale].filter(Boolean).length;
}
export function tradeFilterHref(pathname: string, filters: WorkstationTradeFilters, selectedId: string) {
  const params = new URLSearchParams();
  for (const key of tradeFilterKeys) if (filters[key]) params.set(key, filters[key]!);
  if (filters.includeStale) params.set("includeStale", "1");
  if (selectedId) params.set("groupKey", selectedId);
  return params.size ? `${pathname}?${params}` : pathname;
}
