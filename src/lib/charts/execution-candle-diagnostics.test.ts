import {
  formatExecutionCandleDiagnosticWarning,
  getExecutionCandleDiagnostics,
} from "@/lib/charts/execution-candle-diagnostics";
import type { AlignmentCandle } from "@/lib/charts/execution-marker-alignment";

function isoFromSeconds(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

describe("execution candle diagnostics", () => {
  it("warns when a fill is inside the global chart range but outside its execution candle", () => {
    const candles: AlignmentCandle[] = [
      { time: 1_000, open: 100, high: 110, low: 90, close: 105 },
      { time: 1_300, open: 105, high: 106, low: 104, close: 105 },
    ];

    const diagnostics = getExecutionCandleDiagnostics(
      [{ id: "fill-1", executedAt: isoFromSeconds(1_360), price: 100 }],
      candles,
    );

    expect(diagnostics.outsideCount).toBe(1);
    expect(diagnostics.missingCount).toBe(0);
    expect(formatExecutionCandleDiagnosticWarning(diagnostics)).toBe("1 fill outside execution candle.");
  });

  it("separates executions that do not have a matching candle", () => {
    const candles: AlignmentCandle[] = [
      { time: 1_000, open: 100, high: 101, low: 99, close: 100.5 },
      { time: 1_300, open: 100.5, high: 102, low: 100, close: 101.5 },
    ];

    const diagnostics = getExecutionCandleDiagnostics(
      [{ id: "fill-1", executedAt: isoFromSeconds(200_000), price: 101 }],
      candles,
    );

    expect(diagnostics.outsideCount).toBe(0);
    expect(diagnostics.missingCount).toBe(1);
    expect(formatExecutionCandleDiagnosticWarning(diagnostics)).toBe("1 fill has no matching candle.");
  });

  it("stays quiet when all fills align inside their candles", () => {
    const candles: AlignmentCandle[] = [
      { time: 1_000, open: 100, high: 101, low: 99, close: 100.5 },
      { time: 1_300, open: 100.5, high: 102, low: 100, close: 101.5 },
    ];

    const diagnostics = getExecutionCandleDiagnostics(
      [{ id: "fill-1", executedAt: isoFromSeconds(1_360), price: 101 }],
      candles,
    );

    expect(diagnostics.outsideCount).toBe(0);
    expect(diagnostics.missingCount).toBe(0);
    expect(formatExecutionCandleDiagnosticWarning(diagnostics)).toBe("");
  });
});
