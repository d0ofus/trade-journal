import { format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { computeClosedTradeEquityCurve, computeClosedTradePerformanceMetrics } from "@/lib/stats/closed-trade-performance";
import { bucketHistogram } from "@/lib/stats/pnl";

export type DashboardExecutionRow = {
  executedAt: Date;
  quantity: number;
  price: number;
  side: string;
  instrument: {
    symbol: string;
  };
};

export type DashboardClosedTradeRow = {
  groupKey: string;
  openTime: Date;
  closeTime: Date;
  tradeDate: Date;
  realizedPnl: number;
  grossRealizedPnl: number;
  totalCommission: number;
  totalQuantity: number;
};

export type DashboardAggregation = ReturnType<typeof aggregateDashboardData>;

function compareDates(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareClosedTrades(a: DashboardClosedTradeRow, b: DashboardClosedTradeRow) {
  const closeDiff = a.closeTime.getTime() - b.closeTime.getTime();
  if (closeDiff !== 0) return closeDiff;
  return a.groupKey.localeCompare(b.groupKey);
}

function compareExecutions(a: DashboardExecutionRow, b: DashboardExecutionRow) {
  return a.executedAt.getTime() - b.executedAt.getTime();
}

export function aggregateDashboardData({
  closedTrades,
  executions,
  now = new Date(),
  rangeEnd,
  rangeStart,
}: {
  closedTrades: DashboardClosedTradeRow[];
  executions: DashboardExecutionRow[];
  now?: Date;
  rangeEnd?: Date;
  rangeStart?: Date;
}) {
  const filteredClosedTrades: DashboardClosedTradeRow[] = [];
  const daily = new Map<string, number>();
  const grossDailyMap = new Map<string, number>();
  const dailyTradeCountMap = new Map<string, number>();
  const dailyVolumeMap = new Map<string, number>();
  const returnValues: number[] = [];
  const scatter: Array<{ time: string; symbol: string; price: number; side: string }> = [];

  let filteredCommissions = 0;
  let firstFilteredCloseAt: Date | undefined;
  let realizedDay = 0;
  let realizedWeek = 0;
  let realizedMonth = 0;
  let winningHoldMsTotal = 0;
  let losingHoldMsTotal = 0;
  let winningRowsCount = 0;
  let losingRowsCount = 0;

  const orderedExecutions = [...executions].sort(compareExecutions);
  const orderedClosedTrades = [...closedTrades].sort(compareClosedTrades);
  const anchorDate = rangeEnd ?? now;
  const dayStart = startOfDay(anchorDate);
  const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const monthStart = startOfMonth(anchorDate);

  for (const exec of orderedExecutions) {
    const executedAt = exec.executedAt;

    if (rangeStart && executedAt < rangeStart) continue;
    if (rangeEnd && executedAt > rangeEnd) continue;

    const dayKey = format(executedAt, "yyyy-MM-dd");
    dailyVolumeMap.set(dayKey, (dailyVolumeMap.get(dayKey) ?? 0) + Math.abs(exec.quantity));
    scatter.push({
      time: format(executedAt, "HH:mm"),
      symbol: exec.instrument.symbol,
      price: exec.price,
      side: exec.side,
    });
  }

  for (const trade of orderedClosedTrades) {
    if (rangeStart && trade.closeTime < rangeStart) continue;
    if (rangeEnd && trade.closeTime > rangeEnd) continue;

    filteredClosedTrades.push(trade);
    filteredCommissions += trade.totalCommission;
    firstFilteredCloseAt ??= trade.closeTime;

    if (trade.closeTime >= dayStart) realizedDay += trade.realizedPnl;
    if (trade.closeTime >= weekStart) realizedWeek += trade.realizedPnl;
    if (trade.closeTime >= monthStart) realizedMonth += trade.realizedPnl;

    const dayKey = format(trade.tradeDate, "yyyy-MM-dd");
    daily.set(dayKey, (daily.get(dayKey) ?? 0) + trade.realizedPnl);
    grossDailyMap.set(dayKey, (grossDailyMap.get(dayKey) ?? 0) + trade.grossRealizedPnl);
    dailyTradeCountMap.set(dayKey, (dailyTradeCountMap.get(dayKey) ?? 0) + 1);
    returnValues.push(trade.realizedPnl);

    const holdMs = Math.max(0, trade.closeTime.getTime() - trade.openTime.getTime());
    if (trade.realizedPnl > 0) {
      winningHoldMsTotal += holdMs;
      winningRowsCount += 1;
    } else if (trade.realizedPnl < 0) {
      losingHoldMsTotal += holdMs;
      losingRowsCount += 1;
    }
  }

  let equityBaseline = 0;
  let grossEquityBaseline = 0;
  if (firstFilteredCloseAt) {
    for (const trade of orderedClosedTrades) {
      if (trade.closeTime >= firstFilteredCloseAt) break;
      equityBaseline += trade.realizedPnl;
      grossEquityBaseline += trade.grossRealizedPnl;
    }
  }

  const dailyPnl = [...daily.entries()]
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => compareDates(a.date, b.date));
  const grossDailyPnl = [...grossDailyMap.entries()]
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => compareDates(a.date, b.date));
  let grossRunning = grossEquityBaseline;
  const grossCumulativePnl = grossDailyPnl.map((row) => {
    grossRunning += row.pnl;
    return { date: row.date, pnl: grossRunning };
  });
  const dailyTradeCounts = [...dailyTradeCountMap.entries()]
    .map(([date, trades]) => ({ date, trades }))
    .sort((a, b) => compareDates(a.date, b.date));
  const volumeDays = [...dailyVolumeMap.values()];
  const avgDailyVolume =
    volumeDays.length > 0 ? volumeDays.reduce((sum, value) => sum + value, 0) / volumeDays.length : 0;
  const performanceMetrics = computeClosedTradePerformanceMetrics(filteredClosedTrades);
  const equityMetrics = computeClosedTradeEquityCurve(filteredClosedTrades, equityBaseline);
  const equityCurve = equityMetrics.points.map(({ trade, equity }) => {
    return {
      at: format(trade.closeTime, "yyyy-MM-dd HH:mm"),
      equity,
    };
  });
  const histogram = bucketHistogram(returnValues, 12);

  return {
    cards: {
      totalTrades: filteredClosedTrades.length,
      winCount: performanceMetrics.winCount,
      lossCount: performanceMetrics.lossCount,
      largestGain: performanceMetrics.largestGain,
      largestLoss: performanceMetrics.largestLoss,
      avgWinHoldMs: winningRowsCount > 0 ? winningHoldMsTotal / winningRowsCount : 0,
      avgLossHoldMs: losingRowsCount > 0 ? losingHoldMsTotal / losingRowsCount : 0,
      avgDailyVolume,
      realizedDay,
      realizedWeek,
      realizedMonth,
      realized: performanceMetrics.realized,
      winRate: performanceMetrics.winRate,
      profitFactor: performanceMetrics.profitFactor,
      avgWin: performanceMetrics.avgWin,
      avgLoss: performanceMetrics.avgLoss,
      expectancy: performanceMetrics.expectancy,
      maxDrawdown: equityMetrics.maxDrawdown,
      commissions: filteredCommissions,
    },
    charts: {
      dailyPnl,
      grossDailyPnl,
      grossCumulativePnl,
      dailyTradeCounts,
      equityCurve,
      histogram,
      scatter,
    },
  };
}
