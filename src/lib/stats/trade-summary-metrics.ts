export type TradeSummaryDirection = "LONG" | "SHORT";

export type TradeSummaryExecution = {
  quantity: number;
  price: number;
};

export type EquitySnapshotForTradeSummary = {
  accountId: string;
  date: Date;
  equity: number | null;
};

export type TradeSummaryMetricInput = {
  direction: TradeSummaryDirection;
  avgEntryPrice: number;
  avgExitPrice: number;
  realizedPnl: number;
  executions: TradeSummaryExecution[];
  equityBaseline?: number | null;
};

export type TradeSummaryMetrics = {
  priceReturnPct: number | null;
  largestExecutionQuantity: number;
  largestExecutionNotional: number;
  notionalReturnPct: number | null;
  equityReturnPct: number | null;
  equityBaseline: number | null;
};

function percentage(numerator: number, denominator: number | null | undefined) {
  if (!Number.isFinite(numerator) || denominator == null || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return (numerator / denominator) * 100;
}

export function computeTradeSummaryMetrics(input: TradeSummaryMetricInput): TradeSummaryMetrics {
  const directionAdjustedPriceMove =
    input.direction === "SHORT"
      ? input.avgEntryPrice - input.avgExitPrice
      : input.avgExitPrice - input.avgEntryPrice;

  let largestExecutionQuantity = 0;
  let largestExecutionNotional = 0;

  for (const execution of input.executions) {
    const quantity = Math.abs(execution.quantity);
    const notional = Math.abs(execution.quantity * execution.price);

    if (Number.isFinite(quantity)) {
      largestExecutionQuantity = Math.max(largestExecutionQuantity, quantity);
    }
    if (Number.isFinite(notional)) {
      largestExecutionNotional = Math.max(largestExecutionNotional, notional);
    }
  }

  const equityBaseline =
    input.equityBaseline != null && Number.isFinite(input.equityBaseline) && input.equityBaseline > 0
      ? input.equityBaseline
      : null;

  return {
    priceReturnPct: percentage(directionAdjustedPriceMove, input.avgEntryPrice),
    largestExecutionQuantity,
    largestExecutionNotional,
    notionalReturnPct: percentage(input.realizedPnl, largestExecutionNotional),
    equityReturnPct: percentage(input.realizedPnl, equityBaseline),
    equityBaseline,
  };
}

export function latestPriorEquitySnapshot(
  snapshots: EquitySnapshotForTradeSummary[],
  accountId: string,
  tradeDate: Date,
) {
  let latest: EquitySnapshotForTradeSummary | null = null;

  for (const snapshot of snapshots) {
    if (snapshot.accountId !== accountId) continue;
    if (snapshot.date >= tradeDate) continue;
    if (snapshot.equity == null || !Number.isFinite(snapshot.equity) || snapshot.equity <= 0) continue;
    if (!latest || snapshot.date > latest.date) {
      latest = snapshot;
    }
  }

  return latest;
}
