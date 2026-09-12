import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import type { Candle, CandleTimeframe } from "./market-candles";
import type { CandleRange } from "@/lib/workstation/candle-ranges";

export const cacheHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type CacheSegment = CandleRange & { at: number };
export function validateCandles(rows: Candle[]): Candle[] {
  const result = new Map<number, Candle>();
  for (const c of rows) {
    if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) || c.time <= 0 ||
      c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) ||
      (c.volume !== undefined && (!Number.isFinite(c.volume) || c.volume < 0))) throw new Error("Invalid OHLCV response; cache preserved.");
    result.set(c.time, c);
  }
  return [...result.values()].sort((a, b) => a.time - b.time);
}
export function encodeCandles(rows: Candle[]) {
  const raw = Buffer.from(JSON.stringify(validateCandles(rows).map(c => [c.time, c.open, c.high, c.low, c.close, c.volume ?? null])));
  return { payload: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }), checksum: cacheHash(raw) };
}
export function decodeCandles(payload: Uint8Array, checksum: string, version = 1): Candle[] {
  if (version !== 1) throw new Error("Unsupported candle cache encoding.");
  const raw = brotliDecompressSync(payload, { maxOutputLength: 4_000_000 });
  if (cacheHash(raw) !== checksum) throw new Error("Candle cache checksum mismatch.");
  const rows: unknown = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(rows)) throw new Error("Invalid candle cache.");
  return validateCandles(rows.map(row => {
    if (!Array.isArray(row) || row.length !== 6 || row.slice(0, 5).some(v => typeof v !== "number") || (row[5] !== null && typeof row[5] !== "number")) throw new Error("Invalid candle cache row.");
    return { time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] ?? undefined };
  }));
}
export function candleChunkRange(time: number, timeframe: CandleTimeframe): CandleRange {
  if (timeframe === "1d" || timeframe === "1wk") {
    const year = new Date(time * 1000).getUTCFullYear();
    return { from: Date.UTC(year, 0, 1) / 1000, to: Date.UTC(year + 1, 0, 1) / 1000 };
  }
  const from = Math.floor(time / 86400) * 86400;
  return { from, to: from + 86400 };
}
export function candleChunks(range: CandleRange, timeframe: CandleTimeframe): CandleRange[] {
  const chunks: CandleRange[] = [];
  for (let from = range.from; from < range.to;) { const chunk = candleChunkRange(from, timeframe); chunks.push(chunk); from = chunk.to; }
  return chunks;
}
/** Replace verification timestamps only inside the newly fetched range. */
export function replaceSegments(previous: CacheSegment[], next: CacheSegment): CacheSegment[] {
  const rows = previous.flatMap(s => s.to <= next.from || s.from >= next.to ? [s] : [
    ...(s.from < next.from ? [{ ...s, to: next.from }] : []),
    ...(s.to > next.to ? [{ ...s, from: next.to }] : []),
  ]).concat(next).sort((a, b) => a.from - b.from);
  const merged: CacheSegment[] = [];
  for (const row of rows) { const last = merged.at(-1); if (last && last.to === row.from && last.at === row.at) last.to = row.to; else merged.push(row); }
  return merged;
}
