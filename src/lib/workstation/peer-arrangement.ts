import type { Drawing } from "./types";

export type PeerArrangement = { order: string[]; hidden: string[] };
export type PeerComparisonState = {
  drawings: Record<string, Drawing[]>;
  arrangements: Record<string, PeerArrangement>;
};
export const emptyPeerComparison = (): PeerComparisonState => ({ drawings: {}, arrangements: {} });

/** Removed memberships are never resurrected; their saved annotations are independent. */
export function arrangePeers<T extends { ticker: string }>(members: T[], arrangement?: PeerArrangement, search = "") {
  const available = new Map(members.map(m => [m.ticker, m]));
  const order = [...new Set(arrangement?.order ?? [])].filter(symbol => available.has(symbol));
  order.push(...[...available.keys()].filter(symbol => !order.includes(symbol)).sort((a, b) => a.localeCompare(b)));
  const hidden = new Set(arrangement?.hidden ?? []), needle = search.trim().toUpperCase();
  return order.filter(symbol => !hidden.has(symbol) && (!needle || symbol.toUpperCase().includes(needle))).map(symbol => available.get(symbol)!);
}

export function movePeer(order: string[], symbol: string, target: string) {
  if (symbol === target || !order.includes(symbol) || !order.includes(target)) return order;
  const result = order.filter(value => value !== symbol);
  result.splice(order.indexOf(target), 0, symbol);
  return result;
}
