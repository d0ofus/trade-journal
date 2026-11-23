import type { TickMarkType, Time } from "lightweight-charts";
import type { CandleSession, Interval } from "./types";

export type ChartTimezoneMode = "exchange" | "system" | "utc";
export type ChartTimezone = { mode: ChartTimezoneMode; zone: string; label: string; fallback: boolean };
export type ChartTimezoneCapture = { mode: ChartTimezoneMode; zones: Record<string, string>; fallbacks?: string[] };
const formats = new Map<string, Intl.DateTimeFormat>();
const zones = new Map<string, boolean>();
export const restoreChartTimezone = (value: unknown): ChartTimezoneMode => value === "system" || value === "utc" ? value : "exchange";
export function validTimezone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone || zone.length > 100) return false;
  if (!zones.has(zone)) {
    if (zones.size >= 64) zones.clear();
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); zones.set(zone, true); } catch { zones.set(zone, false); }
  }
  return zones.get(zone)!;
}
export function resolveChartTimezone(mode: ChartTimezoneMode, session?: Pick<CandleSession, "timezone" | "calendar">, system?: string): ChartTimezone {
  if (mode === "utc") return { mode, zone: "UTC", label: "UTC", fallback: false };
  const zone = mode === "system" ? system : session?.calendar === "exchange" ? session.timezone : undefined;
  const fallback = !validTimezone(zone), resolved = fallback ? "UTC" : zone;
  return { mode, zone: resolved, label: `${mode === "system" ? "System" : "Exchange"} · ${fallback ? "unavailable — UTC" : resolved}`, fallback };
}
function formatter(zone: string, style: string, options: Intl.DateTimeFormatOptions) {
  const key = `${zone}:${style}`;
  if (!formats.has(key)) {
    if (formats.size >= 64) formats.clear();
    formats.set(key, new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", ...options }));
  }
  return formats.get(key)!;
}
function parts(time: number, zone: string) {
  const p = Object.fromEntries(formatter(zone, "parts", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(time * 1000).map(p => [p.type, p.value]));
  return [p.year, p.month, p.day, p.hour, p.minute, p.second];
}
export const timezoneInputValue = (time: number, timezone: ChartTimezone) => {
  const [y, m, d, h, min, s] = parts(time, timezone.zone);
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
};
export function chartTimestamp(time: number, timezone: ChartTimezone, seconds = true) {
  const value = timezoneInputValue(time, timezone).replace("T", " ");
  const offset = formatter(timezone.zone, "offset", { timeZoneName: "shortOffset" }).formatToParts(time * 1000).find(p => p.type === "timeZoneName")?.value ?? timezone.zone;
  return `${seconds ? value : value.slice(0, 16)} ${timezone.zone === "UTC" ? "UTC" : `${timezone.zone} (${offset})`}`;
}
export function chartClock(time: number, timezone: ChartTimezone) {
  return formatter(timezone.zone, "clock", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset" }).format(time * 1000);
}
export function parseTimezoneInput(value: string, timezone: ChartTimezone): { time: number; error?: never } | { error: string; time?: never } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return { error: "Enter a complete date and time." };
  const p = match.slice(1).map(v => Number(v ?? 0)), wall = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) / 1000;
  if (p[0] < 1900 || p[0] > 2200 || parts(wall, "UTC").some((v, i) => Number(v) !== p[i])) return { error: "Enter a valid date and time." };
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) {
    const t = wall + h * 3600, a = parts(t, timezone.zone).map(Number);
    offsets.add(Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4], a[5]) / 1000 - t);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(t => parts(t, timezone.zone).every((v, i) => Number(v) === p[i]));
  return candidates.length === 1 ? { time: candidates[0] } : { error: candidates.length ? "This local time occurs twice during daylight saving. Select UTC to enter an exact time." : "This local time does not exist during daylight saving. Choose another time or select UTC." };
}
function instant(time: Time) {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Date.parse(`${time}T00:00:00Z`) / 1000;
  return Date.UTC(time.year, time.month - 1, time.day) / 1000;
}
/** Calendar bars keep their trading dates; intraday bars remain absolute instants. */
function calendarZone(time: Time, interval: Interval, session: CandleSession | undefined, timezone: ChartTimezone) {
  if (typeof time !== "number") return "UTC";
  return interval === "1d" || interval === "1wk" ? session?.calendar === "exchange" && validTimezone(session.timezone) ? session.timezone : "UTC" : timezone.zone;
}
export function chartTimeFormatters(timezone: ChartTimezone, interval: Interval, session?: CandleSession) {
  return {
    localization: { timeFormatter: (time: Time) => {
      const t = instant(time), coarse = interval === "1d" || interval === "1wk" || typeof time !== "number";
      return coarse ? parts(t, calendarZone(time, interval, session, timezone)).slice(0, 3).join("-") : timezoneInputValue(t, timezone).replace("T", " ");
    } },
    timeScale: { tickMarkFormatter: (time: Time, type: TickMarkType) => {
      const zone = calendarZone(time, interval, session, timezone);
      const options: Intl.DateTimeFormatOptions = type === 0 ? { year: "numeric" } : type === 1 ? { month: "short" } : type === 2 ? { day: "numeric" } : type === 4 ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" };
      return formatter(zone, `tick:${type}`, options).format(instant(time) * 1000);
    } },
  };
}
export function timezoneCapture(timezones: Record<string, ChartTimezone>): ChartTimezoneCapture {
  const entries = Object.entries(timezones);
  return { mode: entries[0]?.[1].mode ?? "utc", zones: Object.fromEntries(entries.map(([id, value]) => [id, value.zone])), ...(entries.some(([, v]) => v.fallback) ? { fallbacks: entries.filter(([, v]) => v.fallback).map(([id]) => id) } : {}) };
}
