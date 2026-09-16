import type { Candle, Drawing, Trade } from "./types";

/** Shares after / shares before, effective from midnight on the exchange ex-date. */
export type StockSplit = { time: number; ratio: number };
export type SplitAdjustment = { version: 1; asOf: string; splits: StockSplit[] };

export function splitPriceFactor(time: number, adjustment?: SplitAdjustment): number {
  return adjustment?.splits.reduce((factor, split) => time < split.time ? factor / split.ratio : factor, 1) ?? 1;
}

export function adjustSplitCandle<T extends Omit<Candle, "volume"> & { volume?: number }>(candle: T, adjustment: SplitAdjustment): T {
  const factor = splitPriceFactor(candle.time, adjustment);
  return { ...candle, open: candle.open * factor, high: candle.high * factor, low: candle.low * factor, close: candle.close * factor,
    ...(candle.volume === undefined ? {} : { volume: candle.volume / factor }) };
}

/** Stored executions and accounting totals are never changed. Only the chart gets this projection. */
export function splitAdjustedTrade(trade: Trade, adjustment?: SplitAdjustment): Trade {
  if (!adjustment?.splits.length) return trade;
  return { ...trade, entry: trade.entry * splitPriceFactor(trade.openTime, adjustment), exit: trade.exit * splitPriceFactor(trade.closeTime, adjustment),
    executions: trade.executions.map(execution => {
      const factor = splitPriceFactor(execution.time, adjustment);
      return factor === 1 ? execution : { ...execution, price: execution.price * factor, quantity: execution.quantity / factor,
        originalPrice: execution.price, originalQuantity: execution.quantity };
    }) };
}

/** Drawings retain raw coordinates at each anchor date, including after dragging across a split. */
export function splitAdjustedDrawing(drawing: Drawing, adjustment?: SplitAdjustment, inverse = false): Drawing {
  if (!adjustment?.splits.length) return drawing;
  return { ...drawing, points: drawing.points.map(point => {
    const factor = splitPriceFactor(point.time, adjustment);
    return { ...point, price: inverse ? point.price / factor : point.price * factor };
  }) };
}
