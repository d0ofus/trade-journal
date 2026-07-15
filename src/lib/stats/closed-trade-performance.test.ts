import {
  computeClosedTradeEquityCurve,
  computeClosedTradePerformanceMetrics,
} from "@/lib/stats/closed-trade-performance";

describe("computeClosedTradePerformanceMetrics", () => {
  it("does not report a smallest win as a loss in all-winning periods", () => {
    const metrics = computeClosedTradePerformanceMetrics([{ realizedPnl: 125 }, { realizedPnl: 75 }]);

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winCount).toBe(2);
    expect(metrics.lossCount).toBe(0);
    expect(metrics.largestGain).toBe(125);
    expect(metrics.largestLoss).toBe(0);
    expect(metrics.profitFactor).toBe(Infinity);
    expect(metrics.expectancy).toBe(100);
  });

  it("does not report a least-bad loss as a gain in all-losing periods", () => {
    const metrics = computeClosedTradePerformanceMetrics([{ realizedPnl: -40 }, { realizedPnl: -140 }]);

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winCount).toBe(0);
    expect(metrics.lossCount).toBe(2);
    expect(metrics.largestGain).toBe(0);
    expect(metrics.largestLoss).toBe(-140);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.expectancy).toBe(-90);
  });

  it("keeps mixed-period metrics aligned to closed trade outcomes", () => {
    const metrics = computeClosedTradePerformanceMetrics([
      { realizedPnl: 200 },
      { realizedPnl: -50 },
      { realizedPnl: 0 },
      { realizedPnl: -25 },
    ]);

    expect(metrics.totalTrades).toBe(4);
    expect(metrics.winCount).toBe(1);
    expect(metrics.lossCount).toBe(2);
    expect(metrics.realized).toBe(125);
    expect(metrics.grossProfit).toBe(200);
    expect(metrics.grossLoss).toBe(75);
    expect(metrics.winRate).toBe(25);
    expect(metrics.avgWin).toBe(200);
    expect(metrics.avgLoss).toBe(-37.5);
    expect(metrics.profitFactor).toBeCloseTo(2.6667, 4);
    expect(metrics.expectancy).toBe(31.25);
    expect(metrics.largestGain).toBe(200);
    expect(metrics.largestLoss).toBe(-50);
  });

  it("returns neutral metrics for flat or empty periods", () => {
    expect(computeClosedTradePerformanceMetrics([])).toMatchObject({
      totalTrades: 0,
      realized: 0,
      winRate: 0,
      profitFactor: 0,
      largestGain: 0,
      largestLoss: 0,
    });
    expect(computeClosedTradePerformanceMetrics([{ realizedPnl: 0 }])).toMatchObject({
      totalTrades: 1,
      realized: 0,
      winRate: 0,
      profitFactor: 0,
      largestGain: 0,
      largestLoss: 0,
    });
  });
});

describe("computeClosedTradeEquityCurve", () => {
  it("carries prior closed-trade baseline into filtered range equity", () => {
    const curve = computeClosedTradeEquityCurve([{ realizedPnl: 100 }, { realizedPnl: -50 }], 1_000);

    expect(curve.points.map((point) => point.equity)).toEqual([1_100, 1_050]);
    expect(curve.maxDrawdown).toBe(50);
  });

  it("measures drawdown from the baseline when the range starts with losses", () => {
    const curve = computeClosedTradeEquityCurve([{ realizedPnl: -80 }, { realizedPnl: 20 }], 500);

    expect(curve.points.map((point) => point.equity)).toEqual([420, 440]);
    expect(curve.maxDrawdown).toBe(80);
  });
});
