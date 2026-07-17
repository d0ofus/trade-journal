import { describe, expect, it } from "vitest";
import { utcDateBoundary } from "@/lib/server/utc-date-range";

describe("utcDateBoundary", () => {
  it("keeps date-only filters on their canonical UTC trade day", () => {
    expect(utcDateBoundary("2026-06-18", "start").toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(utcDateBoundary("2026-06-18", "end").toISOString()).toBe("2026-06-18T23:59:59.999Z");
  });

  it.each(["2026-02-30", "2026-13-01", "18-06-2026", ""])("rejects invalid date-only input %j", (value) => {
    expect(() => utcDateBoundary(value, "start")).toThrow(`Invalid date filter: ${value}`);
  });
});
