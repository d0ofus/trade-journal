import { describe, expect, it } from "vitest";
import {
  isSameUtcMonth,
  parseUtcDateOnly,
  resolveUtcDateOnly,
  utcAddDays,
  utcAddMonths,
  utcAddYears,
  utcDateBoundary,
  utcDateKey,
  utcEndOfMonth,
  utcEndOfYear,
  utcMonthRange,
  utcStartOfDay,
  utcStartOfMonth,
  utcStartOfWeekMonday,
  utcStartOfYear,
  utcYearRange,
} from "@/lib/server/utc-date-range";

describe("UTC date helpers", () => {
  it("keeps date-only filters on their canonical UTC trade day", () => {
    expect(utcDateBoundary("2026-06-18", "start").toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(utcDateBoundary("2026-06-18", "end").toISOString()).toBe("2026-06-18T23:59:59.999Z");
    expect(parseUtcDateOnly("2026-06-18").toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });

  it.each(["2026-02-30", "2026-13-01", "2026-01-01T00:00:00Z", "18-06-2026", ""])(
    "rejects invalid date-only input %j",
    (value) => {
    expect(() => utcDateBoundary(value, "start")).toThrow(`Invalid date filter: ${value}`);
    },
  );

  it("defines UTC day, Monday week, month, and year boundaries", () => {
    const instant = new Date("2026-01-01T00:30:00.000Z");

    expect(utcStartOfDay(instant).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(utcStartOfWeekMonday(instant).toISOString()).toBe("2025-12-29T00:00:00.000Z");
    expect(utcStartOfMonth(instant).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(utcEndOfMonth(instant).toISOString()).toBe("2026-01-31T23:59:59.999Z");
    expect(utcStartOfYear(instant).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(utcEndOfYear(instant).toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });

  it("uses clamped UTC calendar arithmetic across leap days and short months", () => {
    const leapDay = parseUtcDateOnly("2024-02-29");

    expect(utcAddDays(leapDay, 1).toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(utcAddMonths(parseUtcDateOnly("2026-01-31"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(utcAddYears(leapDay, 1).toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(isSameUtcMonth(leapDay, parseUtcDateOnly("2024-02-01"))).toBe(true);
    expect(isSameUtcMonth(leapDay, parseUtcDateOnly("2024-03-01"))).toBe(false);
  });

  it.each(["UTC", "Australia/Sydney", "America/New_York"])(
    "keeps page resolution and calendar query boundaries canonical when the process timezone is %s",
    (timezone) => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = timezone;

      try {
        const date = parseUtcDateOnly("2026-01-01");
        expect(utcDateKey(date)).toBe("2026-01-01");
        expect(resolveUtcDateOnly("2026-01-01", new Date("2025-12-31T23:30:00.000Z"))).toEqual(date);
        expect(resolveUtcDateOnly(undefined, new Date("2026-01-01T00:30:00.000Z"))).toEqual(date);
        expect(utcStartOfYear(date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
        expect(utcEndOfYear(date).toISOString()).toBe("2026-12-31T23:59:59.999Z");
        expect(utcMonthRange(date)).toEqual({
          from: new Date("2026-01-01T00:00:00.000Z"),
          to: new Date("2026-01-31T23:59:59.999Z"),
        });
        expect(utcYearRange(date)).toEqual({
          from: new Date("2026-01-01T00:00:00.000Z"),
          snapshotFrom: new Date("2025-12-31T00:00:00.000Z"),
          to: new Date("2026-12-31T23:59:59.999Z"),
        });
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
      }
    },
  );
});
