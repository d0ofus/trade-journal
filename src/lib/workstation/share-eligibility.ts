import { isOptionTrade } from "./preparation-eligibility";
import type { Trade } from "./types";

export type ShareBasis = "stock" | "etf" | "legacy-shares";
export const legacyShareDescription = "Calculated assuming share quantities";
export const metricCalculationVersion = 2;

/** Presentation compatibility only. Never changes broker classifications or accounting. */
export function shareEligibility(trade: Pick<Trade, "symbol" | "assetType">): ShareBasis | null {
  const assetType = trade.assetType?.trim().toUpperCase();
  if (isOptionTrade({ ...trade, assetType })) return null;
  if (assetType === "STOCK") return "stock";
  if (assetType === "ETF") return "etf";
  return !assetType || assetType === "OTHER" ? "legacy-shares" : null;
}

export const metricIdentity = (trade: Pick<Trade, "id" | "symbol" | "currency" | "assetType" | "timeInterpretationVersion">) =>
  `${trade.id}:${trade.symbol}:${trade.currency}:${trade.timeInterpretationVersion}:${shareEligibility(trade) ?? "unsupported"}:v${metricCalculationVersion}`;
