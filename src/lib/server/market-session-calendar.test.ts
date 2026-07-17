import { describe, expect, it } from "vitest";
import {
  evaluateUsEquitiesCandleCoverage,
  expectedUsEquitiesBarStarts,
  usEquitiesTradingSession,
} from "@/lib/server/market-session-calendar";

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("US_EQUITIES_CORE_V1", () => {
  it("skips overnight and weekend closures across the spring DST boundary", () => {
    const starts = expectedUsEquitiesBarStarts({
      timeframe: "15m",
      from: seconds("2026-03-06T20:45:00.000Z"),
      to: seconds("2026-03-09T13:30:00.000Z"),
    });

    expect(starts).toEqual([
      seconds("2026-03-06T20:45:00.000Z"),
      seconds("2026-03-09T13:30:00.000Z"),
    ]);
  });

  it("moves core UTC hours deterministically when New York leaves DST", () => {
    const before = usEquitiesTradingSession({ year: 2026, month: 10, day: 30 });
    const after = usEquitiesTradingSession({ year: 2026, month: 11, day: 2 });

    expect(before).toMatchObject({
      open: seconds("2026-10-30T13:30:00.000Z"),
      close: seconds("2026-10-30T20:00:00.000Z"),
    });
    expect(after).toMatchObject({
      open: seconds("2026-11-02T14:30:00.000Z"),
      close: seconds("2026-11-02T21:00:00.000Z"),
    });
  });

  it("treats a full holiday as a valid closure", () => {
    expect(usEquitiesTradingSession({ year: 2026, month: 11, day: 26 })).toBeNull();

    const coverage = evaluateUsEquitiesCandleCoverage({
      candleTimes: [],
      timeframe: "15m",
      from: seconds("2026-11-26T00:00:00.000Z"),
      to: seconds("2026-11-26T23:59:59.000Z"),
      limit: 120,
    });
    expect(coverage).toMatchObject({ status: "closed", expectedBars: 0, missingBars: 0 });
  });

  it("ends the post-Thanksgiving early-close session at 13:00 New York time", () => {
    const starts = expectedUsEquitiesBarStarts({
      timeframe: "15m",
      from: seconds("2026-11-27T00:00:00.000Z"),
      to: seconds("2026-11-27T23:59:59.000Z"),
    });

    expect(starts).toHaveLength(14);
    expect(starts[0]).toBe(seconds("2026-11-27T14:30:00.000Z"));
    expect(starts.at(-1)).toBe(seconds("2026-11-27T17:45:00.000Z"));
    expect(starts).not.toContain(seconds("2026-11-27T18:00:00.000Z"));
  });

  it("detects a genuine interior gap even when both session endpoints exist", () => {
    const from = seconds("2026-06-17T13:30:00.000Z");
    const to = seconds("2026-06-17T19:45:00.000Z");
    const expected = expectedUsEquitiesBarStarts({ timeframe: "15m", from, to });
    const missing = seconds("2026-06-17T16:00:00.000Z");
    const coverage = evaluateUsEquitiesCandleCoverage({
      candleTimes: expected.filter((time) => time !== missing),
      timeframe: "15m",
      from,
      to,
      limit: 120,
    });

    expect(coverage).toMatchObject({
      status: "partial",
      expectedBars: 26,
      presentBars: 25,
      missingBars: 1,
      missingBarTimes: [missing],
    });
  });

  it("allows extended-hours bars without requiring them for core completeness", () => {
    const from = seconds("2026-06-17T12:00:00.000Z");
    const to = seconds("2026-06-17T20:30:00.000Z");
    const expected = expectedUsEquitiesBarStarts({ timeframe: "15m", from, to });
    const extended = [seconds("2026-06-17T12:00:00.000Z"), seconds("2026-06-17T20:15:00.000Z")];
    const coverage = evaluateUsEquitiesCandleCoverage({
      candleTimes: [...extended, ...expected],
      timeframe: "15m",
      from,
      to,
      limit: 120,
    });

    expect(coverage).toMatchObject({ status: "complete", expectedBars: 26, presentBars: 26 });
  });

  it("reports bounded scan exhaustion instead of false completeness", () => {
    const from = seconds("2026-06-17T13:30:00.000Z");
    const to = seconds("2026-06-17T19:45:00.000Z");
    const expected = expectedUsEquitiesBarStarts({ timeframe: "15m", from, to });
    const coverage = evaluateUsEquitiesCandleCoverage({
      candleTimes: expected,
      timeframe: "15m",
      from,
      to,
      limit: 120,
      scanExhausted: true,
    });

    expect(coverage).toMatchObject({ status: "partial", missingBars: 0, scanExhausted: true });
  });
});
