import type { PeerFrameSize } from "./peer-arrangement";
import type { Candle, Interval } from "./types";
import { seconds } from "./types";
import { timeAtLogical } from "./measurement-drag";

export const PEER_FRAME_MIN_WIDTH = 320;
export const PEER_FRAME_MIN_HEIGHT = 240;
export const PEER_FRAME_MAX_HEIGHT = 1200;
export const PEER_FRAME_MAX_WIDTH = 7680;
export const PEER_FRAME_GAP = 12;
export type PeerFrameRect = PeerFrameSize & { symbol: string; x: number; y: number; row: number };
export type PeerFrameLayout = { rects: PeerFrameRect[]; rows: { top: number; bottom: number; start: number; end: number }[]; height: number };

export function constrainPeerFrame(size: PeerFrameSize, available: number): PeerFrameSize {
  const maximum = Math.max(1, Math.min(PEER_FRAME_MAX_WIDTH, Math.floor(available)));
  return { width: Math.round(Math.max(Math.min(PEER_FRAME_MIN_WIDTH, maximum), Math.min(maximum, size.width))), height: Math.round(Math.max(PEER_FRAME_MIN_HEIGHT, Math.min(PEER_FRAME_MAX_HEIGHT, size.height))) };
}

/** Ordered shelf packing keeps saved order deterministic, including unequal heights. */
export function layoutPeerFrames(symbols: string[], available: number, sizes: Record<string, PeerFrameSize> = {}): PeerFrameLayout {
  const width = Math.max(1, Math.floor(available)), columns = width < 800 ? 1 : width < 1200 ? 2 : 3;
  const defaultWidth = Math.floor((width - (columns - 1) * PEER_FRAME_GAP) / columns);
  const rects: PeerFrameRect[] = [], rows: PeerFrameLayout["rows"] = [];
  let x = 0, y = 0, rowHeight = 0, start = 0;
  const closeRow = () => { rows.push({ top: y, bottom: y + rowHeight, start, end: rects.length }); y += rowHeight + PEER_FRAME_GAP; start = rects.length; x = 0; rowHeight = 0; };
  for (const symbol of symbols) {
    const saved = sizes[symbol], size = constrainPeerFrame({ width: width < 800 ? width : saved?.width ?? defaultWidth, height: saved?.height ?? 328 }, width);
    if (x && x + size.width > width) closeRow();
    rects.push({ ...size, symbol, x, y, row: rows.length });
    x += size.width + PEER_FRAME_GAP; rowHeight = Math.max(rowHeight, size.height);
  }
  if (rects.length > start) closeRow();
  return { rects, rows, height: Math.max(0, y - PEER_FRAME_GAP) };
}

/** Binary search the measured rows; retain the primary and any active gesture. */
export function visiblePeerFrames(layout: PeerFrameLayout, top: number, height: number, retained: string[] = []) {
  let lo = 0, hi = layout.rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (layout.rows[mid].bottom <= top) lo = mid + 1; else hi = mid; }
  const first = lo;
  while (lo < layout.rows.length && layout.rows[lo].top < top + height) lo++;
  const end = Math.min(layout.rows.length, lo + 1), keep = new Set(retained);
  const startIndex = layout.rows[first]?.start ?? layout.rects.length, endIndex = layout.rows[end - 1]?.end ?? startIndex;
  return layout.rects.filter((rect, index) => index >= startIndex && index < endIndex || keep.has(rect.symbol));
}

/** Beyond loaded bars these are request bounds, never fabricated candles. */
export function peerTimeAtLogical(index: number, candles: Candle[], interval: Interval) {
  if (index >= 0 || candles.length < 2) return timeAtLogical(index, candles, interval);
  const count = Math.min(100, candles.length - 1);
  const step = Math.max(seconds[interval], (candles[count].time - candles[0].time) / count);
  return Math.max(1, candles[0].time + index * step);
}
