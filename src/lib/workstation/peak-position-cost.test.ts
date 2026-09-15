import { describe, expect, it } from "vitest";
import { formatPeakPositionCost, peakPositionCost } from "./peak-position-cost";
import type { Execution, Trade } from "./types";
const fill = (side: Execution["side"], quantity: number, price: number): Execution => ({ id: "allocated", time: 1, side, quantity, price, commission: 99, fees: 3 });
const cost = (executions: Execution[], direction: Trade["direction"] = "LONG") => peakPositionCost({ executions, direction, assetType: "STOCK" });
describe("peak position cost", () => {
  it("formats the native currency with two decimals and no conversion", () => {
    expect(formatPeakPositionCost(2200, "USD")).toBe("$2,200.00");
    expect(formatPeakPositionCost(2200, "EUR")).toBe("€2,200.00");
    expect(formatPeakPositionCost(2200, "JPY")).toBe("¥2,200.00");
  });
  it("includes both scale-ins and excludes profitable exit proceeds and fees", () => {
    expect(cost([fill("BUY", 100, 10), fill("BUY", 100, 12), fill("SELL", 200, 30)]).value).toBe(2200);
  });
  it("consumes FIFO lots on a partial exit before adding new shares", () => {
    expect(cost([fill("BUY", 100, 10), fill("BUY", 100, 12), fill("SELL", 100, 99), fill("BUY", 100, 11), fill("SELL", 200, 13)]).value).toBe(2300);
  });
  it("reports positive entry cost for shorts without using the cover price", () => {
    expect(cost([fill("SELL", 100, 10), fill("SELL", 100, 12), fill("BUY", 200, 40)], "SHORT").value).toBe(2200);
  });
  it("uses fractional allocated quantities without rounding to whole shares", () => {
    expect(cost([fill("BUY", .1, 10), fill("BUY", .2, 12), fill("SELL", .3, 50)]).value).toBeCloseTo(3.4);
  });
  it("does not sum separate position cycles", () => {
    expect(cost([fill("BUY", 100, 10), fill("SELL", 100, 20), fill("BUY", 100, 12)]).value).toBe(1200);
  });
  it("uses only the quantity allocated to a reversal's trade", () => {
    expect(cost([fill("BUY", 10, 10), fill("SELL", 10, 12)]).value).toBe(100);
    expect(cost([fill("SELL", 5, 12), fill("BUY", 5, 11)], "SHORT").value).toBe(60);
  });
  it.each([[], [fill("SELL", 100, 12)], [fill("BUY", 10, 10), fill("SELL", 11, 12)], [fill("BUY", NaN, 10)], [fill("BUY", 10, Infinity)], [fill("BUY", -1, 10)]])("marks missing or invalid entry history unavailable", (...executions) => {
    expect(cost(executions as Execution[]).value).toBeNull();
  });
  it("requires verified share units or a contract multiplier", () => {
    expect(peakPositionCost({ executions: [fill("BUY", 1, 10)], direction: "LONG", assetType: "OPTION" }).value).toBeNull();
  });
});
