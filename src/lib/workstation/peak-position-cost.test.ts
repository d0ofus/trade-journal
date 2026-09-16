import { describe, expect, it } from "vitest";
import { formatPeakPositionCost, peakPositionCost } from "./peak-position-cost";
import type { Execution, Trade } from "./types";
const fill = (side: Execution["side"], quantity: number, price: number): Execution => ({ id: "allocated", time: 1, side, quantity, price, commission: 99, fees: 3 });
const cost = (executions: Execution[], direction: Trade["direction"] = "LONG", average?: number) => {
  const entries = executions.filter(e => e.side === (direction === "LONG" ? "BUY" : "SELL"));
  const entry = average ?? entries.reduce((sum, e) => sum + e.price * e.quantity, 0) / entries.reduce((sum, e) => sum + e.quantity, 0);
  return peakPositionCost({ executions, direction, assetType: "STOCK", symbol: "IE", entry });
};
describe("max notional", () => {
  it("formats the native currency with two decimals and no conversion", () => {
    expect(formatPeakPositionCost(2200, "USD")).toBe("$2,200.00");
    expect(formatPeakPositionCost(2200, "EUR")).toBe("€2,200.00");
    expect(formatPeakPositionCost(2200, "JPY")).toBe("¥2,200.00");
  });
  it("includes both scale-ins and excludes profitable exit proceeds and fees", () => {
    expect(cost([fill("BUY", 100, 10), fill("BUY", 100, 12), fill("SELL", 200, 30)]).value).toBe(2200);
  });
  it("multiplies maximum simultaneous shares by the whole trade average entry", () => {
    expect(cost([fill("BUY", 100, 10), fill("BUY", 100, 12), fill("SELL", 100, 99), fill("BUY", 100, 11), fill("SELL", 200, 13)]).value).toBe(2200);
  });
  it("reports positive entry cost for shorts without using the cover price", () => {
    expect(cost([fill("SELL", 100, 10), fill("SELL", 100, 12), fill("BUY", 200, 40)], "SHORT").value).toBe(2200);
  });
  it("uses fractional allocated quantities without rounding to whole shares", () => {
    expect(cost([fill("BUY", .1, 10), fill("BUY", .2, 12), fill("SELL", .3, 50)]).value).toBeCloseTo(3.4);
  });
  it("does not sum separate position cycles", () => {
    expect(cost([fill("BUY", 100, 10), fill("SELL", 100, 20), fill("BUY", 100, 12)]).value).toBe(1100);
  });
  it("uses only the quantity allocated to a reversal's trade", () => {
    expect(cost([fill("BUY", 10, 10), fill("SELL", 10, 12)]).value).toBe(100);
    expect(cost([fill("SELL", 5, 12), fill("BUY", 5, 11)], "SHORT").value).toBe(60);
  });
  it.each([[], [fill("SELL", 100, 12)], [fill("BUY", 10, 10), fill("SELL", 11, 12)], [fill("BUY", NaN, 10)], [fill("BUY", 10, Infinity)], [fill("BUY", -1, 10)]])("marks missing or invalid entry history unavailable", (...executions) => {
    expect(cost(executions as Execution[]).value).toBeNull();
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid displayed average entry %s", average => {
    expect(cost([fill("BUY", 1, 10)], "LONG", average).reason).toContain("average entry price");
  });
  it("requires entry history even for tiny fractional exits", () => {
    expect(cost([fill("SELL", 1e-10, 10)], "LONG", 10).reason).toContain("history is incomplete");
  });
  it("excludes contract products", () => {
    expect(peakPositionCost({ executions: [fill("BUY", 1, 10)], direction: "LONG", assetType: "OPTION", symbol: "IE", entry: 10 }).value).toBeNull();
  });
});
