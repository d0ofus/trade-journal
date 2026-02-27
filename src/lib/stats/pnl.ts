import { Side } from "@prisma/client";

export interface ExecutionForCalc {
  id: string;
  accountId: string;
  instrumentId: string;
  symbol: string;
  executedAt: Date;
  side: Side;
  quantity: number;
  price: number;
  commission: number;
  fees: number;
}

export interface ExecutionPnl {
  executionId: string;
  realizedPnl: number;
  grossRealizedPnl: number;
  cumulativePnl: number;
  matchedQuantity: number;
  avgHoldTimeMs: number;
}

interface Lot {
  qty: number;
  price: number;
  openedAtMs: number;
}

export function computeExecutionPnl(executions: ExecutionForCalc[]): ExecutionPnl[] {
  const sorted = [...executions].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  const grouped = new Map<string, ExecutionForCalc[]>();

  for (const exec of sorted) {
    const key = `${exec.accountId}:${exec.instrumentId}`;
    const list = grouped.get(key) ?? [];
    list.push(exec);
    grouped.set(key, list);
  }

  const result: ExecutionPnl[] = [];
  let cumulative = 0;

  for (const group of grouped.values()) {
    const lots: Lot[] = [];

    for (const exec of group) {
      let signedQty = exec.side === "BUY" ? exec.quantity : -exec.quantity;
      let realized = 0;
      let grossRealized = 0;
      let matched = 0;
      let holdTimeWeightedMs = 0;

      while (signedQty !== 0 && lots.length > 0 && Math.sign(signedQty) !== Math.sign(lots[0].qty)) {
        const lot = lots[0];
        const matchQty = Math.min(Math.abs(signedQty), Math.abs(lot.qty));
        const holdMs = Math.max(0, exec.executedAt.getTime() - lot.openedAtMs);

        if (lot.qty > 0 && signedQty < 0) {
          realized += matchQty * (exec.price - lot.price);
        } else if (lot.qty < 0 && signedQty > 0) {
          realized += matchQty * (lot.price - exec.price);
        }

        grossRealized = realized;
        matched += matchQty;
        holdTimeWeightedMs += holdMs * matchQty;
        lot.qty += Math.sign(signedQty) * matchQty;
        signedQty -= Math.sign(signedQty) * matchQty;

        if (Math.abs(lot.qty) < 1e-8) {
          lots.shift();
        }
      }

      if (signedQty !== 0) {
        lots.push({ qty: signedQty, price: exec.price, openedAtMs: exec.executedAt.getTime() });
      }

      realized -= exec.commission + exec.fees;
      cumulative += realized;

      result.push({
        executionId: exec.id,
        realizedPnl: realized,
        grossRealizedPnl: grossRealized,
        cumulativePnl: cumulative,
        matchedQuantity: matched,
        avgHoldTimeMs: matched > 0 ? holdTimeWeightedMs / matched : 0,
      });
    }
  }

  return result.sort((a, b) => {
    const aExec = executions.find((e) => e.id === a.executionId)!;
    const bExec = executions.find((e) => e.id === b.executionId)!;
    return aExec.executedAt.getTime() - bExec.executedAt.getTime();
  });
}

export function buildMetrics(pnlRows: ExecutionPnl[], totalCommissions: number) {
  const realized = pnlRows.reduce((sum, row) => sum + row.realizedPnl, 0);
  const trades = pnlRows.filter((row) => row.matchedQuantity > 0);
  const wins = trades.filter((row) => row.realizedPnl > 0);
  const losses = trades.filter((row) => row.realizedPnl < 0);

  const grossProfit = wins.reduce((sum, row) => sum + row.realizedPnl, 0);
  const grossLoss = losses.reduce((sum, row) => sum + Math.abs(row.realizedPnl), 0);

  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = trades.length ? (wins.length / trades.length) * avgWin + (losses.length / trades.length) * avgLoss : 0;

  let peak = 0;
  let maxDrawdown = 0;
  for (const row of pnlRows) {
    peak = Math.max(peak, row.cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, peak - row.cumulativePnl);
  }

  return {
    realized,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    maxDrawdown,
    commissions: totalCommissions,
  };
}

export function bucketHistogram(values: number[], bins = 10) {
  if (!values.length) return [] as { range: string; count: number }[];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min || 1) / bins;

  const buckets = Array.from({ length: bins }, (_, idx) => ({
    start: min + idx * width,
    end: min + (idx + 1) * width,
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / width), bins - 1);
    buckets[index].count += 1;
  }

  return buckets.map((bucket) => ({
    range: `${bucket.start.toFixed(0)}..${bucket.end.toFixed(0)}`,
    count: bucket.count,
  }));
}
