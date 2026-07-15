import { aggregateDashboardData, type DashboardClosedTradeRow, type DashboardExecutionRow } from "@/lib/stats/dashboard-aggregation";

function at(year: number, monthIndex: number, day: number, hour = 12, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function closedTrade(overrides: Partial<DashboardClosedTradeRow> & Pick<DashboardClosedTradeRow, "groupKey">): DashboardClosedTradeRow {
  const closeTime = overrides.closeTime ?? at(2026, 0, 2);
  return {
    groupKey: overrides.groupKey,
    openTime: overrides.openTime ?? new Date(closeTime.getTime() - 60 * 60 * 1000),
    closeTime,
    tradeDate: overrides.tradeDate ?? closeTime,
    realizedPnl: overrides.realizedPnl ?? 0,
    grossRealizedPnl: overrides.grossRealizedPnl ?? overrides.realizedPnl ?? 0,
    totalCommission: overrides.totalCommission ?? 0,
    totalQuantity: overrides.totalQuantity ?? 1,
  };
}

function execution(overrides: Partial<DashboardExecutionRow>): DashboardExecutionRow {
  return {
    executedAt: overrides.executedAt ?? at(2026, 0, 2),
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 100,
    side: overrides.side ?? "BUY",
    instrument: overrides.instrument ?? { symbol: "TEST" },
  };
}

describe("aggregateDashboardData", () => {
  it("aggregates dashboard cards from sorted closed trades and carries the prior baseline", () => {
    const result = aggregateDashboardData({
      rangeStart: at(2026, 0, 2, 0, 0),
      rangeEnd: at(2026, 0, 3, 23, 59),
      executions: [
        execution({ executedAt: at(2026, 0, 5), quantity: 999, instrument: { symbol: "OUT" } }),
        execution({ executedAt: at(2026, 0, 3, 10), quantity: 5, instrument: { symbol: "BETA" }, side: "SELL" }),
        execution({ executedAt: at(2026, 0, 2, 9), quantity: 10, instrument: { symbol: "ALPHA" } }),
      ],
      closedTrades: [
        closedTrade({
          groupKey: "win",
          closeTime: at(2026, 0, 3, 15),
          tradeDate: at(2026, 0, 3),
          realizedPnl: 200,
          grossRealizedPnl: 205,
          totalCommission: 5,
        }),
        closedTrade({
          groupKey: "prior",
          closeTime: at(2026, 0, 1, 15),
          tradeDate: at(2026, 0, 1),
          realizedPnl: 100,
          grossRealizedPnl: 110,
          totalCommission: 3,
        }),
        closedTrade({
          groupKey: "flat",
          closeTime: at(2026, 0, 3, 16),
          tradeDate: at(2026, 0, 3),
          realizedPnl: 0,
          grossRealizedPnl: 0,
          totalCommission: 0,
        }),
        closedTrade({
          groupKey: "loss",
          closeTime: at(2026, 0, 2, 15),
          tradeDate: at(2026, 0, 2),
          realizedPnl: -50,
          grossRealizedPnl: -45,
          totalCommission: 4,
        }),
        closedTrade({
          groupKey: "outside",
          closeTime: at(2026, 0, 4, 15),
          tradeDate: at(2026, 0, 4),
          realizedPnl: 10_000,
          grossRealizedPnl: 10_000,
          totalCommission: 0,
        }),
      ],
    });

    expect(result.cards).toMatchObject({
      totalTrades: 3,
      winCount: 1,
      lossCount: 1,
      largestGain: 200,
      largestLoss: -50,
      realized: 150,
      realizedDay: 200,
      realizedWeek: 150,
      realizedMonth: 150,
      profitFactor: 4,
      avgWin: 200,
      avgLoss: -50,
      maxDrawdown: 50,
      commissions: 9,
      avgDailyVolume: 7.5,
    });
    expect(result.cards.winRate).toBeCloseTo(33.3333, 4);
    expect(result.cards.expectancy).toBeCloseTo(50, 8);

    expect(result.charts.dailyPnl).toEqual([
      { date: "2026-01-02", pnl: -50 },
      { date: "2026-01-03", pnl: 200 },
    ]);
    expect(result.charts.grossDailyPnl).toEqual([
      { date: "2026-01-02", pnl: -45 },
      { date: "2026-01-03", pnl: 205 },
    ]);
    expect(result.charts.grossCumulativePnl).toEqual([
      { date: "2026-01-02", pnl: 65 },
      { date: "2026-01-03", pnl: 270 },
    ]);
    expect(result.charts.dailyTradeCounts).toEqual([
      { date: "2026-01-02", trades: 1 },
      { date: "2026-01-03", trades: 2 },
    ]);
    expect(result.charts.equityCurve.map((point) => point.equity)).toEqual([50, 250, 250]);
    expect(result.charts.scatter.map((point) => `${point.symbol}:${point.side}`)).toEqual(["ALPHA:BUY", "BETA:SELL"]);
    expect(result.charts.histogram.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
  });
});
