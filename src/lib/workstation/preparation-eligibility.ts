import type { Trade } from "./types";

/** Older Flex imports classify option contracts as OTHER; do not exclude OTHER stocks. */
export function isOptionTrade(trade: Pick<Trade, "symbol" | "assetType">) {
  if (trade.assetType === "OPTION") return true;
  const match = /^([A-Z0-9.]{1,6})\s*(\d{2})(\d{2})(\d{2})[CP]\d{8}$/.exec(trade.symbol.trim().toUpperCase());
  if (!match) return false;
  const year = 2000 + Number(match[2]), month = Number(match[3]), day = Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
