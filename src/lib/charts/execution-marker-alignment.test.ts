import {
  alignExecutionToBarTime,
  inferExecutionOffsetSeconds,
  type AlignmentCandle,
} from "@/lib/charts/execution-marker-alignment";

function isoFromSeconds(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

describe("execution marker alignment", () => {
  it("aligns an execution to the containing intraday candle", () => {
    const candles: AlignmentCandle[] = [
      { time: 1_000, open: 100, high: 101, low: 99.5, close: 100.4 },
      { time: 1_300, open: 100.4, high: 102, low: 100.2, close: 101.8 },
      { time: 1_600, open: 101.8, high: 103, low: 101.6, close: 102.4 },
    ];

    expect(alignExecutionToBarTime(isoFromSeconds(1_420), candles)).toBe(1_300);
  });

  it("does not assign executions that fall into a market gap", () => {
    const candles: AlignmentCandle[] = [
      {
        time: Math.floor(Date.parse("2026-03-12T00:00:00.000Z") / 1000),
        open: 99,
        high: 100,
        low: 98.5,
        close: 99.7,
      },
      {
        time: Math.floor(Date.parse("2026-03-13T00:00:00.000Z") / 1000),
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
      },
      {
        time: Math.floor(Date.parse("2026-03-16T00:00:00.000Z") / 1000),
        open: 101,
        high: 102,
        low: 100,
        close: 101.4,
      },
      {
        time: Math.floor(Date.parse("2026-03-17T00:00:00.000Z") / 1000),
        open: 101.4,
        high: 102.3,
        low: 100.8,
        close: 101.9,
      },
    ];

    expect(alignExecutionToBarTime("2026-03-14T12:00:00.000Z", candles)).toBeNull();
  });

  it("prefers the offset whose candle actually contains the execution price", () => {
    const correctBase = Math.floor(Date.parse("2026-03-16T14:30:00.000Z") / 1000);
    const shiftedBase = correctBase + 14 * 60 * 60;
    const candles: AlignmentCandle[] = [
      { time: correctBase, open: 100, high: 101.4, low: 99.8, close: 101.1 },
      { time: correctBase + 300, open: 101.1, high: 101.9, low: 100.9, close: 101.7 },
      { time: shiftedBase, open: 200, high: 201.2, low: 199.7, close: 200.6 },
      { time: shiftedBase + 300, open: 200.6, high: 201.5, low: 200.3, close: 201.1 },
    ];

    const executions = [
      {
        executedAt: isoFromSeconds(shiftedBase + 90),
        price: 101.3,
      },
    ];

    expect(inferExecutionOffsetSeconds(executions, candles)).toBe(-14 * 60 * 60);
    expect(alignExecutionToBarTime(executions[0].executedAt, candles, -14 * 60 * 60)).toBe(correctBase);
  });
});
