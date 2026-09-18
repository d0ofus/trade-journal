import { missingRanges, unionRanges } from "./candle-ranges";
import { MAX_PEER_BATCH, type PeerCandleQuery, type PeerCandleResponse, type PeerSeries } from "./peers";
import type { HistoryRange } from "./history";

type Entry = { at: number; series: PeerSeries; covered: HistoryRange[] };
export type PeerFetcher = (query: PeerCandleQuery, signal: AbortSignal) => Promise<PeerCandleResponse>;
const keyOf = (query: PeerCandleQuery, symbol: string) => `${symbol}:${query.timeframe}:${query.session}:${query.adjustment}`;

/** Overlay-owned RAM only. No IndexedDB, localStorage, or server candle cache. */
export class PeerMemory {
  private entries = new Map<string, Entry>();
  private active = 0;
  private waiters: (() => void)[] = [];
  private pending = new Map<string, { query: PeerCandleQuery; work: Promise<PeerSeries[]> }>();
  constructor(private fetcher: PeerFetcher, private maximumBars = 100000, private now = () => Date.now()) {}
  get(query: PeerCandleQuery, symbol: string): PeerSeries | undefined {
    const key = keyOf(query, symbol), entry = this.entries.get(key);
    if (!entry || this.now() - entry.at > 300000 || missingRanges(query, entry.covered).length) return;
    this.entries.delete(key); this.entries.set(key, entry);
    const candles = entry.series.candles.filter(c => c.time >= query.from && c.time < query.to);
    return { ...entry.series, range: { from: query.from, to: query.to }, candles, status: candles.length ? "ready" : "empty" };
  }
  private put(query: PeerCandleQuery, series: PeerSeries) {
    if (series.status === "error") return;
    const key = keyOf(query, series.symbol), previous = this.entries.get(key);
    const old = previous && previous.series.identity === series.identity && this.now() - previous.at < 300000 ? previous : undefined;
    const rows = new Map((old?.series.candles ?? []).filter(c => c.time < query.from || c.time >= query.to).map(c => [c.time, c]));
    series.candles.forEach(c => rows.set(c.time, c));
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), series: { ...series, candles: [...rows.values()].sort((a, b) => a.time - b.time) }, covered: unionRanges([...(old?.covered ?? []), { from: query.from, to: query.to }]) });
    let count = [...this.entries.values()].reduce((n, e) => n + e.series.candles.length, 0);
    while (count > this.maximumBars || this.entries.size > 200) {
      const first = this.entries.keys().next().value!;
      count -= this.entries.get(first)!.series.candles.length; this.entries.delete(first);
    }
  }
  private async slot(signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.active >= 2) await new Promise<void>((resolve, reject) => {
      const wake = () => { signal.removeEventListener("abort", abort); this.active++; resolve(); };
      const abort = () => { this.waiters = this.waiters.filter(w => w !== wake); reject(signal.reason); };
      this.waiters.push(wake); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    else this.active++;
  }
  async load(query: PeerCandleQuery, signal: AbortSignal): Promise<PeerSeries[]> {
    signal.throwIfAborted();
    // Wait for intersecting work, then fetch only uncovered date gaps.
    const overlaps = [...this.pending.values()].filter(p => p.query.timeframe === query.timeframe && p.query.session === query.session && p.query.adjustment === query.adjustment && p.query.from < query.to && p.query.to > query.from && p.query.symbols.some(s => query.symbols.includes(s)));
    const failed = new Map<string, PeerSeries>();
    if (overlaps.length) {
      const waiting = Promise.allSettled(overlaps.map(p => p.work));
      const settled = await new Promise<Awaited<typeof waiting>>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void waiting.then(result => { signal.removeEventListener("abort", abort); resolve(result); });
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      settled.forEach(result => { if (result.status === "fulfilled") result.value.forEach(s => { if (s.status === "error" && query.symbols.includes(s.symbol)) failed.set(s.symbol, s); }); });
      // Another waiter may already have scheduled the remaining overlap while we woke.
      if ([...this.pending.values()].some(p => !overlaps.includes(p) && p.query.timeframe === query.timeframe && p.query.session === query.session && p.query.adjustment === query.adjustment && p.query.from < query.to && p.query.to > query.from && p.query.symbols.some(s => query.symbols.includes(s)))) return this.load(query, signal);
    }
    const saved = query.symbols.flatMap(s => this.get(query, s) ?? []);
    const missing = query.symbols.filter(s => !failed.has(s) && !saved.some(v => v.symbol === s));
    if (!missing.length) return [...saved, ...failed.values()];
    const initial = new Map(missing.map(symbol => [symbol, this.entries.get(keyOf(query, symbol))]));
    const batches = new Map<string, PeerCandleQuery>();
    for (const symbol of missing) {
      const entry = this.entries.get(keyOf(query, symbol));
      for (const gap of missingRanges(query, entry && this.now() - entry.at < 300000 ? entry.covered : [])) {
        const key = JSON.stringify(gap), batch = batches.get(key) ?? { ...query, ...gap, symbols: [] };
        batch.symbols.push(symbol); batches.set(key, batch);
      }
    }
    const pendingKey = JSON.stringify({ ...query, symbols: [...missing].sort() });
    const work = (async () => {
      const chunks: PeerCandleQuery[] = [];
      for (const batch of batches.values()) for (let i = 0; i < batch.symbols.length; i += MAX_PEER_BATCH) chunks.push({ ...batch, symbols: batch.symbols.slice(i, i + MAX_PEER_BATCH) });
      return (await Promise.all(chunks.map(async batch => {
        await this.slot(signal);
        try {
          signal.throwIfAborted();
          const result = await this.fetcher(batch, signal);
          signal.throwIfAborted();
          for (const series of result.series) this.put(batch, series);
          return result.series;
        } finally { this.active--; this.waiters.shift()?.(); }
      }))).flat();
    })();
    this.pending.set(pendingKey, { query, work });
    try {
      const loaded = await work;
      return [...saved, ...failed.values(), ...missing.flatMap(symbol => {
        const parts = loaded.filter(s => s.symbol === symbol), error = parts.find(s => s.status === "error");
        if (error) return error;
        const cached = this.get(query, symbol); if (cached) return cached;
        const last = parts.at(-1); if (!last) return [];
        // LRU eviction may happen before a multi-batch caller consumes its results.
        // Complete that response without retaining extra bars in the memory cache.
        const prior = initial.get(symbol);
        const old = prior && this.now() - prior.at < 300000 ? prior.series : undefined;
        if ([...parts, ...(old ? [old] : [])].some(s => s.identity !== last.identity)) return { ...last, candles: [], status: "error" as const, error: "Peer history source changed. Retry the charts." };
        const candles = [...new Map([...(old?.candles ?? []), ...parts.flatMap(s => s.candles)].filter(c => c.time >= query.from && c.time < query.to).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
        return { ...last, range: { from: query.from, to: query.to }, candles, status: candles.length ? "ready" as const : "empty" as const };
      })];
    }
    finally { if (this.pending.get(pendingKey)?.work === work) this.pending.delete(pendingKey); }
  }
  clear() { this.entries.clear(); }
}

export const fetchPeerCandles: PeerFetcher = async (query, signal) => {
  const params = new URLSearchParams({ symbols: query.symbols.join(","), timeframe: query.timeframe, session: query.session, adjustment: query.adjustment, from: String(query.from), to: String(query.to) });
  const response = await fetch(`/api/workstation/peer-candles?${params}`, { credentials: "same-origin", cache: "no-store", priority: "low", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Peer chart request failed.");
  if (!Array.isArray(body.series)) throw new Error("Invalid peer chart response.");
  return body;
};
