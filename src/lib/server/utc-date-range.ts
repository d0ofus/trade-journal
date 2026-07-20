const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;

function createUtcDate(year: number, monthIndex: number, day: number) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

export function utcDateBoundary(value: string, boundary: "start" | "end") {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid date filter: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = createUtcDate(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid date filter: ${value}`);
  }

  return boundary === "start" ? date : new Date(date.getTime() + UTC_DAY_MS - 1);
}

export function parseUtcDateOnly(value: string) {
  return utcDateBoundary(value, "start");
}

export function resolveUtcDateOnly(value: string | undefined, now = new Date()) {
  return value ? parseUtcDateOnly(value) : utcStartOfDay(now);
}

export function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function utcStartOfDay(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function utcEndOfDay(date: Date) {
  return new Date(utcStartOfDay(date).getTime() + UTC_DAY_MS - 1);
}

export function utcAddDays(date: Date, amount: number) {
  return new Date(utcStartOfDay(date).getTime() + Math.trunc(amount) * UTC_DAY_MS);
}

export function utcStartOfWeekMonday(date: Date) {
  const day = utcStartOfDay(date);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return utcAddDays(day, -mondayOffset);
}

export function utcStartOfMonth(date: Date) {
  return createUtcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function utcEndOfMonth(date: Date) {
  return new Date(createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1).getTime() - 1);
}

export function utcMonthRange(date: Date) {
  return {
    from: utcStartOfMonth(date),
    to: utcEndOfMonth(date),
  };
}

export function utcStartOfYear(date: Date) {
  return createUtcDate(date.getUTCFullYear(), 0, 1);
}

export function utcEndOfYear(date: Date) {
  return new Date(createUtcDate(date.getUTCFullYear() + 1, 0, 1).getTime() - 1);
}

export function utcYearRange(date: Date) {
  const from = utcStartOfYear(date);
  return {
    from,
    snapshotFrom: utcAddDays(from, -1),
    to: utcEndOfYear(date),
  };
}

export function utcAddMonths(date: Date, amount: number) {
  const targetMonth = createUtcDate(date.getUTCFullYear(), date.getUTCMonth() + Math.trunc(amount), 1);
  const targetDay = Math.min(date.getUTCDate(), utcEndOfMonth(targetMonth).getUTCDate());
  return createUtcDate(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), targetDay);
}

export function utcAddYears(date: Date, amount: number) {
  const targetYear = date.getUTCFullYear() + Math.trunc(amount);
  const targetMonth = date.getUTCMonth();
  const targetMonthDate = createUtcDate(targetYear, targetMonth, 1);
  const targetDay = Math.min(date.getUTCDate(), utcEndOfMonth(targetMonthDate).getUTCDate());
  return createUtcDate(targetYear, targetMonth, targetDay);
}

export function isSameUtcMonth(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();
}
