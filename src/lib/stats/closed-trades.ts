import { Side } from "@prisma/client";

export interface ExecutionForClosed {
  id: string;
  accountId: string;
  accountCode: string;
  instrumentId: string;
  symbol: string;
  executedAt: Date;
  side: Side;
  quantity: number;
  price: number;
  commission: number;
  fees: number;
}

export interface OpeningPosition {
  quantity: number;
  avgCost: number;
}

export interface ClosedTradeGroup {
  groupKey: string;
  accountId: string;
  accountCode: string;
  instrumentId: string;
  symbol: string;
  tradeDate: string;
  openingQuantity: number;
  closingQuantity: number;
  realizedPnl: number;
  totalCommission: number;
  executions: Array<{
    id: string;
    executedAt: string;
    side: Side;
    quantity: number;
    price: number;
    commission: number;
    fees: number;
  }>;
}

interface Lot {
  qty: number;
  price: number;
}

function keyFor(exec: ExecutionForClosed) {
  return `${exec.accountId}:${exec.instrumentId}`;
}

export function computeClosedTradeGroups(
  executions: ExecutionForClosed[],
  openingByAccountInstrument: Map<string, OpeningPosition>,
): ClosedTradeGroup[] {
  const grouped = new Map<string, ExecutionForClosed[]>();
  for (const exec of executions) {
    const k = keyFor(exec);
    const list = grouped.get(k) ?? [];
    list.push(exec);
    grouped.set(k, list);
  }

  const result: ClosedTradeGroup[] = [];

  for (const [k, rows] of grouped.entries()) {
    const sorted = [...rows].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
    const opening = openingByAccountInstrument.get(k) ?? { quantity: 0, avgCost: 0 };

    const lots: Lot[] = [];
    let positionQty = opening.quantity;

    if (opening.quantity !== 0) {
      lots.push({ qty: opening.quantity, price: opening.avgCost });
    }

    let cycleExecutions: ClosedTradeGroup["executions"] = [];
    let cyclePnl = 0;
    let cycleCommission = 0;
    let cycleOpeningQty = positionQty;
    let cycleCount = 0;

    for (const exec of sorted) {
      const signedQty = exec.side === "BUY" ? exec.quantity : -exec.quantity;
      let remaining = signedQty;
      let matched = 0;
      let realized = 0;

      while (remaining !== 0 && lots.length > 0 && Math.sign(remaining) !== Math.sign(lots[0].qty)) {
        const lot = lots[0];
        const matchQty = Math.min(Math.abs(remaining), Math.abs(lot.qty));
        if (lot.qty > 0 && remaining < 0) {
          realized += matchQty * (exec.price - lot.price);
        } else if (lot.qty < 0 && remaining > 0) {
          realized += matchQty * (lot.price - exec.price);
        }

        matched += matchQty;
        lot.qty += Math.sign(remaining) * matchQty;
        remaining -= Math.sign(remaining) * matchQty;

        if (Math.abs(lot.qty) < 1e-8) {
          lots.shift();
        }
      }

      if (remaining !== 0) {
        lots.push({ qty: remaining, price: exec.price });
      }

      positionQty += signedQty;
      const lineCommission = exec.commission + exec.fees;
      realized -= lineCommission;

      cyclePnl += realized;
      cycleCommission += lineCommission;
      cycleExecutions.push({
        id: exec.id,
        executedAt: exec.executedAt.toISOString(),
        side: exec.side,
        quantity: exec.quantity,
        price: exec.price,
        commission: exec.commission,
        fees: exec.fees,
      });

      if (positionQty === 0 && matched > 0) {
        cycleCount += 1;
        const groupKey = `${exec.accountId}:${exec.instrumentId}:${exec.executedAt.toISOString().slice(0, 10)}:${cycleCount}`;
        result.push({
          groupKey,
          accountId: exec.accountId,
          accountCode: exec.accountCode,
          instrumentId: exec.instrumentId,
          symbol: exec.symbol,
          tradeDate: exec.executedAt.toISOString().slice(0, 10),
          openingQuantity: cycleOpeningQty,
          closingQuantity: positionQty,
          realizedPnl: cyclePnl,
          totalCommission: cycleCommission,
          executions: cycleExecutions,
        });

        cycleExecutions = [];
        cyclePnl = 0;
        cycleCommission = 0;
        cycleOpeningQty = 0;
      }
    }
  }

  return result.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1));
}
