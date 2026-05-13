import { describe, expect, it } from "vitest";
import { calculateJournalOutcomeFromCandles } from "@/lib/journal/outcome";
import type { Candle } from "@/lib/server/market-candles";

const day = (offset: number) => Math.floor(Date.parse(`2026-01-${String(1 + offset).padStart(2, "0")}T00:00:00.000Z`) / 1000);

function candle(offset: number, low: number, high: number): Candle {
  return { time: day(offset), open: low, high, low, close: high, volume: 100 };
}

describe("journal outcome calculation", () => {
  it("marks a long idea as worked without me when target R is reached", () => {
    const result = calculateJournalOutcomeFromCandles(
      {
        symbol: "NVDA",
        direction: "LONG",
        timeframe: "1D",
        ideaDate: "2026-01-01T00:00:00.000Z",
        plannedEntry: 100,
        plannedStop: 95,
        plannedTarget1: 110,
      },
      [candle(0, 98, 101), candle(1, 103, 111)],
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(result.outcomeStatus).toBe("WORKED_WITHOUT_ME");
    expect(result.actualTriggerAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.mfeR).toBe(2.2);
    expect(result.maeR).toBe(-0.4);
  });

  it("marks a short idea as failed when the stop is reached first", () => {
    const result = calculateJournalOutcomeFromCandles(
      {
        symbol: "AAPL",
        direction: "SHORT",
        timeframe: "1D",
        ideaDate: "2026-01-01T00:00:00.000Z",
        plannedEntry: 100,
        plannedStop: 105,
        expectedR: 1,
      },
      [candle(0, 99, 101), candle(1, 96, 106)],
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(result.outcomeStatus).toBe("FAILED");
    expect(result.bestExitR).toBe(0.8);
    expect(result.maeR).toBe(-1.2);
  });

  it("returns never triggered after an elapsed follow-through window", () => {
    const result = calculateJournalOutcomeFromCandles(
      {
        symbol: "MSFT",
        direction: "LONG",
        timeframe: "1D",
        ideaDate: "2026-01-01T00:00:00.000Z",
        followThroughDays: 2,
        plannedEntry: 100,
        plannedStop: 95,
      },
      [candle(0, 90, 99), candle(1, 91, 98)],
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result.outcomeStatus).toBe("NEVER_TRIGGERED");
    expect(result.actualTriggerAt).toBeNull();
  });

  it("requires planned entry and stop", () => {
    const result = calculateJournalOutcomeFromCandles(
      {
        symbol: "TSLA",
        direction: "LONG",
        timeframe: "1D",
        ideaDate: "2026-01-01T00:00:00.000Z",
        plannedEntry: 100,
      },
      [candle(0, 99, 101)],
    );

    expect(result.status).toBe("INSUFFICIENT_PLAN");
    expect(result.outcomeStatus).toBeUndefined();
  });
});
