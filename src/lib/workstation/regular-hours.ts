import { usEquitiesTradingSession } from "../server/market-session-calendar";
import type { CandleSession, Interval } from "./types";
import type { Candle } from "../server/market-candles";

export const REGULAR_HOUR_BASIS = "session-open-5m-v1";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const sessions = new Map<string, ReturnType<typeof usEquitiesTradingSession>>();
export function regularSessionAt(time: number) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(time * 1000)).map(p => [p.type, Number(p.value)]));
  const key = `${p.year}-${p.month}-${p.day}`;
  if (!sessions.has(key)) { if (sessions.size > 2000) sessions.clear(); sessions.set(key, usEquitiesTradingSession({ year: p.year, month: p.month, day: p.day })); }
  return sessions.get(key)!;
}
export function regularHourPeriod(time: number) {
  const session = regularSessionAt(time);
  if (!session || time < session.open || time >= session.close) return null;
  const start = session.open + Math.floor((time - session.open) / 3600) * 3600;
  return { start, end: Math.min(start + 3600, session.close) };
}
/** Only real, eligible five-minute bars contribute; empty intervals are never fabricated. */
export function aggregateRegularHours(candles: Candle[]): Candle[] {
  const result = new Map<number, Candle>();
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const period = regularHourPeriod(c.time); if (!period) continue;
    const previous = result.get(period.start);
    if (previous) { previous.high = Math.max(previous.high, c.high); previous.low = Math.min(previous.low, c.low); previous.close = c.close; previous.volume = (previous.volume ?? 0) + (c.volume ?? 0); }
    else result.set(period.start, { ...c, time: period.start });
  }
  return [...result.values()];
}
export const isRegularHour = (timeframe: Interval, session?: string) => timeframe === "1h" && session === "regular";
export function candleIdentity(base: string, timeframe: Interval, session?: string) {
  const identity = session ? `${base}:${session}` : base;
  return isRegularHour(timeframe, session) ? `${identity}:${REGULAR_HOUR_BASIS}` : identity;
}
export const regularHourSession: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "regular", aggregation: REGULAR_HOUR_BASIS };
