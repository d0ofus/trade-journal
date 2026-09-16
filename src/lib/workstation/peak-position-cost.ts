import type { Trade } from "./types";
import { shareEligibility, legacyShareDescription } from "./share-eligibility";

export const peakCostDescription = "Maximum shares held simultaneously multiplied by the displayed average entry price, excluding fees.";
export type PeakPositionCost = { value: number | null; reason?: string; basis?: string };
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
export function peakPositionCost(trade: Pick<Trade, "direction" | "executions" | "assetType" | "symbol" | "entry">): PeakPositionCost {
  const eligibility = shareEligibility(trade);
  if (!eligibility) return { value: null, reason: "Max notional is unavailable for non-share instruments and option contracts." };
  const basis = eligibility === "legacy-shares" ? legacyShareDescription : undefined;
  if (!Number.isFinite(trade.entry) || trade.entry <= 0) return { value: null, basis, reason: "Max notional is unavailable because the average entry price is invalid." };
  const incomplete = { value: null, basis, reason: "Max notional is unavailable because the allocated entry history is incomplete." };
  const invalid = { value: null, basis, reason: "Max notional is unavailable because an allocated quantity is invalid." };
  if (!trade.executions.length) return incomplete;
  const entrySide = trade.direction === "SHORT" ? "SELL" : "BUY";
  let quantity = 0, peak = 0;
  for (const execution of trade.executions) {
    const q = execution.quantity;
    if (!Number.isFinite(q) || q <= 0) return invalid;
    if (!["BUY", "SELL"].includes(execution.side)) return incomplete;
    if (execution.side === entrySide) quantity += q;
    else {
      if (quantity <= 0 || q - quantity > Math.max(q, quantity) * Number.EPSILON * 16) return incomplete;
      quantity = Math.max(0, quantity - q);
    }
    if (!Number.isFinite(quantity)) return invalid;
    peak = Math.max(peak, quantity);
  }
  const value = peak * trade.entry;
  return Number.isFinite(value) ? { value, basis } : { value: null, basis, reason: "Max notional exceeds the supported numeric range." };
}
