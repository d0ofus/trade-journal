import { usEquitiesTradingSession } from "../server/market-session-calendar";
import type { Candle } from "./types";

export type MetricValue = { value: number | null; reason?: string };
export type MarketMetrics = { symbol: string; asOf: string | null; currency: string; provider: string; adr: MetricValue; atr: MetricValue; dollarVolume: MetricValue; marketCap: MetricValue; atrSessions: number; sharesDate?: string; sharesSource?: string; sharesFiled?: string };
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export function exchangeDate(time: number) { const p = Object.fromEntries(dateFormatter.formatToParts(new Date(time * 1000)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; }
export function sessionForDate(date: string) { const [year, month, day] = date.split("-").map(Number); return usEquitiesTradingSession({ year, month, day }); }
export function previousSession(date: string) {
  for (let time = Date.parse(`${date}T12:00:00Z`) - 86400000, i = 0; i < 14; i++, time -= 86400000) { const day = new Date(time).toISOString().slice(0, 10), session = sessionForDate(day); if (session) return { date: day, ...session }; }
  return null;
}
export const unavailableMetrics = (symbol: string, currency: string, reason: string, asOf: string | null = null): MarketMetrics => ({ symbol, currency, asOf, provider: "Unavailable", adr: { value: null, reason }, atr: { value: null, reason }, dollarVolume: { value: null, reason }, marketCap: { value: null, reason }, atrSessions: 0 });

export function calculateMarketMetrics(symbol: string, currency: string, asOf: string, candles: Candle[], provider: string): MarketMetrics {
  const result = unavailableMetrics(symbol, currency, "Insufficient completed history", asOf); result.provider = provider;
  const byDay = new Map(candles.filter(c => exchangeDate(c.time) <= asOf && sessionForDate(exchangeDate(c.time)) && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.close > 0 && c.low > 0 && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.volume >= 0).map(c => [exchangeDate(c.time), c]));
  const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-250);
  if (!rows.length || rows.at(-1)![0] !== asOf) return { ...result, adr: { value: null, reason: "Reference session missing" }, atr: { value: null, reason: "Reference session missing" }, dollarVolume: { value: null, reason: "Reference session missing" } };
  const consecutive = (count: number) => { let day = asOf; for (let i = 0; i < count; i++) { if (!byDay.has(day)) return false; const prior = previousSession(day); if (!prior && i < count - 1) return false; day = prior?.date ?? ""; } return true; };
  const close = rows.at(-1)![1].close;
  if (rows.length >= 14 && consecutive(14)) result.adr = { value: rows.slice(-14).reduce((sum, [, c]) => sum + c.high - c.low, 0) / 14 / close * 100 };
  if (rows.length >= 20 && consecutive(20)) result.dollarVolume = { value: rows.slice(-20).reduce((sum, [, c]) => sum + c.close * c.volume, 0) / 20 };
  if (rows.length >= 14 && consecutive(rows.length)) {
    const ranges = rows.map(([, c], i) => i ? Math.max(c.high - c.low, Math.abs(c.high - rows[i - 1][1].close), Math.abs(c.low - rows[i - 1][1].close)) : c.high - c.low);
    let atr = ranges.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    for (const range of ranges.slice(14)) atr = (atr * 13 + range) / 14;
    result.atr = { value: atr / close * 100 }; result.atrSessions = rows.length;
  }
  result.marketCap = { value: null, reason: "Historical shares unavailable" };
  return result;
}

export function formatMetric(value: MetricValue, kind: "percent" | "money", currency: string) {
  if (value.value === null) return "Unavailable";
  if (kind === "percent") return `${value.value.toFixed(2)}%`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value.value); }
  catch { return `${value.value.toFixed(2)} ${currency}`; }
}
export const metricEntries = (m: MarketMetrics) => [
  ["ADR% · 14", formatMetric(m.adr, "percent", m.currency)], ["ATR% · 14", formatMetric(m.atr, "percent", m.currency)], ["Avg dollar volume · 20", formatMetric(m.dollarVolume, "money", m.currency)], ["Market cap · estimated", formatMetric(m.marketCap, "money", m.currency)],
];
