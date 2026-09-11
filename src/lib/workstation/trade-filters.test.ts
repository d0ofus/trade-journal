import { describe, expect, it } from "vitest";
import { demoTrades } from "./demo";
import { filterDemoTrades } from "./demo-filters";
import { filterDateSummary, normalizeWorkstationFilters, quickTradeRange, tradeFilterCount, tradeFilterError, tradeFilterHref } from "./trade-filters";

describe("workstation trade filters", () => {
  it("normalizes URL aliases and user input without accepting array parameters", () => {
    expect(normalizeWorkstationFilters({ symbol: " nvda ", side: "buy", tag: "#Breakout", account: " Demo ", includeStale: "on", from: ["2026-09-09"] })).toEqual({ symbol: "NVDA", direction: "LONG", tag: "breakout", account: "Demo", includeStale: true });
  });
  it("validates real calendar dates and accepts open-ended and single-day ranges", () => {
    for (const filters of [{ from: "2026-09-09" }, { to: "2026-09-09" }, { from: "2024-02-29", to: "2024-02-29" }, {}]) expect(tradeFilterError(filters)).toBe("");
    for (const filters of [{ from: "2026-02-29" }, { to: "invalid" }, { from: "2026-09-10", to: "2026-09-09" }, { direction: "bad" }]) expect(tradeFilterError(filters)).not.toBe("");
  });
  it("preserves quick date meanings and clamps month ends", () => {
    const now = new Date(2026, 8, 11, 12);
    expect(quickTradeRange("5D", now)).toEqual({ from: "2026-09-07", to: "2026-09-11" });
    expect(quickTradeRange("2W", now).from).toBe("2026-08-28");
    expect(quickTradeRange("1M", new Date(2026, 2, 31, 12)).from).toBe("2026-02-28");
    expect(quickTradeRange("1Y", now).from).toBe("2025-09-11");
  });
  it("serializes shareable filters and selected trade without a pagination or journal-entry token", () => {
    const url = new URL(tradeFilterHref("/trades", { symbol: "NVDA", tag: "a&b", includeStale: true }, "trade:a/b"), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({ symbol: "NVDA", tag: "a&b", includeStale: "1", groupKey: "trade:a/b" });
    expect(tradeFilterHref("/trades", {}, "")).toBe("/trades");
  });
  it("counts a date range once and does not describe an open boundary as All time", () => {
    expect(tradeFilterCount({ from: "2026-09-08", to: "2026-09-09", direction: "LONG" })).toBe(2);
    expect(filterDateSummary({ from: "2026-09-08" })).toBe("From 2026-09-08");
    expect(filterDateSummary({ to: "2026-09-09" })).toBe("Through 2026-09-09");
  });
  it("combines demo dates, direction, account, tags and strategy, including empty and stale results", () => {
    expect(filterDemoTrades(demoTrades, { from: "2026-09-08", to: "2026-09-08", direction: "SHORT", strategy: "Breakout", tag: "breakout" }).map(t => t.symbol)).toEqual(["TSLA"]);
    expect(filterDemoTrades(demoTrades, { symbol: "MISSING" })).toHaveLength(0);
    expect(filterDemoTrades(demoTrades, { account: "Swing · Demo", tag: "patience" }).map(t => t.symbol)).toEqual(["META"]);
    expect(filterDemoTrades([{ ...demoTrades[0], stale: true }], {})).toHaveLength(0);
    expect(filterDemoTrades([{ ...demoTrades[0], stale: true }], { includeStale: true })).toHaveLength(1);
  });
});
