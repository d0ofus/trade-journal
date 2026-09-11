import type { Trade } from "./types";
import type { WorkstationTradeFilters } from "./trade-filters";

/** Synthetic filter metadata; never reads reviews or application APIs. */
export function filterDemoTrades(trades: Trade[], filters: WorkstationTradeFilters) {
  return trades.filter(trade => {
    const date = new Date(trade.closeTime * 1000).toISOString().slice(0, 10);
    const metadata = trade.symbol === "META" ? { strategy: "Reversal", tags: ["patience", "reversal"] } : { strategy: "Breakout", tags: ["breakout", "relative strength"] };
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
      && (!filters.symbol || trade.symbol === filters.symbol)
      && (!filters.direction || trade.direction === filters.direction)
      && (!filters.account || trade.account === filters.account)
      && (!filters.tag || metadata.tags.includes(filters.tag))
      && (!filters.strategy || metadata.strategy === filters.strategy)
      && (filters.includeStale || !trade.stale);
  });
}
