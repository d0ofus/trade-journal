import { describe, expect, it } from "vitest";
import { aggregateRegularHours, candleIdentity, regularHourPeriod, regularHourSession } from "./regular-hours";
import { executionVisibility, type VisibilityInput } from "./execution-visibility";
import { diagnoseExecution, candlePeriod } from "./execution-diagnostics";
import { fitTradeHistoryRange } from "./history";
import type { Trade } from "./types";
import { completedCandles } from "./math";
import type { Candle, Execution } from "./types";
const utc = (s: string) => Date.parse(s) / 1000;
const candle = (s: string, low = 224.13, high = 226.87): Candle => ({ time: utc(s), open: low, low, high, close: high, volume: 123 });
const fill = (s: string, price = 225.56): Execution => ({ id: s, time: utc(s), price, side: "BUY", quantity: 20, commission: 0, fees: 0, provenance: { timezoneStatus: "verified", timezone: "America/New_York", source: "test", interpretationStatus: "applied" } });
const input = (): VisibilityInput => ({ executions: [fill("2026-08-13T13:30:05Z")], candles: [candle("2026-08-13T13:30Z")], interval: "5m", session: regularHourSession, labels: "labels", replay: null, plotWidth: 100, plotHeight: 100, x: () => 50, y: () => 50 });
describe("shared execution visibility", () => {
  it("draws exact-price markers for both matching and outside-price candles", () => {
    const o = input(); expect(executionVisibility(o)[0].reason).toBe("visible");
    o.executions[0].price = 200; expect(executionVisibility(o)[0].reason).toBe("visible"); expect(executionVisibility(o)[0].diagnostic.status).toBe("price-outside");
  });
  it("distinguishes offscreen, price scale, unloaded, unavailable, session and unresolved time", () => {
    const o = input(); expect(executionVisibility({ ...o, x: () => -1 })[0].reason).toBe("outside-view");
    expect(executionVisibility({ ...o, y: () => 101 })[0].reason).toBe("outside-price-scale");
    expect(executionVisibility({ ...o, candles: [] })[0].reason).toBe("unloaded");
    expect(executionVisibility({ ...o, candles: [], covered: [{ from: o.executions[0].time - 5, to: o.executions[0].time + 10 }] })[0].reason).toBe("unavailable");
    expect(executionVisibility({ ...o, candles: [], executions: [fill("2026-08-13T12:28Z")] })[0].reason).toBe("excluded-session");
    expect(executionVisibility({ ...o, candles: [], executions: [{ ...o.executions[0], provenance: undefined }] })[0].reason).toBe("unresolved-time");
  });
  it("respects replay concealment and label modes", () => {
    const o = input(); expect(executionVisibility({ ...o, replay: o.executions[0].time - 1 })).toEqual([]);
    expect(executionVisibility({ ...o, labels: "hidden" })[0].reason).toBe("hidden");
    expect(executionVisibility({ ...o, labels: "compact" })[0].reason).toBe("visible");
  });
});
describe("market-open hourly aggregation", () => {
  it("retains five NVDA opening fills and both exits in correctly aligned candles", () => {
    const bars = [candle("2026-08-13T13:30Z"), candle("2026-08-13T14:05Z", 225.7401, 226.42), candle("2026-08-13T15:30Z", 223.76, 224.59), candle("2026-08-18T13:30Z", 219.432, 220.68)];
    const fills = [fill("2026-08-13T13:30:05Z"), fill("2026-08-13T13:30:05Z"), fill("2026-08-13T13:30:05Z"), fill("2026-08-13T14:07:01Z", 226.22), fill("2026-08-13T15:33:18Z", 224.075), fill("2026-08-18T13:30:05Z", 219.97), fill("2026-08-18T13:30:06Z", 220.0075)];
    const hours = aggregateRegularHours(bars).map(c => ({ ...c, volume: c.volume ?? 0 }));
    for (const e of fills) { expect(diagnoseExecution(e, bars, "5m", regularHourSession).status).toBe("matching"); expect(diagnoseExecution(e, hours, "1h", regularHourSession).status).toBe("matching"); }
    const o = { ...input(), executions: fills, candles: bars, x: (t: number) => t < utc("2026-08-14Z") ? 50 : 101 };
    expect(executionVisibility(o).filter(r => r.reason === "visible")).toHaveLength(5);
    expect(hours[0]).toMatchObject({ time: utc("2026-08-13T13:30Z"), open: 224.13, close: 226.42, volume: 246 });
  });
  it("uses DST rules and clips final bars on early closes without making empty candles", () => {
    expect(regularHourPeriod(utc("2026-01-05T14:30Z"))?.start).toBe(utc("2026-01-05T14:30Z"));
    expect(regularHourPeriod(utc("2026-03-09T13:30Z"))?.start).toBe(utc("2026-03-09T13:30Z"));
    const start = utc("2026-11-27T17:30Z"), end = utc("2026-11-27T18:00Z");
    expect(regularHourPeriod(start)).toEqual({ start, end });
    expect(candlePeriod(start, "1h", regularHourSession).end).toBe(end);
    expect(aggregateRegularHours([candle("2026-11-27T17:30Z"), candle("2026-11-27T18:00Z")])).toHaveLength(1);
    expect(aggregateRegularHours([candle("2026-12-25T14:30Z")])).toEqual([]);
    const bars = [candle("2026-11-27T17:30Z")]; expect(completedCandles(bars, "1h", end - 1, regularHourSession)).toEqual([]); expect(completedCandles(bars, "1h", end, regularHourSession)).toEqual(bars);
    expect(diagnoseExecution(fill("2026-11-27T18:00Z"), bars, "1h", regularHourSession).status).toBe("missing");
  });
  it("Fit requests both ends of a multi-day trade and the opening weekly candle", () => {
    const trade = { openTime: utc("2026-08-13T13:30:05Z"), closeTime: utc("2026-08-18T13:30:06Z") } as Trade;
    const fine = fitTradeHistoryRange(trade, "5m"), week = fitTradeHistoryRange(trade, "1wk");
    expect(Number.isSafeInteger(fine.from) && Number.isSafeInteger(fine.to)).toBe(true);
    expect(fine.from).toBeLessThan(trade.openTime); expect(fine.to).toBeGreaterThan(trade.closeTime);
    expect(week.from).toBeLessThan(utc("2026-08-10T04:00Z"));
  });
  it("separates regular, extended and provider identities", () => {
    expect(candleIdentity("alpaca", "1h", "regular")).toBe("alpaca:regular:session-open-5m-v1");
    expect(candleIdentity("alpaca", "1h", "extended")).toBe("alpaca:extended");
    expect(candleIdentity("yahoo", "1h", "regular")).not.toBe(candleIdentity("alpaca", "1h", "regular"));
  });
});
