import { Side } from "@prisma/client";

export interface ExecutionForClosed {
  id: string;
  accountId: string;
  accountCode: string;
  instrumentId: string;
  symbol: string;
  exchange?: string | null;
  assetType?: string | null;
  currency?: string | null;
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
  tradeId: string;
  groupKey: string;
  instrumentKey: string;
  accountId: string;
  accountCode: string;
  instrumentId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  openTime: string;
  closeTime: string;
  totalQuantity: number;
  avgEntryPrice: number;
  avgExitPrice: number;
  grossRealizedPnl: number;
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

interface WorkingTrade {
  accountId: string;
  accountCode: string;
  instrumentId: string;
  symbol: string;
  exchange?: string | null;
  assetType?: string | null;
  currency?: string | null;
  side: "LONG" | "SHORT";
  openTime: Date;
  openingQuantity: number;
  openingAvgCost: number;
  entryQty: number;
  entryValue: number;
  exitQty: number;
  exitValue: number;
  grossPnl: number;
  totalCommission: number;
  executions: ClosedTradeGroup["executions"];
}

const EPSILON = 1e-8;

function instrumentIdentity(input: {
  symbol: string;
  assetType?: string | null;
  currency?: string | null;
}) {
  return [input.symbol, input.assetType ?? "", input.currency ?? ""].join("|");
}

function keyFor(exec: ExecutionForClosed) {
  return `${exec.accountId}:${instrumentIdentity(exec)}`;
}

function signOf(value: number) {
  if (value > EPSILON) return 1;
  if (value < -EPSILON) return -1;
  return 0;
}

function toSide(value: number): Side {
  return value > 0 ? "BUY" : "SELL";
}

function averageCostForLots(lots: Lot[]) {
  let quantity = 0;
  let value = 0;
  for (const lot of lots) {
    quantity += Math.abs(lot.qty);
    value += Math.abs(lot.qty) * lot.price;
  }
  return quantity > EPSILON ? value / quantity : 0;
}

function stableTradeId(trade: WorkingTrade, closeTime: Date, closeCount: number) {
  const firstExecId = trade.executions[0]?.id ?? "none";
  const lastExecId = trade.executions.at(-1)?.id ?? "none";
  return [
    trade.accountId,
    trade.instrumentId,
    String(trade.openTime.getTime()),
    String(closeTime.getTime()),
    String(closeCount),
    firstExecId,
    lastExecId,
  ].join(":");
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
    const sorted = [...rows].sort((a, b) => {
      const diff = a.executedAt.getTime() - b.executedAt.getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
    const opening = openingByAccountInstrument.get(k) ?? { quantity: 0, avgCost: 0 };

    const lots: Lot[] = [];
    let positionQty = opening.quantity ?? 0;

    if (Math.abs(positionQty) > EPSILON) {
      lots.push({ qty: opening.quantity, price: opening.avgCost });
    }

    let currentTrade: WorkingTrade | null = null;
    let closeCount = 0;

    for (const exec of sorted) {
      const signedQty = exec.side === "BUY" ? exec.quantity : -exec.quantity;
      const execCharge = exec.commission + exec.fees;
      const execQty = Math.abs(exec.quantity);
      let remaining = signedQty;

      const finalizeTrade = () => {
        if (!currentTrade || currentTrade.exitQty <= EPSILON) {
          return false;
        }

        const executionSignedQty = currentTrade.executions.reduce(
          (sum, cycleExec) => sum + (cycleExec.side === "BUY" ? cycleExec.quantity : -cycleExec.quantity),
          0,
        );
        const returnedToBaseline = Math.abs(positionQty - currentTrade.openingQuantity) <= EPSILON;
        const fullyLiquidatedCarry =
          Math.abs(positionQty) <= EPSILON &&
          Math.abs(currentTrade.openingQuantity) > EPSILON &&
          Math.abs(executionSignedQty + currentTrade.openingQuantity) <= EPSILON;

        if (!returnedToBaseline && !fullyLiquidatedCarry) {
          return false;
        }

        closeCount += 1;
        const closeTime = exec.executedAt;
        let effectiveEntryQty = currentTrade.entryQty;
        let effectiveEntryValue = currentTrade.entryValue;

        if (fullyLiquidatedCarry) {
          effectiveEntryQty += Math.abs(currentTrade.openingQuantity);
          effectiveEntryValue += Math.abs(currentTrade.openingQuantity) * currentTrade.openingAvgCost;
        }

        const tradeId = stableTradeId(currentTrade, closeTime, closeCount);
        result.push({
          tradeId,
          groupKey: tradeId,
          instrumentKey: instrumentIdentity(currentTrade),
          accountId: currentTrade.accountId,
          accountCode: currentTrade.accountCode,
          instrumentId: currentTrade.instrumentId,
          symbol: currentTrade.symbol,
          side: currentTrade.side,
          openTime: currentTrade.openTime.toISOString(),
          closeTime: closeTime.toISOString(),
          totalQuantity: currentTrade.exitQty,
          avgEntryPrice: effectiveEntryQty > EPSILON ? effectiveEntryValue / effectiveEntryQty : 0,
          avgExitPrice: currentTrade.exitQty > EPSILON ? currentTrade.exitValue / currentTrade.exitQty : 0,
          grossRealizedPnl: currentTrade.grossPnl,
          tradeDate: closeTime.toISOString().slice(0, 10),
          openingQuantity: currentTrade.openingQuantity,
          closingQuantity: returnedToBaseline ? currentTrade.openingQuantity : 0,
          realizedPnl: currentTrade.grossPnl - currentTrade.totalCommission,
          totalCommission: currentTrade.totalCommission,
          executions: currentTrade.executions,
        });
        currentTrade = null;
        positionQty = lots.reduce((sum, lot) => sum + lot.qty, 0);
        if (Math.abs(positionQty) <= EPSILON) {
          positionQty = 0;
        }
        if (lots.length === 1 && Math.abs(lots[0].qty) <= EPSILON) {
          lots.length = 0;
        }
        return true;
      };

      while (Math.abs(remaining) > EPSILON) {
        if (!currentTrade) {
          const reducesExistingPosition = signOf(positionQty) !== 0 && signOf(remaining) !== signOf(positionQty);
          currentTrade = {
            accountId: exec.accountId,
            accountCode: exec.accountCode,
            instrumentId: exec.instrumentId,
            symbol: exec.symbol,
            exchange: exec.exchange,
            assetType: exec.assetType,
            currency: exec.currency,
            side: reducesExistingPosition ? (positionQty > 0 ? "LONG" : "SHORT") : signOf(remaining) > 0 ? "LONG" : "SHORT",
            openTime: exec.executedAt,
            openingQuantity: positionQty,
            openingAvgCost: averageCostForLots(lots),
            entryQty: 0,
            entryValue: 0,
            exitQty: 0,
            exitValue: 0,
            grossPnl: 0,
            totalCommission: 0,
            executions: [],
          };
        }

        const sameDirection = signOf(positionQty) === 0 || signOf(remaining) === signOf(positionQty);
        if (sameDirection) {
          const openQty = Math.abs(remaining);
          const charge = execQty > EPSILON ? execCharge * (openQty / execQty) : 0;
          lots.push({ qty: remaining, price: exec.price });
          positionQty += remaining;
          currentTrade.entryQty += openQty;
          currentTrade.entryValue += openQty * exec.price;
          currentTrade.totalCommission += charge;
          currentTrade.executions.push({
            id: exec.id,
            executedAt: exec.executedAt.toISOString(),
            side: toSide(remaining),
            quantity: openQty,
            price: exec.price,
            commission: exec.commission * (openQty / execQty),
            fees: exec.fees * (openQty / execQty),
          });
          remaining = 0;
          finalizeTrade();
          continue;
        }

        const closeQty = Math.min(Math.abs(remaining), Math.abs(positionQty));
        const closeSigned = signOf(remaining) * closeQty;
        const charge = execQty > EPSILON ? execCharge * (closeQty / execQty) : 0;

        let grossContribution = 0;
        let qtyToMatch = closeQty;
        while (qtyToMatch > EPSILON && lots.length > 0 && signOf(lots[0].qty) !== signOf(closeSigned)) {
          const lot = lots[0];
          const matchQty = Math.min(qtyToMatch, Math.abs(lot.qty));
          if (lot.qty > 0 && closeSigned < 0) {
            grossContribution += matchQty * (exec.price - lot.price);
          } else if (lot.qty < 0 && closeSigned > 0) {
            grossContribution += matchQty * (lot.price - exec.price);
          }
          lot.qty += signOf(closeSigned) * matchQty;
          qtyToMatch -= matchQty;
          if (Math.abs(lot.qty) <= EPSILON) {
            lots.shift();
          }
        }

        positionQty += closeSigned;
        remaining -= closeSigned;

        currentTrade.exitQty += closeQty;
        currentTrade.exitValue += closeQty * exec.price;
        currentTrade.grossPnl += grossContribution;
        currentTrade.totalCommission += charge;
        currentTrade.executions.push({
          id: exec.id,
          executedAt: exec.executedAt.toISOString(),
          side: toSide(closeSigned),
          quantity: closeQty,
          price: exec.price,
          commission: exec.commission * (closeQty / execQty),
          fees: exec.fees * (closeQty / execQty),
        });

        finalizeTrade();
      }
    }
  }

  return result.sort((a, b) => {
    const closeDiff = a.closeTime.localeCompare(b.closeTime);
    if (closeDiff !== 0) return closeDiff > 0 ? -1 : 1;
    if (a.tradeId === b.tradeId) return 0;
    return a.tradeId < b.tradeId ? -1 : 1;
  });
}
