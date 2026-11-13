import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { aggregateCandles } from "./market-candles";
import { aggregateRegularHours } from "@/lib/workstation/regular-hours";

it("preserves reported zero and unreported volume through indicator-compatible aggregation", () => {
  const start = Date.parse("2026-09-23T13:30:00Z") / 1000;
  const bars = [0, 300].map(offset => ({ time: start + offset, open: 10, high: 11, low: 9, close: 10, volume: 0 as number | undefined }));
  for (const aggregate of [(rows: typeof bars) => aggregateCandles(rows, 600), aggregateRegularHours]) {
    expect(aggregate(bars)[0].volume).toBe(0);
    expect(aggregate([bars[0], { ...bars[1], volume: undefined }])[0].volume).toBeUndefined();
    expect(aggregate([{ ...bars[0], volume: undefined }, bars[1]])[0].volume).toBeUndefined();
  }
});
