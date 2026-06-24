import { computeTradeSummaryMetrics, latestPriorEquitySnapshot } from "@/lib/stats/trade-summary-metrics";

describe("computeTradeSummaryMetrics", () => {
  it("returns a positive direction-adjusted price return for profitable longs", () => {
    const metrics = computeTradeSummaryMetrics({
      direction: "LONG",
      avgEntryPrice: 100,
      avgExitPrice: 110,
      realizedPnl: 98,
      executions: [
        { quantity: 10, price: 100 },
        { quantity: 10, price: 110 },
      ],
    });

    expect(metrics.priceReturnPct).toBe(10);
  });

  it("returns a positive direction-adjusted price return for profitable shorts", () => {
    const metrics = computeTradeSummaryMetrics({
      direction: "SHORT",
      avgEntryPrice: 100,
      avgExitPrice: 90,
      realizedPnl: 98,
      executions: [
        { quantity: 10, price: 100 },
        { quantity: 10, price: 90 },
      ],
    });

    expect(metrics.priceReturnPct).toBe(10);
  });

  it("uses execution rows for largest quantity and largest absolute notional", () => {
    const metrics = computeTradeSummaryMetrics({
      direction: "LONG",
      avgEntryPrice: 10,
      avgExitPrice: 12,
      realizedPnl: 200,
      executions: [
        { quantity: 15, price: 10 },
        { quantity: 5, price: 80 },
        { quantity: 20, price: 12 },
      ],
    });

    expect(metrics.largestExecutionQuantity).toBe(20);
    expect(metrics.largestExecutionNotional).toBe(400);
  });

  it("uses net realized P&L for notional and equity return percentages", () => {
    const metrics = computeTradeSummaryMetrics({
      direction: "LONG",
      avgEntryPrice: 100,
      avgExitPrice: 110,
      realizedPnl: 96,
      equityBaseline: 12_000,
      executions: [
        { quantity: 10, price: 100 },
        { quantity: 10, price: 110 },
      ],
    });

    expect(metrics.notionalReturnPct).toBeCloseTo(8.7273, 4);
    expect(metrics.equityReturnPct).toBeCloseTo(0.8, 4);
    expect(metrics.equityBaseline).toBe(12_000);
  });

  it("returns null percentages when denominators are missing, zero, or invalid", () => {
    const metrics = computeTradeSummaryMetrics({
      direction: "LONG",
      avgEntryPrice: 0,
      avgExitPrice: 110,
      realizedPnl: 96,
      equityBaseline: 0,
      executions: [],
    });

    expect(metrics.priceReturnPct).toBeNull();
    expect(metrics.notionalReturnPct).toBeNull();
    expect(metrics.equityReturnPct).toBeNull();
    expect(metrics.equityBaseline).toBeNull();
  });
});

describe("latestPriorEquitySnapshot", () => {
  it("selects the latest positive equity snapshot before the trade date", () => {
    const snapshots = [
      { accountId: "a", date: new Date("2026-02-20T00:00:00.000Z"), equity: 10_000 },
      { accountId: "a", date: new Date("2026-02-22T00:00:00.000Z"), equity: 10_500 },
      { accountId: "a", date: new Date("2026-02-23T00:00:00.000Z"), equity: 11_000 },
      { accountId: "a", date: new Date("2026-02-24T00:00:00.000Z"), equity: 11_500 },
      { accountId: "b", date: new Date("2026-02-23T00:00:00.000Z"), equity: 99_000 },
    ];

    const snapshot = latestPriorEquitySnapshot(snapshots, "a", new Date("2026-02-24T00:00:00.000Z"));

    expect(snapshot?.equity).toBe(11_000);
  });

  it("ignores same-day, missing, zero, and wrong-account equity snapshots", () => {
    const snapshots = [
      { accountId: "a", date: new Date("2026-02-23T00:00:00.000Z"), equity: null },
      { accountId: "a", date: new Date("2026-02-22T00:00:00.000Z"), equity: 0 },
      { accountId: "a", date: new Date("2026-02-24T00:00:00.000Z"), equity: 12_000 },
      { accountId: "b", date: new Date("2026-02-23T00:00:00.000Z"), equity: 10_000 },
    ];

    const snapshot = latestPriorEquitySnapshot(snapshots, "a", new Date("2026-02-24T00:00:00.000Z"));

    expect(snapshot).toBeNull();
  });
});
