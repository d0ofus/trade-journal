export const REPORTING_TIMEZONE = "America/New_York";
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: REPORTING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: REPORTING_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function reportingDate(value: Date | number) { return dateFormatter.format(value); }
export function reportingDayBoundary(date: string, end = false) {
  const target = Date.parse(`${date}T00:00:00Z`) + (end ? 86400_000 : 0);
  const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: REPORTING_TIMEZONE, timeZoneName: "longOffset" });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const offset = offsetFormatter.formatToParts(instant).find(p => p.type === "timeZoneName")!.value;
    const match = offset.match(/GMT([+-])(\d{2}):(\d{2})/)!;
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
    instant = target - minutes * 60_000;
  }
  return instant - (end ? 1 : 0);
}
export function entryTimeBucket(value: Date | number) {
  const time = timeFormatter.format(value);
  const [hour, minute] = time.split(":").map(Number);
  const weekday = new Date(`${reportingDate(value)}T12:00:00Z`).getUTCDay();
  return { weekday, slot: hour * 2 + Math.floor(minute / 30), time: `${String(hour).padStart(2, "0")}:${minute < 30 ? "00" : "30"}` };
}
export type ReportingFilters = { from?: string; to?: string; reportingTimezone?: string; entryWeekday?: string; entrySlot?: string };
export function matchesReportingCohort(trade: { openTime: number; closeTime: number; executions?: Array<{ side: string; provenance?: { timezoneStatus?: string } }>; direction?: string }, filters: ReportingFilters) {
  if (filters.reportingTimezone !== REPORTING_TIMEZONE) return true;
  const date = reportingDate(trade.closeTime * 1000);
  if (filters.from && date < filters.from || filters.to && date > filters.to) return false;
  if (filters.entryWeekday != null || filters.entrySlot != null) {
    // A carried position with no opening fill has no known entry time.
    if (trade.executions && !trade.executions.some(e => e.side === (trade.direction === "SHORT" ? "SELL" : "BUY"))) return false;
    if (trade.executions?.some(e => e.provenance?.timezoneStatus === "unverified")) return false;
    const bucket = entryTimeBucket(trade.openTime * 1000);
    if (filters.entryWeekday != null && String(bucket.weekday) !== filters.entryWeekday) return false;
    if (filters.entrySlot != null && String(bucket.slot) !== filters.entrySlot) return false;
  }
  return true;
}
