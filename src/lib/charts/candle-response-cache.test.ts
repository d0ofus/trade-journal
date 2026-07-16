import { describe, expect, it } from "vitest";
import { isReusableCandleResponse } from "@/lib/charts/candle-response-cache";

const candle = {
  time: 1_718_000_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
};

describe("isReusableCandleResponse", () => {
  it("accepts a complete non-empty candle payload", () => {
    expect(isReusableCandleResponse({ candles: [candle] })).toBe(true);
    expect(isReusableCandleResponse({ candles: [candle], compare: { candles: [candle] } }, { requiresComparison: true })).toBe(true);
  });

  it.each([
    {},
    { candles: [] },
    { candles: [{ ...candle, close: Number.NaN }] },
    { candles: [candle], error: "Provider unavailable" },
    { candles: [candle], compareError: "Comparison unavailable" },
  ])("rejects transient or malformed payload %#", (payload) => {
    expect(isReusableCandleResponse(payload)).toBe(false);
  });

  it.each([
    { candles: [candle] },
    { candles: [candle], compare: null },
    { candles: [candle], compare: { candles: [] } },
  ])("rejects a missing requested comparison %#", (payload) => {
    expect(isReusableCandleResponse(payload, { requiresComparison: true })).toBe(false);
  });
});
