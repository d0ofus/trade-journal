import { describe, expect, it } from "vitest";
import { resolveDashboardRange } from "@/lib/server/dashboard-date-range";

describe("resolveDashboardRange", () => {
  it.each(["UTC", "Australia/Sydney", "America/New_York"])(
    "resolves UTC presets identically when the process timezone is %s",
    (timezone) => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = timezone;

      try {
        const nearNewYear = new Date("2026-01-01T00:30:00.000Z");
        expect(resolveDashboardRange({ preset: "ytd" }, nearNewYear)).toMatchObject({
          preset: "ytd",
          from: "2026-01-01",
          to: "2026-01-01",
        });

        const monthEnd = new Date("2026-03-31T23:30:00.000Z");
        expect(resolveDashboardRange({ preset: "3m" }, monthEnd)).toMatchObject({
          from: "2025-12-31",
          to: "2026-03-31",
        });
        expect(resolveDashboardRange({ preset: "6m" }, monthEnd)).toMatchObject({
          from: "2025-09-30",
          to: "2026-03-31",
        });
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
      }
    },
  );

  it("accepts only real UTC date-only custom bounds", () => {
    expect(resolveDashboardRange({ from: "2026-06-18", to: "2026-06-22" })).toMatchObject({
      preset: "custom",
      from: "2026-06-18",
      to: "2026-06-22",
    });
    expect(resolveDashboardRange({ preset: "custom", from: "2026-02-30", to: "2026-06-22T00:00:00Z" })).toMatchObject({
      preset: "custom",
      from: undefined,
      to: undefined,
    });
  });
});
