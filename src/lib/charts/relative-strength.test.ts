import {
  candleMoveForWindow,
  computeRelativeStrengthMetrics,
  matchCandlesByTime,
  type RelativeStrengthCandle,
} from "@/lib/charts/relative-strength";

const baseTime = Math.floor(Date.parse("2026-03-16T14:30:00.000Z") / 1000);

function candle(index: number, close: number): RelativeStrengthCandle {
  return {
    time: baseTime + index * 300,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
  };
}

function iso(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

describe("relative strength helpers", () => {
  it("matches ticker and benchmark candles by timestamp", () => {
    const tickerCandles = [candle(0, 100), candle(1, 101), candle(2, 102)];
    const benchmarkCandles = [candle(0, 400), candle(2, 404)];

    const pairs = matchCandlesByTime(tickerCandles, benchmarkCandles);

    expect(pairs.map((pair) => pair.time)).toEqual([baseTime, baseTime + 600]);
  });

  it("returns null benchmark movement when required bars are missing", () => {
    const result = candleMoveForWindow({
      candles: [candle(0, 400), candle(1, 401)],
      openTime: iso(baseTime),
      closeTime: iso(baseTime + 900),
    });

    expect(result.movePct).toBeNull();
    expect(result.endTime).toBeNull();
  });

  it("computes long relative and direction-adjusted spread", () => {
    const result = computeRelativeStrengthMetrics({
      avgEntryPrice: 100,
      avgExitPrice: 110,
      direction: "LONG",
      openTime: iso(baseTime + 30),
      closeTime: iso(baseTime + 630),
      benchmarkCandles: [candle(0, 400), candle(1, 404), candle(2, 408)],
    });

    expect(result.tickerMovePct).toBe(10);
    expect(result.benchmarkMovePct).toBeCloseTo(2, 6);
    expect(result.relativeSpreadPct).toBeCloseTo(8, 6);
    expect(result.directionAdjustedSpreadPct).toBeCloseTo(8, 6);
  });

  it("flips direction-adjusted spread for short trades", () => {
    const result = computeRelativeStrengthMetrics({
      avgEntryPrice: 100,
      avgExitPrice: 95,
      direction: "SHORT",
      openTime: iso(baseTime + 30),
      closeTime: iso(baseTime + 630),
      benchmarkCandles: [candle(0, 400), candle(1, 398), candle(2, 396)],
    });

    expect(result.tickerMovePct).toBe(-5);
    expect(result.benchmarkMovePct).toBeCloseTo(-1, 6);
    expect(result.relativeSpreadPct).toBeCloseTo(-4, 6);
    expect(result.directionAdjustedSpreadPct).toBeCloseTo(4, 6);
  });

  it("handles empty candle arrays safely", () => {
    const result = computeRelativeStrengthMetrics({
      avgEntryPrice: 100,
      avgExitPrice: 105,
      direction: "LONG",
      openTime: iso(baseTime),
      closeTime: iso(baseTime + 300),
      benchmarkCandles: [],
    });

    expect(result.tickerMovePct).toBe(5);
    expect(result.benchmarkMovePct).toBeNull();
    expect(result.relativeSpreadPct).toBeNull();
    expect(result.directionAdjustedSpreadPct).toBeNull();
  });

  it("uses the containing candle open and close for same-bar windows", () => {
    const result = candleMoveForWindow({
      candles: [
        {
          time: baseTime,
          open: 400,
          high: 406,
          low: 399,
          close: 405,
        },
      ],
      openTime: iso(baseTime + 30),
      closeTime: iso(baseTime + 240),
    });

    expect(result.movePct).toBeCloseTo(1.25, 6);
    expect(result.startTime).toBe(baseTime);
    expect(result.endTime).toBe(baseTime);
  });
});
