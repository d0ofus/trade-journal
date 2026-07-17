import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCandlesForSymbol: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/server/market-candles", () => ({
  SAFE_SYMBOL_PATTERN: /^[A-Z0-9.^=_-]{1,20}$/,
  isCandleRequestAbort: (error: unknown, signal?: AbortSignal) =>
    Boolean(signal?.aborted) || (error instanceof DOMException && error.name === "AbortError"),
  loadCandlesForSymbol: mocks.loadCandlesForSymbol,
  parseCandleTimeframe: (value: string | null | undefined) =>
    value === "1d" ? "1d" : value === "15m" ? "15m" : "5m",
  summarizeCandleResponse: ({
    candles,
    range,
    limit,
    loadedCount,
  }: {
    candles: unknown[];
    range: { from: number; to: number } | null;
    limit: number;
    loadedCount?: number;
  }) => ({
    requestedRange: range,
    returnedRange: null,
    barIntervalSeconds: null,
    limit,
    truncated: Number(loadedCount ?? candles.length) > limit,
    warnings: [],
  }),
}));

function candleRequest(url = "http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m&from=1783000000&to=1783010000") {
  return new NextRequest(url);
}

describe("market candles route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.loadCandlesForSymbol.mockResolvedValue({
      symbol: "DEMOA",
      candles: [],
      source: null,
      warnings: ["Yahoo candle provider unavailable; no candle data returned."],
    });
  });

  it("returns provider warnings as a 200 candle payload instead of surfacing a route error", async () => {
    const { GET } = await import("./route");

    const response = await GET(candleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      symbol: "DEMOA",
      timeframe: "5m",
      candles: [],
      source: null,
      metadata: {
        warnings: ["Yahoo candle provider unavailable; no candle data returned."],
      },
    });
  });

  it("passes explicit ranges and limit sentinels to the candle loader", async () => {
    const { GET } = await import("./route");

    await GET(candleRequest("http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m&from=1783000000&to=1783010000&limit=240"));

    expect(mocks.loadCandlesForSymbol).toHaveBeenCalledWith({
      symbol: "DEMOA",
      timeframe: "5m",
      range: { from: 1_783_000_000, to: 1_783_010_000 },
      limit: 241,
      signal: expect.anything(),
    });
  });

  it("preserves derived cache provenance for 15 minute candle responses", async () => {
    mocks.loadCandlesForSymbol.mockResolvedValue({
      symbol: "DEMOA",
      candles: [{ time: 1_783_000_000, open: 100, high: 101, low: 99, close: 100.5 }],
      source: "cache",
      cacheKind: "derived-5m",
      warnings: [],
    });
    const { GET } = await import("./route");

    const response = await GET(candleRequest("http://localhost/api/market/candles?symbol=DEMOA&timeframe=15m"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      timeframe: "15m",
      source: "cache",
      cacheKind: "derived-5m",
    });
    expect(mocks.loadCandlesForSymbol).toHaveBeenCalledWith({
      symbol: "DEMOA",
      timeframe: "15m",
      range: null,
      limit: 121,
      signal: expect.anything(),
    });
  });

  it("forwards the exact request abort signal to the candle loader", async () => {
    const controller = new AbortController();
    const request = new NextRequest(
      "http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m",
      { signal: controller.signal },
    );
    const { GET } = await import("./route");

    await GET(request);

    expect(mocks.loadCandlesForSymbol).toHaveBeenCalledWith(expect.objectContaining({ signal: request.signal }));
  });

  it("propagates cancellation without converting it to a service warning", async () => {
    const controller = new AbortController();
    const request = new NextRequest(
      "http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m",
      { signal: controller.signal },
    );
    mocks.loadCandlesForSymbol.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      controller.abort(new DOMException("client disconnected", "AbortError"));
      throw signal.reason;
    });
    const { GET } = await import("./route");

    await expect(GET(request)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects unauthenticated candle requests before loading market data", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { GET } = await import("./route");

    const response = await GET(candleRequest());

    expect(response.status).toBe(401);
    expect(mocks.loadCandlesForSymbol).not.toHaveBeenCalled();
  });

  it("keeps compare candle loader failures inside the response payload", async () => {
    mocks.loadCandlesForSymbol
      .mockResolvedValueOnce({
        symbol: "DEMOA",
        candles: [{ time: 1_783_000_000, open: 100, high: 101, low: 99, close: 100.5 }],
        source: "cache",
        warnings: [],
      })
      .mockRejectedValueOnce(new Error("compare loader failed"));
    const { GET } = await import("./route");

    const response = await GET(candleRequest("http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m&compare=SPY"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      symbol: "DEMOA",
      source: "cache",
      compare: {
        symbol: "SPY",
        candles: [],
        source: null,
        metadata: {
          warnings: ["Candle service unavailable; no candle data returned."],
        },
      },
      compareError: null,
    });
  });

  it("waits for sibling compare work to settle before propagating cancellation", async () => {
    const controller = new AbortController();
    const request = new NextRequest(
      "http://localhost/api/market/candles?symbol=DEMOA&timeframe=5m&compare=SPY",
      { signal: controller.signal },
    );
    let finishCompare!: () => void;
    const comparePending = new Promise<void>((resolve) => {
      finishCompare = resolve;
    });
    mocks.loadCandlesForSymbol
      .mockImplementationOnce(async () => {
        controller.abort(new DOMException("client disconnected", "AbortError"));
        throw controller.signal.reason;
      })
      .mockImplementationOnce(async () => {
        await comparePending;
        return { symbol: "SPY", candles: [], source: null, warnings: [] };
      });
    const { GET } = await import("./route");
    let settled = false;

    const result = GET(request).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    finishCompare();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
