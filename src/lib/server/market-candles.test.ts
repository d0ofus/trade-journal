import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCandlesForSymbol, summarizeCandleResponse, type Candle } from "@/lib/server/market-candles";
import { expectedUsEquitiesBarStarts } from "@/lib/server/market-session-calendar";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  instrumentFindMany: vi.fn(),
  createMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    instrument: {
      findMany: mocks.instrumentFindMany,
    },
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
  mocks.instrumentFindMany.mockResolvedValue([]);
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

function makeCandlesAt(times: number[]): Candle[] {
  return times.map((time, index) => ({
    time,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1000 + index,
  }));
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

function resolveAsUsEquity(exchange = "NASDAQ") {
  mocks.instrumentFindMany.mockResolvedValue([
    { assetType: "STOCK", currency: "USD", exchange },
  ]);
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
  it("does no cache or provider work for a pre-aborted request", async () => {
    withoutAlpacaCredentials();
    const controller = new AbortController();
    controller.abort(new DOMException("request closed", "AbortError"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 120,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops after an in-progress cache read observes cancellation", async () => {
    withoutAlpacaCredentials();
    const controller = new AbortController();
    mocks.findMany.mockImplementationOnce(async () => {
      controller.abort(new DOMException("request closed", "AbortError"));
      return [];
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 120,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards cancellation to provider fetch and does not continue to fallbacks", async () => {
    withoutAlpacaCredentials();
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      controller.abort(new DOMException("request closed", "AbortError"));
      throw controller.signal.reason;
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 120,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("finishes an accepted Alpaca cache write before propagating cancellation", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "alpaca-key");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "alpaca-secret");
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bars: {
          DEMOA: [{ t: "2026-06-17T13:35:00.000Z", o: 100, h: 102, l: 99, c: 101, v: 1000 }],
        },
      }),
    });
    mocks.createMany.mockImplementationOnce(async () => {
      controller.abort(new DOMException("request closed", "AbortError"));
      return { count: 1 };
    });
    mocks.upsert.mockResolvedValue({});
    vi.stubGlobal("fetch", fetch);

    const result = loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_001_000 },
      limit: 120,
      signal: controller.signal,
    });

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not enter a fallback after cancellation races with a non-ok provider response", async () => {
    withoutAlpacaCredentials();
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort(new DOMException("request closed", "AbortError"));
      return { ok: false };
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "1d",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 120,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

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
                timestamp: [
                  Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
                  Math.floor(Date.parse("2026-06-17T13:35:00.000Z") / 1000),
                ],
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
      range: {
        from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
        to: Math.floor(Date.parse("2026-06-17T13:40:00.000Z") / 1000),
      },
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

  it("keeps a denser partial cache when a provider returns only sparse endpoint rows", async () => {
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
      source: "cache",
      warnings: ["Yahoo candle provider returned partial coverage; keeping the more complete candle cache."],
    });
    expect(result.candles).toHaveLength(20);
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
      range: {
        from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
        to: Math.floor(Date.parse("2026-06-17T13:40:00.000Z") / 1000),
      },
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
      range: {
        from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
        to: Math.floor(Date.parse("2026-06-17T13:40:00.000Z") / 1000),
      },
      limit: 120,
    });

    expect(result).toMatchObject({
      symbol: "DEMOA",
      source: "alpaca",
      warnings: ["Candle cache update failed; showing live provider candles."],
    });
    expect(result.candles).toHaveLength(1);
  });

  it("uses validated Yahoo US-equity metadata to verify core-session coverage", async () => {
    withoutAlpacaCredentials();
    const range = {
      from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-06-17T13:40:00.000Z") / 1000),
    };
    const timestamps = expectedUsEquitiesBarStarts({ timeframe: "5m", ...range });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: timestamps,
            meta: {
              instrumentType: "EQUITY",
              exchangeName: "NASDAQ",
              exchangeTimezoneName: "America/New_York",
            },
            indicators: {
              quote: [{
                open: [100, 101, 102],
                high: [101, 102, 103],
                low: [99, 100, 101],
                close: [100.5, 101.5, 102.5],
                volume: [1000, 1100, 1200],
              }],
            },
          }],
        },
      }),
    }));

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "5m", range, limit: 120 });

    expect(result).toMatchObject({
      source: "yahoo",
      coverage: {
        status: "complete",
        profile: "US_EQUITIES_CORE_V1",
        sessionPolicy: "core-required-extended-preserved",
        expectedBars: 3,
        presentBars: 3,
      },
    });
  });

  it("clips Yahoo's widened exclusive request window back to the explicit range", async () => {
    withoutAlpacaCredentials();
    const from = Math.floor(Date.parse("2026-06-17T13:32:00.000Z") / 1000);
    const to = Math.floor(Date.parse("2026-06-17T13:45:00.000Z") / 1000);
    const timestamps = ["13:30", "13:35", "13:40", "13:45", "13:50"].map((time) =>
      Math.floor(Date.parse(`2026-06-17T${time}:00.000Z`) / 1000),
    );
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            timestamp: timestamps,
            indicators: {
              quote: [{
                open: [100, 101, 102, 103, 104],
                high: [101, 102, 103, 104, 105],
                low: [99, 100, 101, 102, 103],
                close: [100.5, 101.5, 102.5, 103.5, 104.5],
                volume: [1000, 1100, 1200, 1300, 1400],
              }],
            },
          }],
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "5m", range: { from, to }, limit: 120 });
    const yahooUrl = new URL(String(fetch.mock.calls[0]?.[0]));

    expect(yahooUrl.searchParams.get("period2")).toBe(String(Math.floor(Date.parse("2026-06-17T13:50:00.000Z") / 1000)));
    expect(result.candles.map((candle) => candle.time)).toEqual(timestamps.slice(1, 4));
  });

  it("clips Stooq daily history to the requested dates", async () => {
    withoutAlpacaCredentials();
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => [
          "Date,Open,High,Low,Close,Volume",
          "2026-06-15,100,102,99,101,1000",
          "2026-06-16,101,103,100,102,1100",
          "2026-06-17,102,104,101,103,1200",
          "2026-06-18,103,105,102,104,1300",
        ].join("\n"),
      });
    vi.stubGlobal("fetch", fetch);
    const range = {
      from: Math.floor(Date.parse("2026-06-16T00:00:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-06-17T23:59:59.000Z") / 1000),
    };

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "1d", range, limit: 120 });

    expect(result).toMatchObject({ source: "stooq" });
    expect(result.candles.map((candle) => candle.time)).toEqual([
      Math.floor(Date.parse("2026-06-16T00:00:00.000Z") / 1000),
      Math.floor(Date.parse("2026-06-17T00:00:00.000Z") / 1000),
    ]);
  });

  it("treats a full US-equity market holiday as complete without provider fallback", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity("NYSE");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "15m",
      range: {
        from: Math.floor(Date.parse("2026-11-26T00:00:00.000Z") / 1000),
        to: Math.floor(Date.parse("2026-11-26T23:59:59.000Z") / 1000),
      },
      limit: 120,
    });

    expect(result).toMatchObject({
      source: "cache",
      cacheKind: "native",
      candles: [],
      coverage: { status: "closed", expectedBars: 0, missingBars: 0 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts all 14 bars in a post-Thanksgiving early-close session", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity("NYSE");
    const range = {
      from: Math.floor(Date.parse("2026-11-27T00:00:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-11-27T23:59:59.000Z") / 1000),
    };
    const expected = expectedUsEquitiesBarStarts({ timeframe: "15m", ...range });
    mocks.findMany.mockImplementation(({ where }: { where: { timeframe: string } }) =>
      Promise.resolve(where.timeframe === "15m" ? cachedRows(makeCandlesAt(expected)) : []),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "15m", range, limit: 120 });

    expect(expected).toHaveLength(14);
    expect(result).toMatchObject({
      source: "cache",
      cacheKind: "native",
      coverage: { status: "complete", expectedBars: 14, missingBars: 0 },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not count a weekend or overnight closure as missing cache coverage", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity();
    const range = {
      from: Math.floor(Date.parse("2026-03-06T20:55:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-03-09T13:30:00.000Z") / 1000),
    };
    const expected = expectedUsEquitiesBarStarts({ timeframe: "5m", ...range });
    mocks.findMany.mockResolvedValue(cachedRows(makeCandlesAt(expected)));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "5m", range, limit: 120 });

    expect(expected).toHaveLength(2);
    expect(result).toMatchObject({ source: "cache", coverage: { status: "complete", missingBars: 0 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls through to providers for a genuine in-session cache gap", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity();
    const range = {
      from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-06-17T19:45:00.000Z") / 1000),
    };
    const expected = expectedUsEquitiesBarStarts({ timeframe: "15m", ...range });
    const partial = makeCandlesAt(expected.filter((time) => time !== expected[10]));
    mocks.findMany.mockImplementation(({ where }: { where: { timeframe: string } }) =>
      Promise.resolve(where.timeframe === "15m" ? cachedRows(partial) : []),
    );
    const fetch = vi.fn().mockRejectedValue(new Error("provider offline"));
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "15m", range, limit: 120 });

    expect(result).toMatchObject({
      source: "cache",
      coverage: { status: "partial", expectedBars: 26, presentBars: 25, missingBars: 1 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps unsupported exchanges explicitly unverified", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity("LSE");
    const start = Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000);
    const candles = makeCandles(start, 20);
    mocks.findMany.mockResolvedValue(cachedRows(candles));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: start, to: candles.at(-1)!.time },
      limit: 120,
    });

    expect(result).toMatchObject({
      source: "cache",
      coverage: { status: "unverified", profile: null, sessionPolicy: "unknown" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves available extended-hours candles while verifying core coverage", async () => {
    withoutAlpacaCredentials();
    resolveAsUsEquity();
    const range = {
      from: Math.floor(Date.parse("2026-06-17T12:00:00.000Z") / 1000),
      to: Math.floor(Date.parse("2026-06-17T20:30:00.000Z") / 1000),
    };
    const expected = expectedUsEquitiesBarStarts({ timeframe: "5m", ...range });
    const extended = [
      Math.floor(Date.parse("2026-06-17T12:05:00.000Z") / 1000),
      Math.floor(Date.parse("2026-06-17T20:15:00.000Z") / 1000),
    ];
    mocks.findMany.mockResolvedValue(cachedRows(makeCandlesAt([...extended, ...expected])));
    vi.stubGlobal("fetch", vi.fn());

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "5m", range, limit: 120 });

    expect(result.coverage).toMatchObject({ status: "complete", expectedBars: 78, missingBars: 0 });
    expect(result.candles.map((candle) => candle.time)).toEqual(expect.arrayContaining(extended));
  });

  it("recovers complete older 15-minute buckets beyond the former two-times source cap", async () => {
    withoutAlpacaCredentials();
    const base = Math.floor(1_783_000_000 / 900) * 900;
    const completeTimes = Array.from({ length: 21 }, (_, bucket) =>
      [0, 300, 600].map((offset) => base + bucket * 900 + offset),
    ).flat();
    const sparseTimes = Array.from({ length: 160 }, (_, bucket) => base + (21 + bucket) * 900);
    const rows = cachedRows(makeCandlesAt([...completeTimes, ...sparseTimes])).sort(
      (left, right) => right.time.getTime() - left.time.getTime(),
    );
    const sourceTakes: number[] = [];
    mocks.findMany.mockImplementation(({ where, take }: { where: { timeframe: string }; take: number }) => {
      if (where.timeframe === "15m") return Promise.resolve([]);
      sourceTakes.push(take);
      return Promise.resolve(rows.slice(0, take));
    });
    vi.stubGlobal("fetch", vi.fn());

    const result = await loadCandlesForSymbol({ symbol: "DEMOA", timeframe: "15m", range: null, limit: 21 });

    expect(result).toMatchObject({ source: "cache", cacheKind: "derived-5m" });
    expect(result.candles).toHaveLength(21);
    expect(Math.max(...sourceTakes)).toBeGreaterThan(21 * 3 * 2 + 3);
    expect(Math.max(...sourceTakes)).toBeLessThanOrEqual(21 * 3 * 8 + 3);
  });

  it("honors cancellation while resolving session-aware work", async () => {
    withoutAlpacaCredentials();
    const controller = new AbortController();
    mocks.instrumentFindMany.mockImplementation(async () => {
      controller.abort(new DOMException("request closed", "AbortError"));
      return [{ assetType: "STOCK", currency: "USD", exchange: "NASDAQ" }];
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(loadCandlesForSymbol({
      symbol: "DEMOA",
      timeframe: "5m",
      range: {
        from: Math.floor(Date.parse("2026-06-17T13:30:00.000Z") / 1000),
        to: Math.floor(Date.parse("2026-06-17T14:00:00.000Z") / 1000),
      },
      limit: 120,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
