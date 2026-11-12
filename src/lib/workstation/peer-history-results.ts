import type { PeerSeries } from "./peers";

/** A failed expansion must retain the last valid chart, but never enable capture. */
export function peerHistoryResults(rows: PeerSeries[], previous: Record<string, PeerSeries>) {
  const values: Record<string, PeerSeries> = {}, failures: Record<string, string> = {};
  for (const row of rows) {
    const old = previous[row.symbol];
    values[row.symbol] = row.status === "error" && old?.status === "ready" ? old : row;
    if (row.status === "error") failures[row.symbol] = row.error ?? "History retrieval failed. Retry charts.";
  }
  return { values, failures };
}
