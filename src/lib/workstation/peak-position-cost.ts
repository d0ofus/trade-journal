import type { Trade } from "./types";

const EPSILON = 1e-8;
export const peakCostDescription = "Maximum entry cost of the position held at one time, excluding fees.";
export type PeakPositionCost = { value: number | null; reason?: string };
const currencies = new Map<string, Intl.NumberFormat>();
export function formatPeakPositionCost(value: number, currency: string) {
  const unit = currency || "USD";
  let formatter = currencies.get(unit);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: unit, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    currencies.set(unit, formatter);
  }
  return formatter.format(value);
}

/** The allocated trade rows are already in canonical execution order. */
export function peakPositionCost(trade: Pick<Trade, "direction" | "executions" | "assetType">): PeakPositionCost {
  if (trade.assetType && !["STOCK", "ETF"].includes(trade.assetType)) {
    return { value: null, reason: "Peak position cost is unavailable for instruments without a verified share or contract multiplier." };
  }
  const unavailable = { value: null, reason: "Peak position cost is unavailable because the entry history is incomplete or invalid." };
  if (!trade.executions.length) return unavailable;
  const entrySide = trade.direction === "SHORT" ? "SELL" : "BUY";
  const lots: { quantity: number; price: number }[] = [];
  let first = 0, quantity = 0, cost = 0, peak = 0;
  for (const execution of trade.executions) {
    const q = execution.quantity, price = execution.price;
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(price) || price <= 0) return unavailable;
    if (execution.side === entrySide) {
      lots.push({ quantity: q, price });
      quantity += q;
      cost += q * price;
      if (!Number.isFinite(cost)) return unavailable;
      peak = Math.max(peak, cost);
    } else {
      // With a complete, zero-baseline cycle the accounting matcher consumes FIFO
      // trade lots. A carry-only exit cannot be reconstructed from these rows.
      if (q > quantity + EPSILON) return unavailable;
      let remaining = Math.min(q, quantity);
      while (remaining > EPSILON && first < lots.length) {
        const lot = lots[first], matched = Math.min(remaining, lot.quantity);
        cost -= matched * lot.price;
        lot.quantity -= matched;
        remaining -= matched;
        if (lot.quantity <= EPSILON) first++;
      }
      quantity = Math.max(0, quantity - q);
      if (quantity <= EPSILON) cost = 0;
    }
  }
  return { value: peak };
}
