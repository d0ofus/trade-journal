import type { CandleResult } from "./types";
import { intersectRange, missingRanges, unionRanges, type CandleRange } from "./candle-ranges";

/** Bounded, overlapping range cache. Provider identities are never merged. */
export class CandleMemory {
  private entries = new Map<string, { at: number; base: string; result: CandleResult }>();
  constructor(private now = () => Date.now(), private maximumBars = 100_000) {}
  put(base: string, incoming: CandleResult) {
    if (!incoming.identity || !incoming.cache?.enabled || incoming.truncated) return;
    const key = `${base}:${incoming.identity}`, previous = this.entries.get(key);
    const old = previous && this.now() - previous.at < 300_000 ? previous.result : null;
    const rows = new Map((old?.candles ?? []).map(c => [c.time, c]));
    // A verified provider refresh may remove corrected/deleted bars.
    for (const range of incoming.cache.covered) for (const time of rows.keys()) if (time >= range.from && time < range.to) rows.delete(time);
    incoming.candles.forEach(c => rows.set(c.time, c));
    const result = { ...incoming, candles: [...rows.values()].sort((a, b) => a.time - b.time), cache: { ...incoming.cache, covered: unionRanges([...(old?.cache?.covered ?? []), ...incoming.cache.covered]) } };
    this.entries.delete(key); this.entries.set(key, { base, result, at: this.now() });
    let count = [...this.entries.values()].reduce((sum, v) => sum + v.result.candles.length, 0);
    while (this.entries.size > 48 || count > this.maximumBars) { const first = this.entries.keys().next().value!; count -= this.entries.get(first)!.result.candles.length; this.entries.delete(first); }
  }
  get(base: string, range: CandleRange, identity?: string): CandleResult | null {
    const entry = [...this.entries.values()].reverse().find(e => e.base === base && (!identity || e.result.identity === identity) && this.now() - e.at < 300_000);
    if (!entry?.result.cache) return null;
    const r = entry.result, covered = r.cache!.covered.map(c => intersectRange(c, range)).filter((c): c is CandleRange => !!c);
    const missing = missingRanges(range, covered), refresh = r.cache!.refresh.map(c => intersectRange(c, range)).filter((c): c is CandleRange => !!c);
    return { ...r, candles: r.candles.filter(c => c.time >= range.from && c.time < range.to), cache: { ...r.cache!, covered, missing, refresh, status: missing.length ? "partial" : refresh.length ? "refreshing" : "hit", effectiveRange: range } };
  }
}
