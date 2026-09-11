import { describe, expect, it } from "vitest";
import { candlePeriod, diagnoseExecution, executionDiagnosticSummary } from "./execution-diagnostics";
import { diagnosticComparisonCandles, diagnosticDemoTrade } from "./diagnostic-demo";
import type { Candle, CandleSession, Execution } from "./types";
const ny: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "regular" };
const at = (value: string) => Date.parse(value) / 1000;
const fill = (time: string, price = 10): Execution => ({ id: "fill", time: at(time), side: "SELL", quantity: 6, price, commission: 0, fees: 0 });
const bar = (time: string): Candle => ({ time: at(time), open: 10, high: 11, low: 9, close: 10, volume: 100 });

describe("deterministic execution diagnostics", () => {
  it("reproduces MU's price mismatch without searching for a price-fitting offset", () => {
    const execution = diagnosticDemoTrade.executions[1], before = JSON.stringify(execution);
    const result = diagnoseExecution(execution, diagnosticComparisonCandles, "5m", ny);
    expect(result.status).toBe("price-outside"); expect(result.candle?.time).toBe(at("2026-09-08T15:05:00Z"));
    expect(result.distance).toBeCloseTo(6.68001465); expect(result.timezoneUnverified).toBe(true);
    expect(JSON.stringify(execution)).toBe(before);
    expect(diagnoseExecution({ ...execution, time: execution.time + 4 * 3600 }, diagnosticComparisonCandles, "5m", ny).status).toBe("matching");
  });
  it("uses half-open candle intervals and never fills missing intervals with nearest bars", () => {
    const candles = [bar("2026-09-08T15:00:00Z"), bar("2026-09-08T15:10:00Z")];
    expect(diagnoseExecution(fill("2026-09-08T15:04:59Z"), candles, "5m", ny).status).toBe("matching");
    expect(diagnoseExecution(fill("2026-09-08T15:05:00Z"), candles, "5m", ny).status).toBe("missing");
    expect(diagnoseExecution(fill("2026-09-08T15:10:00Z"), candles, "5m", ny).candle).toBe(candles[1]);
  });
  it("clips regular-session hourly candles at market close, including early closes", () => {
    const candles = [bar("2026-11-27T17:30:00Z")];
    expect(diagnoseExecution(fill("2026-11-27T17:59:59Z"), candles, "1h", ny).period?.end).toBe(at("2026-11-27T18:00:00Z"));
    expect(diagnoseExecution(fill("2026-11-27T18:00:00Z"), candles, "1h", ny).status).toBe("missing");
  });
  it("matches daily session dates, including premarket, rather than the preceding day's candle", () => {
    const candles = [bar("2026-09-03T13:30:00Z"), bar("2026-09-04T13:30:00Z")];
    expect(diagnoseExecution(fill("2026-09-04T12:00:00Z"), candles, "1d", ny).candle).toBe(candles[1]);
    expect(diagnoseExecution(fill("2026-09-05T12:00:00Z"), candles, "1d", ny).status).toBe("missing");
    expect(diagnoseExecution(fill("2026-09-04T12:00:00Z"), candles, "5m", ny).status).toBe("missing");
  });
  it("uses calendar boundaries across both daylight-saving changes", () => {
    expect(candlePeriod(at("2026-03-08T16:00:00Z"), "1d", ny)).toMatchObject({ start: at("2026-03-08T05:00:00Z"), end: at("2026-03-09T04:00:00Z") });
    expect(candlePeriod(at("2026-11-01T16:00:00Z"), "1d", ny)).toMatchObject({ start: at("2026-11-01T04:00:00Z"), end: at("2026-11-02T05:00:00Z") });
  });
  it("matches holiday-shifted weekly bars by their exchange calendar week", () => {
    const candle = bar("2026-09-08T13:30:00Z");
    expect(diagnoseExecution(fill("2026-09-11T15:00:00Z"), [candle], "1wk", ny).candle).toBe(candle);
    expect(diagnoseExecution(fill("2026-09-14T15:00:00Z"), [candle], "1wk", ny).status).toBe("missing");
  });
  it("keeps source-timezone uncertainty separate from a price match and distinguishes unknown candle conventions", () => {
    const result = diagnoseExecution(fill("2026-09-08T15:02:00Z"), [bar("2026-09-08T15:00:00Z")], "5m", ny);
    expect(result.status).toBe("matching"); expect(executionDiagnosticSummary([result])).toContain("source timezone unverified");
    expect(diagnoseExecution({ ...result.execution, provenance: { source: "fixture", timezone: "UTC", timezoneStatus: "verified" } }, [bar("2026-09-08T00:00:00Z")], "1d").periodUnverified).toBe(true);
  });
  it("tolerates floating-point noise without hiding real price discrepancies", () => {
    const candles = [bar("2026-09-08T15:00:00Z")];
    expect(diagnoseExecution(fill("2026-09-08T15:02:00Z", 11.00000001), candles, "5m", ny).status).toBe("matching");
    expect(diagnoseExecution(fill("2026-09-08T15:02:00Z", 11.01), candles, "5m", ny).status).toBe("price-outside");
  });
});
