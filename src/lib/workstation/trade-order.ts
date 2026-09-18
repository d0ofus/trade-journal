import type { Trade } from "./types";

/** The sidebar headings display openTime after execution-time interpretation. */
export function newestTradesFirst(trades: readonly Trade[]): Trade[] {
  return [...trades].sort((a, b) => b.openTime - a.openTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
