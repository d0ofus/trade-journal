import { describe, expect, it } from "vitest";
import { aggregateCalendarPerformance } from "@/lib/stats/calendar-performance";
import { aggregateDashboardData, type DashboardClosedTradeRow } from "@/lib/stats/dashboard-aggregation";

const demoTrades: DashboardClosedTradeRow[] = [
  {
    groupKey: "demo-a",
    openTime: new Date("2026-06-17T13:35:00.000Z"),
    closeTime: new Date("2026-06-17T16:45:00.000Z"),
    tradeDate: new Date("2026-06-17T00:00:00.000Z"),
    realizedPnl: 419.6,
    grossRealizedPnl: 422.5,
    totalCommission: 2.9,
    totalQuantity: 100,
  },
  {
    groupKey: "demo-b",
    openTime: new Date("2026-06-18T13:42:00.000Z"),
    closeTime: new Date("2026-06-18T15:10:00.000Z"),
    tradeDate: new Date("2026-06-18T00:00:00.000Z"),
    realizedPnl: -122.1,
    grossRealizedPnl: -120,
    totalCommission: 2.1,
    totalQuantity: 80,
  },
  {
    groupKey: "demo-c",
    openTime: new Date("2026-06-18T12:05:00.000Z"),
    closeTime: new Date("2026-06-22T13:50:00.000Z"),
    tradeDate: new Date("2026-06-22T00:00:00.000Z"),
    realizedPnl: 293.9,
    grossRealizedPnl: 297,
    totalCommission: 3.1,
    totalQuantity: 120,
  },
];

describe("demo workstation metric reconciliation", () => {
  it("keeps dashboard and calendar totals on the same closed-trade ledger", () => {
    const dashboard = aggregateDashboardData({
      closedTrades: demoTrades,
      executions: [],
      rangeStart: new Date("2026-06-17T00:00:00.000Z"),
      rangeEnd: new Date("2026-06-22T23:59:59.999Z"),
    });
    const calendar = aggregateCalendarPerformance({
      closedTrades: demoTrades,
      from: new Date("2026-01-01T00:00:00.000Z"),
      notes: [],
      snapshots: [],
    });

    expect(dashboard.cards).toMatchObject({ totalTrades: 3, winCount: 2, lossCount: 1 });
    expect(dashboard.cards.realized).toBeCloseTo(591.4, 8);
    expect(dashboard.cards.realizedDay).toBeCloseTo(293.9, 8);
    expect(dashboard.cards.realizedWeek).toBeCloseTo(293.9, 8);
    expect(dashboard.cards.realizedMonth).toBeCloseTo(591.4, 8);
    expect(dashboard.cards.largestGain).toBeCloseTo(419.6, 8);
    expect(dashboard.cards.largestLoss).toBeCloseTo(-122.1, 8);
    expect(dashboard.cards.expectancy).toBeCloseTo(591.4 / 3, 8);
    expect(dashboard.cards.winRate).toBeCloseTo(66.6667, 4);
    expect(dashboard.cards.profitFactor).toBeCloseTo(713.5 / 122.1, 8);
    expect(dashboard.charts.equityCurve.map((point) => point.equity)).toEqual(
      [419.6, 297.5, 591.4].map((equity) => expect.closeTo(equity, 8)),
    );
    expect(dashboard.charts.grossCumulativePnl.map((point) => point.pnl)).toEqual(
      [422.5, 302.5, 599.5].map((pnl) => expect.closeTo(pnl, 8)),
    );

    expect(calendar.monthlyTotals).toHaveLength(1);
    expect(calendar.monthlyTotals[0]).toMatchObject({ month: "2026-06", mtm: 0 });
    expect(calendar.monthlyTotals[0].realized).toBeCloseTo(591.4, 8);
    expect(calendar.monthlyTotals[0].total).toBeCloseTo(591.4, 8);
    expect(calendar.days.map(({ date, realized }) => ({ date, realized }))).toEqual([
      { date: "2026-06-17", realized: 419.6 },
      { date: "2026-06-18", realized: -122.1 },
      { date: "2026-06-22", realized: 293.9 },
    ]);
  });

  it("selects the June 18 loss by canonical trade date despite a Sydney-local June 19 close", () => {
    const dashboard = aggregateDashboardData({
      closedTrades: demoTrades,
      executions: [],
      rangeStart: new Date("2026-06-18T00:00:00.000Z"),
      rangeEnd: new Date("2026-06-18T23:59:59.999Z"),
    });

    expect(dashboard.cards).toMatchObject({
      totalTrades: 1,
      realized: -122.1,
      realizedDay: -122.1,
      realizedWeek: -122.1,
      realizedMonth: -122.1,
      winCount: 0,
      lossCount: 1,
    });
    expect(dashboard.charts.dailyPnl).toEqual([{ date: "2026-06-18", pnl: -122.1 }]);
  });
});
