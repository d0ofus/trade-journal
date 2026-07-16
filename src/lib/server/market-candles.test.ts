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

    expect(result).toMatchObject({ symbol: "DEMOA", source: "cache", cacheKind: "derived-5m" });
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
      cacheKind: "derived-5m",
      warnings: [
        "15-minute candle cache coverage is incomplete; showing the best available cached candles.",
        "Yahoo candle provider unavailable; showing cached candles.",
      ],
    });
    expect(result.candles).toHaveLength(2);
    expect(result.candles.map((candle) => candle.time)).toEqual([start, start + 15 * 60]);
  });

  it("prefers a complete derived 15 minute cache over partial native candles", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "alpaca-key");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "alpaca-secret");
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 5, 15 * 60);
    const sourceCandles = makeCandles(start, 60);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles).toHaveLength(20);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps complete native 15 minute candles when coverage matches the derived cache", async () => {
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 20, 15 * 60).map((candle) => ({
      ...candle,
      open: candle.open + 100,
    }));
    const sourceCandles = makeCandles(start, 60);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "native" });
    expect(result.candles).toHaveLength(20);
    expect(result.candles[0].open).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prefers a fresher derived cache over stale unbounded native candles", async () => {
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start - 24 * 60 * 60, 20, 15 * 60);
    const sourceCandles = makeCandles(start, 60);
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 120,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles[0].time).toBe(start);
  });

  it("prefers a denser derived cache over native candles with an interior gap", async () => {
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 21, 15 * 60).filter((_, index) => index !== 10);
    const sourceCandles = makeCandles(start, 63);
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles).toHaveLength(21);
  });

  it("prefers complete derived timestamps when unbounded native data backfills an interior gap", async () => {
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 21, 15 * 60).filter((_, index) => index !== 10);
    const sourceCandles = makeCandles(start + 15 * 60, 60);
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 120,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles).toHaveLength(20);
    expect(result.candles[0].time).toBe(start + 15 * 60);
    expect(result.candles.at(-1)!.time).toBe(nativeCandles.at(-1)!.time);
  });

  it("drops incomplete first and terminal 15 minute buckets", async () => {
    withoutAlpacaCredentials();
    const start = 1_800_000_000;
    const completeMiddle = makeCandles(start + 15 * 60, 60);
    const sourceCandles = [
      ...makeCandles(start + 5 * 60, 2),
      ...completeMiddle,
      ...makeCandles(start + 21 * 15 * 60, 2),
    ];
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: start + 21 * 15 * 60 + 5 * 60 },
      limit: 120,
    });

    expect(result.candles).toHaveLength(20);
    expect(result.candles[0].time).toBe(start + 15 * 60);
    expect(result.candles.at(-1)!.time).toBe(start + 20 * 15 * 60);
    expect(result.candles.some((candle) => candle.time === start)).toBe(false);
    expect(result.candles.some((candle) => candle.time === start + 21 * 15 * 60)).toBe(false);
  });

  it("drops a 15 minute bucket with a missing middle constituent", async () => {
    withoutAlpacaCredentials();
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 63).filter((candle) => candle.time !== start + 10 * 60);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result.candles).toHaveLength(20);
    expect(result.candles.some((candle) => candle.time === start)).toBe(false);
  });

  it("fetches farther back when discarded buckets consume the source-row limit", async () => {
    const start = 1_800_000_000;
    const completeRows = makeCandles(start, 75);
    const sourceCandles = [
      ...completeRows.filter((candle) => candle.time !== start + 22 * 15 * 60 + 5 * 60),
      ...makeCandles(start + 25 * 15 * 60, 2),
    ];
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: {
      orderBy?: { time?: "asc" | "desc" };
      take?: number;
      where?: { timeframe?: string };
    }) => {
      if (args.where?.timeframe !== "5m") return [];
      const rows = cachedRows(sourceCandles).sort((left, right) => left.time.getTime() - right.time.getTime());
      if (args.orderBy?.time === "desc") rows.reverse();
      return rows.slice(0, args.take);
    });

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 21,
    });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles).toHaveLength(21);
    expect(mocks.findMany.mock.calls.filter(([args]) => args.where.timeframe === "5m").length).toBeGreaterThan(1);
  });

  it("deduplicates and sorts 5 minute rows before exact OHLCV aggregation", async () => {
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 60);
    const duplicate = { ...sourceCandles[1] };
    const outOfOrder = [...sourceCandles.slice().reverse(), duplicate];
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(outOfOrder) : [],
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result.candles[0]).toEqual({
      time: start,
      open: 100,
      high: 103,
      low: 99,
      close: 102.5,
      volume: 3003,
    });
  });

  it("preserves zero volume and leaves aggregate volume unknown when a constituent is unknown", async () => {
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 60).map((candle, index) => ({
      ...candle,
      volume: index < 3 ? 0 : index === 4 ? undefined : candle.volume,
    }));
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: sourceCandles.at(-1)!.time },
      limit: 120,
    });

    expect(result.candles[0].volume).toBe(0);
    expect(result.candles[1].volume).toBeUndefined();
  });

  it("clips derived bars to requested starts and keeps the latest bars for bounded requests", async () => {
    const start = 1_800_000_000;
    const sourceCandles = makeCandles(start, 30);
    vi.stubGlobal("fetch", vi.fn());
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "5m" ? cachedRows(sourceCandles) : [],
    );

    const clipped = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start + 60, to: sourceCandles.at(-1)!.time },
      limit: 9,
    });
    const latest = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 2,
    });

    expect(clipped.candles).toHaveLength(9);
    expect(clipped.candles[0].time).toBe(start + 15 * 60);
    expect(latest.candles.map((candle) => candle.time)).toEqual([
      start + 8 * 15 * 60,
      start + 9 * 15 * 60,
    ]);
    const derivedRangeQuery = mocks.findMany.mock.calls.find(([args]) => args.where.timeframe === "5m" && args.where.time);
    expect(derivedRangeQuery?.[0].where.time.lte).toEqual(new Date(sourceCandles.at(-1)!.time * 1000));
  });

  it("uses provider candles with diagnostics when neither 15 minute cache covers", async () => {
    withoutAlpacaCredentials();
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 2, 15 * 60);
    const sourceCandles = makeCandles(start, 6);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      cachedRows(args.where?.timeframe === "5m" ? sourceCandles : nativeCandles),
    );
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [start, start + 15 * 60],
            indicators: { quote: [{
              open: [200, 201], high: [202, 203], low: [199, 200], close: [201, 202], volume: [10, 20],
            }] },
          }],
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: { from: start, to: start + 24 * 60 * 60 },
      limit: 120,
    });

    expect(result).toMatchObject({
      source: "yahoo",
      warnings: ["15-minute candle cache coverage is incomplete; using live provider candles."],
    });
    expect(result.candles).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a more complete partial cache when a provider returns fewer 15 minute candles", async () => {
    withoutAlpacaCredentials();
    const start = 1_800_000_000;
    const nativeCandles = makeCandles(start, 19, 15 * 60);
    mocks.findMany.mockImplementation(async (args: { where?: { timeframe?: string } }) =>
      args.where?.timeframe === "15m" ? cachedRows(nativeCandles) : [],
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: [nativeCandles.at(-1)!.time + 60 * 60],
            indicators: { quote: [{ open: [200], high: [201], low: [199], close: [200.5], volume: [10] }] },
          }],
        },
      }),
    }));

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 120,
    });

    expect(result).toMatchObject({
      source: "cache",
      cacheKind: "native",
      warnings: [
        "15-minute candle cache coverage is incomplete; showing the best available cached candles.",
        "Yahoo candle provider returned partial coverage; keeping the more complete candle cache.",
      ],
    });
    expect(result.candles).toHaveLength(19);
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
