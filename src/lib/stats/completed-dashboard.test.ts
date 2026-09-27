import { describe, expect, it } from "vitest";
import { aggregateDashboardData, type DashboardClosedTradeRow } from "./dashboard-aggregation";
import { computeClosedTradeGroups, type ExecutionForClosed } from "./closed-trades";
import { matchesReportingCohort, reportingDayBoundary } from "./reporting-time";
const row = (id: string, pnl: number, close = "2026-01-02T21:00:00Z"): DashboardClosedTradeRow => ({ groupKey: id, openTime: new Date("2025-12-31T15:00:00Z"), closeTime: new Date(close), tradeDate: new Date(close), realizedPnl: pnl, grossRealizedPnl: pnl + 2, totalCommission: 2, totalQuantity: 3, assetType: "STOCK" });
const fill = (id: string, side: "BUY" | "SELL", quantity: number, price: number, day: number): ExecutionForClosed => ({ id, accountId: "a", accountCode: "TEST-COMPLETED", instrumentId: "i", symbol: "IBIT 260918P00042000", assetType: "OPTION", currency: "USD", executedAt: new Date(Date.UTC(2026, 8, day, 15)), side, quantity, price, commission: 0, fees: 0, contractMultiplier: 100 });
const report = (fills: ExecutionForClosed[]) => aggregateDashboardData({ now: new Date("2026-09-27T12:00:00Z"), closedTrades: computeClosedTradeGroups(fills, new Map()).map(t => ({ ...t, openTime: new Date(t.openTime), closeTime: new Date(t.closeTime), tradeDate: new Date(t.tradeDate) })) });
describe("completed-only dashboard", () => {
  it("starts at a separate zero point, includes cross-range entries and reconciles endpoints", () => {
    const result = aggregateDashboardData({ closedTrades: [row("prior", 14000, "2025-12-31T20:00:00Z"), row("current", -51.45)], rangeStart: new Date("2026-01-01Z"), rangeEnd: new Date("2026-09-27T23:59:59Z") });
    expect(result.charts.grossCumulativePnl.map(r => r.pnl)).toEqual([0, -49.45]);
    expect(result.charts.equityCurve.at(-1)?.equity).toBe(result.cards.realized);
    expect(result.cards.totalTrades).toBe(1); expect(result.cards.commissions).toBe(2);
    expect(result.charts.histogram.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });
  it("ignores open fills, partial exits and their charges; completion includes economics once", () => {
    const baseline = report([]), entry = { ...fill("e", "SELL", 3, .39, 1), commission: 2.4, transactionTax: .2 };
    const partial = { ...fill("p", "BUY", 1, .06, 2), commission: 1, transactionTax: .1 };
    expect(report([entry])).toEqual(baseline); expect(report([entry, partial])).toEqual(baseline);
    const complete = report([entry, partial, { ...fill("c", "BUY", 2, .06, 3), commission: 1.4230802, transactionTax: .13407722 }]);
    expect(complete.cards.totalTrades).toBe(1); expect(complete.cards.gross).toBeCloseTo(99, 10);
    expect(complete.cards.realized).toBeCloseTo(93.74284258, 10);
    expect(complete.cards.commissions).toBeCloseTo(5.25715742, 10);
  });
  it("uses NY closing dates across DST and midnight, with matching drilldowns", () => {
    expect(new Date(reportingDayBoundary("2026-03-08")).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(reportingDayBoundary("2026-03-08", true)).toISOString()).toBe("2026-03-09T03:59:59.999Z");
    const a = row("a", 10, "2026-03-09T03:30:00Z"), b = row("b", 20, "2026-03-09T04:30:00Z");
    const result = aggregateDashboardData({ closedTrades: [a, b], rangeStart: new Date("2026-03-08Z"), rangeEnd: new Date("2026-03-08T23:59:59Z") });
    expect(result.cards.realized).toBe(10);
    for (const t of [a, b]) expect(matchesReportingCohort({ openTime: t.openTime.getTime() / 1000, closeTime: t.closeTime.getTime() / 1000 }, { from: "2026-03-08", to: "2026-03-08", reportingTimezone: "America/New_York" })).toBe(t === a);
  });
  it("does not invent ratios or durations for unavailable samples", () => {
    expect(aggregateDashboardData({ closedTrades: [] }).cards.expectancy).toBeNull();
    expect(aggregateDashboardData({ closedTrades: [row("win", 10)] }).cards.profitFactor).toBeNull();
    expect(aggregateDashboardData({ closedTrades: [row("loss", -10)] }).cards.profitFactor).toBe(0);
    const flat = aggregateDashboardData({ closedTrades: [{ ...row("flat", 0), openingTimeKnown: false }] });
    expect(flat.cards.winRate).toBe(0); expect(flat.cards.payoffRatio).toBeNull(); expect(flat.charts.entryHeatmap).toEqual([]);
    expect(flat.cards.avgWinHoldMs).toBeNull(); expect(flat.cards.sharpe).toBeNull();
  });
  it("combines simultaneous closures before dollar drawdown", () => {
    const data = aggregateDashboardData({ closedTrades: [row("a", -100), row("b", 100)] });
    expect(data.cards.maxDrawdown).toBe(0);
  });
});
