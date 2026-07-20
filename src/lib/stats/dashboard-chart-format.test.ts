import { describe, expect, it } from "vitest";
import { formatDashboardAxisDate } from "@/lib/stats/dashboard-chart-format";

describe("formatDashboardAxisDate", () => {
  it.each(["UTC", "Australia/Sydney", "America/New_York"])(
    "formats canonical date keys and ISO instants in UTC when the process timezone is %s",
    (timezone) => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = timezone;

      try {
        expect(formatDashboardAxisDate("2026-06-22")).toBe("Jun 22");
        expect(formatDashboardAxisDate("2026-06-22T00:30:00.000Z")).toBe("Jun 22");
        expect(formatDashboardAxisDate("2026-06-22 15:00")).toBe("Jun 22");
        expect(formatDashboardAxisDate("not-a-date")).toBe("not-a-date");
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
      }
    },
  );
});
