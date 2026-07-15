export type ClosedTradePerformanceInput = {
  realizedPnl: number;
};

export type ClosedTradePerformanceMetrics = {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  realized: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  largestGain: number;
  largestLoss: number;
};

export type ClosedTradeEquityPoint<TTrade extends ClosedTradePerformanceInput> = {
  trade: TTrade;
  equity: number;
};

export type ClosedTradeEquityCurve<TTrade extends ClosedTradePerformanceInput> = {
  points: Array<ClosedTradeEquityPoint<TTrade>>;
  maxDrawdown: number;
};

export function computeClosedTradePerformanceMetrics(
  trades: ClosedTradePerformanceInput[],
): ClosedTradePerformanceMetrics {
  const wins = trades.filter((trade) => trade.realizedPnl > 0);
  const losses = trades.filter((trade) => trade.realizedPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  const grossLoss = losses.reduce((sum, trade) => sum + Math.abs(trade.realizedPnl), 0);
  const totalTrades = trades.length;
  const realized = trades.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? -grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy =
    totalTrades > 0 ? (wins.length / totalTrades) * avgWin + (losses.length / totalTrades) * avgLoss : 0;

  return {
    totalTrades,
    winCount: wins.length,
    lossCount: losses.length,
    realized,
    grossProfit,
    grossLoss,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    largestGain: wins.length > 0 ? Math.max(...wins.map((trade) => trade.realizedPnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((trade) => trade.realizedPnl)) : 0,
  };
}

export function computeClosedTradeEquityCurve<TTrade extends ClosedTradePerformanceInput>(
  trades: TTrade[],
  baseline = 0,
): ClosedTradeEquityCurve<TTrade> {
  let equity = Number.isFinite(baseline) ? baseline : 0;
  let peak = equity;
  let maxDrawdown = 0;

  const points = trades.map((trade) => {
    equity += trade.realizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { trade, equity };
  });

  return { points, maxDrawdown };
}
