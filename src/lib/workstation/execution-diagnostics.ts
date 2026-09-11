import { priceDistanceFromCandle } from "../charts/execution-marker-alignment";
import { usEquitiesTradingSession } from "../server/market-session-calendar";
import { seconds, type Candle, type CandleSession, type Execution, type Interval } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(time: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); formatters.set(zone, formatter); }
  return Object.fromEntries(formatter.formatToParts(new Date(time * 1000)).map(p => [p.type, Number(p.value)]));
}
function localMidnight(utcDate: number, zone: string) {
  let time = utcDate / 1000;
  for (let i = 0; i < 3; i++) { const p = parts(time, zone); time += (utcDate - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)) / 1000; }
  return time;
}
export function candlePeriod(time: number, interval: Interval, session?: CandleSession) {
  const coarse = interval === "1d" || interval === "1wk";
  if (!coarse) {
    let end = time + seconds[interval];
    if (session?.marketHours === "regular" && session.timezone === "America/New_York") { const p = parts(time, session.timezone), market = usEquitiesTradingSession({ year: p.year, month: p.month, day: p.day }); if (market) end = Math.min(end, market.close); }
    return { start: time, end, verified: true };
  }
  const zone = session?.timezone ?? "UTC", p = parts(time, zone);
  let day = Date.UTC(p.year, p.month - 1, p.day);
  if (interval === "1wk") day -= ((new Date(day).getUTCDay() + 6) % 7) * 86400000;
  return { start: localMidnight(day, zone), end: localMidnight(day + seconds[interval] * 1000, zone), verified: !!session && session.calendar !== "unknown" && !!session.timezone };
}
export function containingExecutionCandle(time: number, candles: Candle[], interval: Interval, session?: CandleSession): Candle | undefined {
  // Coarse provider timestamps may denote the session open, not midnight.
  if (interval === "1d" || interval === "1wk") {
    let lo = 0, hi = candles.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1, period = candlePeriod(candles[mid].time, interval, session); if (time < period.start) hi = mid - 1; else if (time >= period.end) lo = mid + 1; else return candles[mid]; }
    return undefined;
  }
  let lo = 0, hi = candles.length - 1, index = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].time <= time) { index = mid; lo = mid + 1; } else hi = mid - 1; }
  const bar = candles[index];
  if (!bar || time >= Math.min(bar.time + seconds[interval], candles[index + 1]?.time ?? Infinity)) return undefined;
  if (session?.marketHours === "regular" && session.timezone === "America/New_York") {
    const p = parts(time, session.timezone), market = usEquitiesTradingSession({ year: p.year, month: p.month, day: p.day });
    if (!market || time < market.open || time >= market.close) return undefined;
  }
  return bar;
}
export type ExecutionDiagnostic = { execution: Execution; candle?: Candle; period?: ReturnType<typeof candlePeriod>; status: "matching" | "price-outside" | "missing"; distance: number; timezoneUnverified: boolean; periodUnverified: boolean };
export function diagnoseExecution(execution: Execution, candles: Candle[], interval: Interval, session?: CandleSession): ExecutionDiagnostic {
  const candle = containingExecutionCandle(execution.time, candles, interval, session), period = candle && candlePeriod(candle.time, interval, session);
  if (period && candle && interval !== "1d" && interval !== "1wk") { let lo = 0, hi = candles.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (candles[mid].time <= candle.time) lo = mid + 1; else hi = mid; } if (candles[lo]) period.end = Math.min(period.end, candles[lo].time); }
  const distance = candle ? priceDistanceFromCandle(execution.price, candle) : 0;
  return { execution, candle, period, status: !candle ? "missing" : distance ? "price-outside" : "matching", distance, timezoneUnverified: execution.provenance?.timezoneStatus !== "verified", periodUnverified: !!period && !period.verified };
}
export function executionDiagnosticSummary(rows: ExecutionDiagnostic[]) {
  if (!rows.length) return "No executions at this replay time";
  const missing = rows.filter(r => r.status === "missing").length, outside = rows.filter(r => r.status === "price-outside").length, unknown = rows.some(r => r.timezoneUnverified), period = rows.some(r => r.periodUnverified);
  return [`${rows.length} executions`, missing ? `${missing} missing candle` : "", outside ? `${outside} price outside candle` : "", !missing && !outside ? "time buckets / prices match" : "", unknown ? "source timezone unverified" : "", period ? "candle date convention unverified" : ""].filter(Boolean).join(" · ");
}
export const executionDiagnosticLabel = (row: ExecutionDiagnostic) => row.status === "price-outside" ? "Price outside candle" : row.status === "missing" ? "No matching candle" : row.periodUnverified ? "Candle date convention unverified" : "Matching time bucket and price";
