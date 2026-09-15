import { describe, expect, it } from "vitest";
import { executionTimeDisplay } from "./execution-time-display";
import type { Execution } from "./types";
const execution = (iso: string, provenance: Execution["provenance"]): Execution => ({ id: "fill", time: Date.parse(iso) / 1000, side: "BUY", quantity: 333, price: 9.26, commission: 0, fees: 0, provenance });
const confirmed: Execution["provenance"] = { timezoneStatus: "user-confirmed", timezone: "America/New_York", source: "Stored execution", interpretationStatus: "applied", storedTime: Date.parse("2026-01-07T09:30:01Z") / 1000 };
describe("execution time presentation", () => {
  it("formats the screenshot's already corrected timestamp exactly once", () => {
    const row = execution("2026-01-07T14:30:01Z", confirmed), before = structuredClone(row);
    expect(executionTimeDisplay(row)).toEqual({ label: "Execution time", time: "Jan 07, 2026, 09:30:01 EST", utc: "2026-01-07 14:30:01 UTC" });
    expect(row).toEqual(before);
  });
  it("uses EDT in summer", () => {
    expect(executionTimeDisplay(execution("2026-07-07T13:30:01Z", confirmed)).time).toBe("Jul 07, 2026, 09:30:01 EDT");
  });
  it("preserves authoritative explicit offsets", () => {
    const row = execution("2026-01-07T14:30:01Z", { ...confirmed!, timezone: "Explicit offset", brokerWallTime: "2026-01-07T09:30:01-05:00" });
    expect(executionTimeDisplay(row).time).toBe("2026-01-07T09:30:01-05:00");
  });
  it.each(["pending", "stale", "unresolved"] as const)("never infers Eastern time for a %s interpretation", status => {
    expect(executionTimeDisplay(execution("2026-01-07T09:30:01Z", { ...confirmed!, interpretationStatus: status }))).toEqual({ label: "Stored time (timezone unresolved)", time: "2026-01-07 09:30:01 UTC", utc: null });
  });
  it("handles missing provenance and verified UTC", () => {
    expect(executionTimeDisplay(execution("2026-01-07T09:30:01Z", undefined)).label).toContain("unresolved");
    expect(executionTimeDisplay(execution("2026-01-07T09:30:01Z", { ...confirmed!, timezone: "UTC", timezoneStatus: "verified" }))).toEqual({ label: "Execution time", time: "2026-01-07 09:30:01 UTC", utc: null });
  });
});
