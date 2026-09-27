import { computeClosedTradePerformanceMetrics } from "@/lib/stats/closed-trade-performance";
import { entryTimeBucket, reportingDate, reportingDayBoundary } from "@/lib/stats/reporting-time";
import { ACCOUNTING_VERSION } from "@/lib/stats/accounting";

/** Performance input: completed cycles with their complete allocated economics. */
export type DashboardClosedTradeRow = {
  groupKey: string; openTime: Date; closeTime: Date; tradeDate: Date;
  realizedPnl: number; grossRealizedPnl: number; totalCommission: number; totalQuantity: number;
  symbol?: string; direction?: string; assetType?: string; openingTimeKnown?: boolean;
};
// Compatibility input only. Raw fills are deliberately never consumed.
export type DashboardExecutionRow = { executedAt: Date; quantity: number; price: number; side: string; instrument: { symbol: string } };
export type DashboardAggregation = ReturnType<typeof aggregateDashboardData>;
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + pick(row), 0);

function holdMs(trade: DashboardClosedTradeRow) {
  if (trade.openingTimeKnown === false) return null;
  const value = trade.closeTime.getTime() - trade.openTime.getTime();
  return value >= 0 ? value : null;
}
function holdBand(trade: DashboardClosedTradeRow) {
  const ms = holdMs(trade);
  return ms == null ? "Unknown opening time" : ms < 30 * 60_000 ? "Under 30 minutes" : ms < 3600_000 ? "30–60 minutes" : ms < 86400_000 ? "1–24 hours" : ms < 7 * 86400_000 ? "1–7 days" : "7+ days";
}
function summarize(rows: DashboardClosedTradeRow[]) {
  const count = rows.length, pnl = sum(rows, t => t.realizedPnl);
  return { count, pnl, gross: sum(rows, t => t.grossRealizedPnl), costs: sum(rows, t => t.totalCommission), expectancy: count ? pnl / count : null, winRate: count ? 100 * rows.filter(t => t.realizedPnl > 0).length / count : null };
}
function breakdown(rows: DashboardClosedTradeRow[], key: (row: DashboardClosedTradeRow) => string) {
  const groups = new Map<string, DashboardClosedTradeRow[]>();
  for (const row of rows) { const label = key(row); groups.set(label, [...(groups.get(label) ?? []), row]); }
  return [...groups].map(([label, trades]) => ({ label, ...summarize(trades) })).sort((a, b) => b.pnl - a.pnl || a.label.localeCompare(b.label));
}

export function aggregateDashboardData({ closedTrades, now = new Date(), rangeEnd, rangeStart }: {
  closedTrades: DashboardClosedTradeRow[]; executions?: DashboardExecutionRow[]; now?: Date; rangeEnd?: Date; rangeStart?: Date;
}) {
  // Range Dates are date-only labels, not UTC execution boundaries.
  const from = rangeStart?.toISOString().slice(0, 10), to = rangeEnd?.toISOString().slice(0, 10);
  const trades = closedTrades.filter(t => {
    const date = reportingDate(t.closeTime);
    return (!from || date >= from) && (!to || date <= to);
  }).sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime() || a.groupKey.localeCompare(b.groupKey));
  const metrics = computeClosedTradePerformanceMetrics(trades), totals = summarize(trades);
  const dailyRows = breakdown(trades, t => reportingDate(t.closeTime)).sort((a, b) => a.label.localeCompare(b.label));
  const dailyPnl = dailyRows.map(r => ({ date: r.label, pnl: r.pnl }));
  const grossDailyPnl = dailyRows.map(r => ({ date: r.label, pnl: r.gross }));
  const dailyTradeCounts = dailyRows.map(r => ({ date: r.label, trades: r.count }));
  const openingLabel = `${from ?? dailyRows[0]?.label ?? reportingDate(now)} opening`;
  let grossRunning = 0;
  const grossCumulativePnl = trades.length ? [{ date: openingLabel, pnl: 0, opening: true }, ...grossDailyPnl.map(row => ({ date: row.date, pnl: grossRunning += row.pnl, opening: false }))] : [];
  // Simultaneous closures cannot create drawdowns through arbitrary trade-ID ordering.
  const byClose = new Map<number, number>();
  for (const t of trades) byClose.set(t.closeTime.getTime(), (byClose.get(t.closeTime.getTime()) ?? 0) + t.realizedPnl);
  let equity = 0, peak = 0, maxDrawdown = 0, maxRecoveryMs = 0;
  let peakAt = reportingDayBoundary(from ?? dailyRows[0]?.label ?? reportingDate(now));
  let underwaterSince: number | null = null;
  const equityCurve = trades.length ? [{ at: openingLabel, equity: 0 }] : [];
  const drawdown: Array<{ at: string; drawdown: number }> = trades.length ? [{ at: openingLabel, drawdown: 0 }] : [];
  for (const [at, pnl] of byClose) {
    equity += pnl;
    if (equity >= peak) {
      if (underwaterSince != null) maxRecoveryMs = Math.max(maxRecoveryMs, at - underwaterSince);
      peak = equity; peakAt = at; underwaterSince = null;
    } else if (underwaterSince == null) underwaterSince = peakAt;
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    equityCurve.push({ at: new Date(at).toISOString(), equity });
    drawdown.push({ at: new Date(at).toISOString(), drawdown: equity - peak });
  }
  const endAt = Math.max(trades.at(-1)?.closeTime.getTime() ?? 0, to ? Math.min(reportingDayBoundary(to, true), now.getTime()) : now.getTime());
  const currentRecoveryMs = underwaterSince == null ? null : Math.max(0, endAt - underwaterSince);
  if (currentRecoveryMs != null) maxRecoveryMs = Math.max(maxRecoveryMs, currentRecoveryMs);
  const knownWinners = trades.filter(t => t.realizedPnl > 0 && holdMs(t) != null), knownLosers = trades.filter(t => t.realizedPnl < 0 && holdMs(t) != null);
  const avgHold = (rows: DashboardClosedTradeRow[]) => rows.length ? sum(rows, t => holdMs(t)!) / rows.length : null;
  const anchor = to ?? reportingDate(now), anchorDate = new Date(`${anchor}T12:00:00Z`);
  const weekDate = new Date(anchorDate); weekDate.setUTCDate(weekDate.getUTCDate() - (weekDate.getUTCDay() + 6) % 7);
  const week = weekDate.toISOString().slice(0, 10), month = anchor.slice(0, 7) + "-01";
  const periodPnl = (start: string) => sum(dailyRows.filter(r => r.label >= start && r.label <= anchor), r => r.pnl);
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const t of trades) {
    winStreak = t.realizedPnl > 0 ? winStreak + 1 : 0; lossStreak = t.realizedPnl < 0 ? lossStreak + 1 : 0;
    maxWinStreak = Math.max(maxWinStreak, winStreak); maxLossStreak = Math.max(maxLossStreak, lossStreak);
  }
  const entryGroups = new Map<string, DashboardClosedTradeRow[]>();
  for (const t of trades.filter(t => t.openingTimeKnown !== false)) {
    const { weekday, slot } = entryTimeBucket(t.openTime), key = `${weekday}:${slot}`;
    entryGroups.set(key, [...(entryGroups.get(key) ?? []), t]);
  }
  const entryHeatmap = [...entryGroups].map(([key, rows]) => ({ ...entryTimeBucket(rows[0].openTime), key, ...summarize(rows) }));
  const rolling = trades.slice(19).map((t, i) => ({ at: t.closeTime.toISOString(), ...summarize(trades.slice(i, i + 20)) }));
  const positive = trades.filter(t => t.realizedPnl > 0).sort((a, b) => b.realizedPnl - a.realizedPnl), positivePnl = sum(positive, t => t.realizedPnl);
  const sortedDays = [...dailyRows].sort((a, b) => b.pnl - a.pnl), values = trades.map(t => t.realizedPnl);
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0, width = (max - min) / 12;
  const histogram = values.length ? (width === 0 ? [{ range: `${min.toFixed(2)}`, count: values.length }] : Array.from({ length: 12 }, (_, i) => ({
    range: `${(min + i * width).toFixed(2)} to ${(min + (i + 1) * width).toFixed(2)}`,
    count: values.filter(v => Math.min(11, Math.floor((v - min) / width)) === i).length,
  }))) : [];
  const activeDays = dailyRows.length;
  const quantity = (contracts: boolean) => activeDays ? sum(trades.filter(t => ["OPTION", "FUTURE"].includes(t.assetType ?? "") === contracts), t => t.totalQuantity) / activeDays : null;
  return {
    version: ACCOUNTING_VERSION,
    cohort: { from: from ?? dailyRows[0]?.label ?? null, to: to ?? reportingDate(now), count: trades.length, activeDays, knownEntryCount: sum(entryHeatmap, r => r.count) },
    cards: {
      totalTrades: trades.length, winCount: metrics.winCount, lossCount: metrics.lossCount, flatCount: trades.length - metrics.winCount - metrics.lossCount,
      largestGain: metrics.largestGain, largestLoss: metrics.largestLoss,
      avgWinHoldMs: avgHold(knownWinners), avgLossHoldMs: avgHold(knownLosers), knownWinHoldCount: knownWinners.length, knownLossHoldCount: knownLosers.length,
      avgDailyVolume: quantity(false), avgDailyShares: quantity(false), avgDailyContracts: quantity(true),
      realizedDay: periodPnl(anchor), realizedWeek: periodPnl(week), realizedMonth: periodPnl(month),
      realized: totals.pnl, gross: totals.gross, winRate: totals.winRate, profitFactor: metrics.lossCount ? metrics.profitFactor : null,
      avgWin: metrics.avgWin, avgLoss: metrics.avgLoss, expectancy: totals.expectancy,
      payoffRatio: metrics.winCount && metrics.lossCount ? metrics.avgWin / Math.abs(metrics.avgLoss) : null,
      maxDrawdown, commissions: totals.costs, maxRecoveryMs: trades.length ? maxRecoveryMs : null, currentRecoveryMs,
      maxWinStreak, maxLossStreak, profitableDays: dailyRows.filter(r => r.pnl > 0).length,
      dailyConsistency: activeDays ? 100 * dailyRows.filter(r => r.pnl > 0).length / activeDays : null,
      bestDay: sortedDays[0] ?? null, worstDay: sortedDays.at(-1) ?? null,
      costPerTrade: trades.length ? totals.costs / trades.length : null,
      costDrag: sum(trades, t => Math.abs(t.grossRealizedPnl)) > 0 ? 100 * totals.costs / sum(trades, t => Math.abs(t.grossRealizedPnl)) : null,
      topFiveProfitShare: positivePnl ? 100 * sum(positive.slice(0, 5), t => t.realizedPnl) / positivePnl : null,
      sharpe: null, sortino: null, calmar: null,
    },
    charts: { dailyPnl, grossDailyPnl, grossCumulativePnl, dailyTradeCounts, equityCurve, histogram, entryHeatmap, drawdown, rolling },
    breakdowns: { symbol: breakdown(trades, t => t.symbol ?? "Unknown"), direction: breakdown(trades, t => t.direction ?? "Unknown"), instrument: breakdown(trades, t => t.assetType ?? "Unknown"), holding: breakdown(trades, holdBand) },
  };
}
