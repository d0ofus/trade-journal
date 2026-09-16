import type { Candle } from "./types";

export type Comparison = { candles: Candle[]; originals: Map<number, Candle>; anchor: number | null; primaryOpen: number; benchmarkOpen: number };
export function alignComparison(primary: Candle[], benchmark: Candle[], range: { from: number; to: number } | null): Comparison {
  const originals = new Map(benchmark.map(c => [c.time, c]));
  const anchor = primary.find(c => (!range || c.time >= range.from && c.time <= range.to) && c.open > 0 && (originals.get(c.time)?.open ?? 0) > 0);
  const base = anchor && originals.get(anchor.time);
  if (!anchor || !base) return { candles: [], originals, anchor: null, primaryOpen: 0, benchmarkOpen: 0 };
  return { anchor: anchor.time, primaryOpen: anchor.open, benchmarkOpen: base.open, originals,
    candles: primary.flatMap(p => { const c = originals.get(p.time); return c ? [c] : []; }) };
}

export const executionColors = (value?: { buy: string; sell: string }) => ({
  buy: /^#[a-f\d]{6}$/i.test(value?.buy ?? "") ? value!.buy : "#34d399",
  sell: /^#[a-f\d]{6}$/i.test(value?.sell ?? "") ? value!.sell : "#fb7185",
});
