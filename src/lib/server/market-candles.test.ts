import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCandlesForSymbol, summarizeCandleResponse, type Candle } from "@/lib/server/market-candles";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketCandle: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
      upsert: mocks.upsert,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function withoutAlpacaCredentials() {
  vi.stubEnv("ALPACA_API_KEY_ID", "");
  vi.stubEnv("ALPACA_API_KEY", "");
  vi.stubEnv("ALPACA_API_SECRET_KEY", "");
  vi.stubEnv("ALPACA_SECRET_KEY", "");
}

function makeCandles(start: number, count: number, interval = 300): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const price = 100 + index;
    return {
      time: start + index * interval,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price + 0.5,
      volume: 1000 + index,
    };
  });
}

function cachedRows(candles: Candle[]) {
  return candles.map((candle) => ({
    time: new Date(candle.time * 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume ?? null,
  }));
}

describe("summarizeCandleResponse", () => {
  const candles: Candle[] = [
    { time: 1_000, open: 100, high: 101, low: 99, close: 100.5 },
    { time: 1_300, open: 100.5, high: 102, low: 100, close: 101.5 },
    { time: 1_600, open: 101.5, high: 103, low: 101, close: 102.5 },
  ];

  it("returns range, interval, limit, and truncation metadata", () => {
    const metadata = summarizeCandleResponse({ candles, range: { from: 900, to: 1_700 }, limit: 3, loadedCount: 4 });

    expect(metadata.requestedRange).toEqual({ from: 900, to: 1_700 });
    expect(metadata.returnedRange).toEqual({ from: 1_000, to: 1_600 });
    expect(metadata.barIntervalSeconds).toBe(300);
    expect(metadata.limit).toBe(3);
    expect(metadata.truncated).toBe(true);
    expect(metadata.warnings).toContain("Candle response reached the bar limit.");
  });

  it("does not mark exact-limit responses as truncated without an extra loaded bar", () => {
    const metadata = summarizeCandleResponse({ candles, range: null, limit: 3, loadedCount: 3 });

    expect(metadata.truncated).toBe(false);
    expect(metadata.warnings).toEqual([]);
  });

  it("warns when data does not cover the requested range", () => {
    const metadata = summarizeCandleResponse({ candles, range: { from: -100_000, to: 100_000 }, limit: 30000 });

    expect(metadata.truncated).toBe(false);
    expect(metadata.warnings).toEqual([
      "Candle data starts after the requested range.",
      "Candle data ends before the requested range.",
    ]);
  });

  it("returns null coverage for empty candles", () => {
    const metadata = summarizeCandleResponse({ candles: [], range: null, limit: 120 });

    expect(metadata.returnedRange).toBeNull();
    expect(metadata.barIntervalSeconds).toBeNull();
    expect(metadata.truncated).toBe(false);
    expect(metadata.warnings).toEqual([]);
  });
});

describe("loadCandlesForSymbol", () => {
  it("returns an empty warning result when the external provider request fails", async () => {
    withoutAlpacaCredentials();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      candles: [],
      source: null,
      warnings: ["Yahoo candle provider unavailable; no candle data returned."],
    });
  });

  it("falls back to live provider candles when the candle cache read fails", async () => {
    withoutAlpacaCredentials();
    mocks.findMany.mockRejectedValue(new Error("database unavailable"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                timestamp: [1_783_000_000, 1_783_000_300],
                indicators: {
                  quote: [
                    {
                      open: [100, 101],
                      high: [102, 103],
                      low: [99, 100],
                      close: [101, 102],
                      volume: [1000, 1200],
                    },
                  ],
                },
              },
            ],
          },
        }),
      }),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_001_000 },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "yahoo",
      warnings: ["Candle cache unavailable; no cached candle fallback available."],
    });
    expect(result.candles).toHaveLength(2);
  });

  it("uses explicit range cache when cached candles cover the requested range", async () => {
    withoutAlpacaCredentials();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const range = { from: 1_783_000_000, to: 1_783_005_700 };
    mocks.findMany.mockResolvedValue(cachedRows(makeCandles(range.from, 20)));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range,
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "cache",
    });
    expect(result.warnings).toBeUndefined();
    expect(result.candles).toHaveLength(20);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives 15 minute candles from a covering 5 minute cache", async () => {
    withoutAlpacaCredentials();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 60);
    const range = { from: start, to: sourceCandles.at(-1)!.time };
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range,
      limit: 120,
    });

    expect(result).toMatchObject({ symbol: "DEMOA", source: "cache" });
    expect(result.candles).toHaveLength(20);
    expect(result.candles[0]).toEqual({
      time: start,
      open: 100,
      high: 103,
      low: 99,
      close: 102.5,
      volume: 3003,
    });
    expect(mocks.findMany.mock.calls.map(([args]) => args.where.timeframe)).toEqual(["15m", "5m"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses partial aggregated 15 minute cache when live providers fail", async () => {
    withoutAlpacaCredentials();
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 6);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: start + 24 * 60 * 60 },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "cache",
      warnings: ["Yahoo candle provider unavailable; showing cached candles."],
    });
    expect(result.candles).toHaveLength(2);
    expect(result.candles.map((candle) => candle.time)).toEqual([start, start + 15 * 60]);
  });

  it("retries a transient cache read failure before falling through to live providers", async () => {
    withoutAlpacaCredentials();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const range = { from: 1_783_000_000, to: 1_783_005_700 };
    mocks.findMany
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce(cachedRows(makeCandles(range.from, 20)));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range,
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "cache",
    });
    expect(result.warnings).toBeUndefined();
    expect(result.candles).toHaveLength(20);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls through to live providers when explicit range cache is only partially covered", async () => {
    withoutAlpacaCredentials();
    const range = { from: 1_783_000_000, to: 1_783_012_000 };
    mocks.findMany.mockResolvedValue(cachedRows(makeCandles(range.from + 6_000, 20)));
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            {
              timestamp: [range.from, range.from + 300, range.to],
              indicators: {
                quote: [
                  {
                    open: [100, 101, 102],
                    high: [102, 103, 104],
                    low: [99, 100, 101],
                    close: [101, 102, 103],
                    volume: [1000, 1200, 1300],
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range,
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "yahoo",
      warnings: [],
    });
    expect(result.candles).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses partial explicit range cache as a fallback when live providers fail", async () => {
    withoutAlpacaCredentials();
    const range = { from: 1_783_000_000, to: 1_783_012_000 };
    mocks.findMany.mockResolvedValue(cachedRows(makeCandles(range.from + 6_000, 20)));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range,
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "cache",
      warnings: ["Yahoo candle provider unavailable; showing cached candles."],
    });
    expect(result.candles).toHaveLength(20);
  });

  it("warns when a configured Alpaca provider returns a non-ok response", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "alpaca-key");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "alpaca-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_001_000 },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      candles: [],
      source: null,
      warnings: [
        "Alpaca candle provider unavailable; no candle data returned.",
        "Yahoo candle provider unavailable; no candle data returned.",
      ],
    });
  });

  it("returns live Alpaca candles with a warning when cache persistence fails", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "alpaca-key");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "alpaca-secret");
    mocks.createMany.mockRejectedValue(new Error("cache write failed"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bars: {
            DEMOA: [
              {
                t: "2026-06-17T13:35:00.000Z",
                o: 100,
                h: 102,
                l: 99,
                c: 101,
                v: 1000,
              },
            ],
          },
        }),
      }),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_001_000 },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "alpaca",
      warnings: ["Candle cache update failed; showing live provider candles."],
    });
    expect(result.candles).toHaveLength(1);
  });
});
