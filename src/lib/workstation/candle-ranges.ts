/** Candle coverage uses half-open UTC-second ranges, independently of candle presence. */
export type CandleRange = { from: number; to: number };
export function unionRanges(ranges: CandleRange[]): CandleRange[] {
  const result: CandleRange[] = [];
  for (const range of ranges.filter(r => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to > r.from).sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
  }
  return result;
}
export function missingRanges(requested: CandleRange, covered: CandleRange[]): CandleRange[] {
  const missing: CandleRange[] = []; let cursor = requested.from;
  for (const r of unionRanges(covered)) {
    if (r.to <= cursor || r.from >= requested.to) continue;
    if (r.from > cursor) missing.push({ from: cursor, to: Math.min(r.from, requested.to) });
    cursor = Math.max(cursor, r.to);
  }
  if (cursor < requested.to) missing.push({ from: cursor, to: requested.to });
  return missing;
}
export const intersectRange = (a: CandleRange, b: CandleRange): CandleRange | null => {
  const from = Math.max(a.from, b.from), to = Math.min(a.to, b.to);
  return to > from ? { from, to } : null;
};
export type CandleCacheMetadata = {
  enabled: boolean;
  status: "hit" | "partial" | "miss" | "refreshing";
  covered: CandleRange[];
  missing: CandleRange[];
  refresh: CandleRange[];
  effectiveRange: CandleRange;
  retryAfterMs?: number;
  /** This response committed a verified window, including a successful empty query. */
  progressed?: boolean;
  persistencePaused?: boolean;
  /** Successfully fetched in this response, but NOT durably covered. */
  temporary?: CandleRange[];
  timings?: CandleTimings;
};
export type CandleTimings = { cacheReadMs: number; providerFetchMs: number; persistenceMs: number; queueWaitMs?: number; storageCheckMs?: number; providerRequestCount?: number };
