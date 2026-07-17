export const US_EQUITIES_CORE_PROFILE_ID = "US_EQUITIES_CORE_V1" as const;
export const US_EQUITIES_TIME_ZONE = "America/New_York" as const;

export type SessionAwareTimeframe = "5m" | "10m" | "15m" | "1h";
export type CandleCoverageStatus = "complete" | "partial" | "closed" | "limited" | "unverified";
export type CandleSessionPolicy = "core-required-extended-preserved" | "unknown";

export type CandleSessionProfile = {
  id: typeof US_EQUITIES_CORE_PROFILE_ID;
  timezone: typeof US_EQUITIES_TIME_ZONE;
  sessionPolicy: "core-required-extended-preserved";
};

export type CandleCoverage = {
  status: CandleCoverageStatus;
  profile: typeof US_EQUITIES_CORE_PROFILE_ID | null;
  timezone: typeof US_EQUITIES_TIME_ZONE | null;
  sessionPolicy: CandleSessionPolicy;
  expectedBars: number;
  presentBars: number;
  missingBars: number;
  missingBarTimes: number[];
  latestExpectedTime: number | null;
  scanExhausted: boolean;
};

type CalendarDate = { year: number; month: number; day: number };
type TradingSession = { open: number; close: number; earlyClose: boolean } | null;

const DAY_SECONDS = 24 * 60 * 60;
const MAX_MISSING_SAMPLES = 12;
const SPECIAL_CLOSURES = new Set(["2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14", "2012-10-29", "2012-10-30", "2018-12-05"]);

export const US_EQUITIES_CORE_PROFILE: CandleSessionProfile = {
  id: US_EQUITIES_CORE_PROFILE_ID,
  timezone: US_EQUITIES_TIME_ZONE,
  sessionPolicy: "core-required-extended-preserved",
};

const zonedDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: US_EQUITIES_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function timeframeSeconds(timeframe: SessionAwareTimeframe) {
  return timeframe === "5m" ? 5 * 60 : timeframe === "10m" ? 10 * 60 : timeframe === "15m" ? 15 * 60 : 60 * 60;
}

function dateKey(date: CalendarDate) {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

function calendarDateFromUtcDay(value: number): CalendarDate {
  const date = new Date(value);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function utcDayForCalendarDate(date: CalendarDate) {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function addCalendarDays(date: CalendarDate, days: number) {
  return calendarDateFromUtcDay(utcDayForCalendarDate(date) + days * DAY_SECONDS * 1000);
}

function dayOfWeek(date: CalendarDate) {
  return new Date(utcDayForCalendarDate(date)).getUTCDay();
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): CalendarDate {
  const first = { year, month, day: 1 };
  const day = 1 + ((weekday - dayOfWeek(first) + 7) % 7) + (occurrence - 1) * 7;
  return { year, month, day };
}

function lastWeekday(year: number, month: number, weekday: number): CalendarDate {
  const nextMonth = month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
  const last = addCalendarDays(nextMonth, -1);
  return addCalendarDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

function observedFixedHoliday(year: number, month: number, day: number) {
  const date = { year, month, day };
  const weekday = dayOfWeek(date);
  return weekday === 6 ? addCalendarDays(date, -1) : weekday === 0 ? addCalendarDays(date, 1) : date;
}

function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function standardHolidayKeys(year: number) {
  const holidays = [
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    addCalendarDays(easterSunday(year), -2),
    lastWeekday(year, 5, 1),
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25),
  ];
  if (year >= 2022) holidays.push(observedFixedHoliday(year, 6, 19));
  return holidays.map(dateKey);
}

function isStandardHoliday(date: CalendarDate) {
  const key = dateKey(date);
  for (const year of [date.year - 1, date.year, date.year + 1]) {
    if (standardHolidayKeys(year).includes(key)) return true;
  }
  return false;
}

function isEarlyClose(date: CalendarDate) {
  if (isStandardHoliday(date) || SPECIAL_CLOSURES.has(dateKey(date))) return false;
  const weekday = dayOfWeek(date);
  if (weekday === 0 || weekday === 6) return false;

  const thanksgiving = nthWeekday(date.year, 11, 4, 4);
  if (dateKey(date) === dateKey(addCalendarDays(thanksgiving, 1))) return true;
  if (date.month === 7 && date.day === 3) return true;
  return date.month === 12 && date.day === 24;
}

function zonedParts(epochMs: number) {
  const values = new Map(
    zonedDateTimeFormatter
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.get("year") ?? 0,
    month: values.get("month") ?? 0,
    day: values.get("day") ?? 0,
    hour: values.get("hour") ?? 0,
    minute: values.get("minute") ?? 0,
    second: values.get("second") ?? 0,
  };
}

function zoneOffsetMs(epochMs: number) {
  const parts = zonedParts(epochMs);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - epochMs;
}

function localDateTimeToEpoch(date: CalendarDate, hour: number, minute: number) {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  let epoch = localAsUtc - zoneOffsetMs(localAsUtc);
  epoch = localAsUtc - zoneOffsetMs(epoch);
  return Math.floor(epoch / 1000);
}

function calendarDateAt(epochSeconds: number): CalendarDate {
  const parts = zonedParts(epochSeconds * 1000);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function usEquitiesTradingSession(date: CalendarDate): TradingSession {
  const weekday = dayOfWeek(date);
  if (weekday === 0 || weekday === 6 || isStandardHoliday(date) || SPECIAL_CLOSURES.has(dateKey(date))) return null;
  const earlyClose = isEarlyClose(date);
  return {
    open: localDateTimeToEpoch(date, 9, 30),
    close: localDateTimeToEpoch(date, earlyClose ? 13 : 16, 0),
    earlyClose,
  };
}

export function expectedUsEquitiesBarStarts(input: {
  timeframe: SessionAwareTimeframe;
  from: number;
  to: number;
}) {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.to < input.from) return [];
  const interval = timeframeSeconds(input.timeframe);
  const firstDate = addCalendarDays(calendarDateAt(input.from), -1);
  const lastDate = addCalendarDays(calendarDateAt(input.to), 1);
  const starts: number[] = [];

  for (
    let cursor = firstDate;
    utcDayForCalendarDate(cursor) <= utcDayForCalendarDate(lastDate);
    cursor = addCalendarDays(cursor, 1)
  ) {
    const session = usEquitiesTradingSession(cursor);
    if (!session) continue;
    const firstStart = input.timeframe === "1h"
      ? Math.floor(session.open / interval) * interval
      : Math.ceil(session.open / interval) * interval;
    for (let time = firstStart; time < session.close; time += interval) {
      if (time >= input.from && time <= input.to) starts.push(time);
    }
  }

  return [...new Set(starts)].sort((left, right) => left - right);
}

export function unverifiedCandleCoverage(scanExhausted = false): CandleCoverage {
  return {
    status: "unverified",
    profile: null,
    timezone: null,
    sessionPolicy: "unknown",
    expectedBars: 0,
    presentBars: 0,
    missingBars: 0,
    missingBarTimes: [],
    latestExpectedTime: null,
    scanExhausted,
  };
}

export function evaluateUsEquitiesCandleCoverage(input: {
  candleTimes: number[];
  timeframe: SessionAwareTimeframe;
  from: number;
  to: number;
  limit: number;
  scanExhausted?: boolean;
}): CandleCoverage {
  const allExpected = expectedUsEquitiesBarStarts(input);
  const boundedLimit = Math.max(1, Math.floor(input.limit));
  const limited = allExpected.length > boundedLimit;
  const expected = limited ? allExpected.slice(-boundedLimit) : allExpected;
  const candleTimes = new Set(input.candleTimes.filter(Number.isFinite));
  const missing = expected.filter((time) => !candleTimes.has(time));
  const scanExhausted = Boolean(input.scanExhausted);
  const status: CandleCoverageStatus = expected.length === 0
    ? "closed"
    : missing.length > 0 || scanExhausted
      ? "partial"
      : limited
        ? "limited"
        : "complete";

  return {
    status,
    profile: US_EQUITIES_CORE_PROFILE_ID,
    timezone: US_EQUITIES_TIME_ZONE,
    sessionPolicy: US_EQUITIES_CORE_PROFILE.sessionPolicy,
    expectedBars: expected.length,
    presentBars: expected.length - missing.length,
    missingBars: missing.length,
    missingBarTimes: missing.slice(0, MAX_MISSING_SAMPLES),
    latestExpectedTime: expected.at(-1) ?? null,
    scanExhausted,
  };
}

export function isSessionAwareTimeframe(timeframe: string): timeframe is SessionAwareTimeframe {
  return timeframe === "5m" || timeframe === "10m" || timeframe === "15m" || timeframe === "1h";
}
