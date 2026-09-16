import { expect, it } from "vitest";
import { adjustSplitCandle, splitAdjustedDrawing, splitAdjustedTrade, splitPriceFactor, type SplitAdjustment } from "./split-adjustment";
import type { Drawing, Trade } from "./types";
import { movingAverage, volumeMovingAverage } from "./math";
const time = Date.parse("2026-07-02T04:00:00Z") / 1000;
const adjustment: SplitAdjustment = { version: 1, asOf: "2026-09-16", splits: [{ time, ratio: 4 }] };
it("removes a four-for-one gap from OHLCV, SMAs and zero-volume bars at the ex-date boundary", () => {
  const original = { time: time - 86400, open: 760, high: 800, low: 720, close: 780, volume: 100 };
  const first = adjustSplitCandle(original, adjustment);
  expect(first).toEqual({ time: original.time, open: 190, high: 200, low: 180, close: 195, volume: 400 });
  const second = adjustSplitCandle({ time, open: 195, high: 200, low: 190, close: 196, volume: 0 }, adjustment);
  expect(second.close).toBe(196); expect(second.volume).toBe(0);
  expect(movingAverage([first, second], 2)[0].value).toBe(195.5);
  expect(volumeMovingAverage([first, second], 2)[0].value).toBe(200);
  expect(original.close).toBe(780); expect(original.volume).toBe(100);
});
it("compounds multiple and reverse splits without changing timestamps", () => {
  const basis: SplitAdjustment = { ...adjustment, splits: [{ time: time - 10, ratio: 4 }, { time, ratio: .1 }] };
  expect(splitPriceFactor(time - 11, basis)).toBe(2.5);
  expect(splitPriceFactor(time - 5, basis)).toBe(10);
  expect(splitPriceFactor(time, basis)).toBe(1);
});
it("projects pre-split executions and round-trips drawn anchors without changing original records", () => {
  const trade = { entry: 760, exit: 195, openTime: time - 100, closeTime: time + 100, executions: [{ id: "entry", time: time - 100, price: 760, quantity: 1.25 }, { id: "exit", time: time + 100, price: 195, quantity: 5 }] } as Trade;
  const displayed = splitAdjustedTrade(trade, adjustment);
  expect(displayed.executions[0]).toMatchObject({ price: 190, quantity: 5, originalPrice: 760, originalQuantity: 1.25 });
  expect(displayed.executions[1]).toEqual(trade.executions[1]);
  expect(trade.executions[0].price).toBe(760);
  const drawing = { points: [{ time: time - 100, price: 760 }, { time: time + 100, price: 195 }] } as Drawing;
  const projected = splitAdjustedDrawing(drawing, adjustment);
  expect(projected.points.map(p => p.price)).toEqual([190, 195]);
  expect(splitAdjustedDrawing(projected, adjustment, true)).toEqual(drawing);
  projected.points[0].time = time + 1;
  expect(splitAdjustedDrawing(projected, adjustment, true).points[0].price).toBe(190);
});
