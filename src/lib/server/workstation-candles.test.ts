import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { loadWorkstationCandles } from "./workstation-candles";
import { loadCandlesForSymbol } from "./market-candles";

const db = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn(), upsert: vi.fn(), instrument: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { marketCandle: { findMany: db.findMany, createMany: db.createMany, upsert: db.upsert }, instrument: { findMany: db.instrument } } }));
const start = Date.parse("2024-09-09T14:00:00Z") / 1000;
const input = { symbol: "AAPL", timeframe: "5m" as const, range: { from: start, to: start + 600 }, limit: 30 };
const bars = [0, 300, 600].map(offset => ({ t: new Date((start + offset) * 1000).toISOString(), o: 100, h: 102, l: 99, c: 101, v: 100 }));
function alpaca() { return new Response(JSON.stringify({ bars: { AAPL: bars }, next_page_token: null })); }
function yahoo() { return new Response(JSON.stringify({ chart: { result: [{ timestamp: [start], indicators: { quote: [{ open: [100], high: [102], low: [99], close: [101], volume: [100] }] } }] } })); }

it("isolates extended Yahoo requests from the shared legacy regular-session cache", async () => {
  vi.stubEnv("TRADES_CHART_PROVIDER", "legacy");
  const fetcher = vi.fn().mockImplementation(async () => yahoo()); vi.stubGlobal("fetch", fetcher);
  const extended = await loadWorkstationCandles({ ...input, session: "extended" });
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("includePrePost")).toBe("true");
  expect(extended.provider.identity).toContain(":extended");
  expect(db.findMany).not.toHaveBeenCalled(); expect(db.createMany).not.toHaveBeenCalled();
  vi.stubEnv("TRADES_CHART_PROVIDER", "yahoo");
  const regular = await loadWorkstationCandles({ ...input, session: "regular" });
  expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("includePrePost")).toBe("false");
  expect(regular.provider.identity).not.toBe(extended.provider.identity);
});
beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue([]); db.instrument.mockResolvedValue([]); db.createMany.mockResolvedValue({ count: 3 }); db.upsert.mockResolvedValue({});
  for (const key of ["ALPACA_API_KEY_ID", "ALPACA_API_KEY", "ALPACA_API_SECRET_KEY", "ALPACA_SECRET_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("TRADES_CHART_PROVIDER", "alpaca");
  vi.stubEnv("TRADES_ALPACA_API_KEY_ID", "test-chart-key"); vi.stubEnv("TRADES_ALPACA_API_SECRET_KEY", "test-chart-secret");
  vi.stubEnv("TRADES_ALPACA_DATA_FEED", "sip"); vi.stubEnv("TRADES_ALPACA_ADJUSTMENT", "raw"); vi.stubEnv("TRADES_ALPACA_DELAY_SECONDS", "900");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("requires chart-only credentials and ignores global credentials", () => {
  expect(workstationCandlePolicy({ ALPACA_API_KEY_ID: "global", ALPACA_API_SECRET_KEY: "global" }).provider).toBe("legacy");
  expect(() => workstationCandlePolicy({ TRADES_CHART_PROVIDER: "alpaca", ALPACA_API_KEY_ID: "global", ALPACA_API_SECRET_KEY: "global" })).toThrow("Workstation Alpaca credentials are missing");
});
it.each([undefined, "legacy"])("preserves the production loader with provider %s despite unused chart credentials", async provider => {
  vi.stubEnv("TRADES_CHART_PROVIDER", provider);
  // Deferred chart configuration must neither select Alpaca nor validate its settings.
  vi.stubEnv("TRADES_ALPACA_DATA_FEED", "not-configured");
  vi.stubEnv("TRADES_ALPACA_ADJUSTMENT", "all");
  const fetcher = vi.fn().mockImplementation(async () => yahoo()); vi.stubGlobal("fetch", fetcher);
  const original = await loadCandlesForSymbol(input);
  const workstation = await loadWorkstationCandles(input);
  const { provider: metadata, ...loaded } = workstation;
  expect(loaded).toEqual(original);
  expect(metadata).toMatchObject({ identity: "legacy:yahoo:unverified", provider: "yahoo", cached: false });
  expect(db.findMany.mock.calls.every(([args]) => JSON.stringify(args.where.source.in) === JSON.stringify(["alpaca", "demo"]))).toBe(true);
  expect(fetcher.mock.calls.every(([url]) => String(url).includes("finance.yahoo.com"))).toBe(true);
  expect(db.createMany).not.toHaveBeenCalled(); expect(db.upsert).not.toHaveBeenCalled();
});
it("partitions feeds and rejects adjusted prices and foreign credential hosts", () => {
  const env = { TRADES_CHART_PROVIDER: "alpaca", TRADES_ALPACA_API_KEY_ID: "test", TRADES_ALPACA_API_SECRET_KEY: "test" };
  expect(workstationCandlePolicy(env).cacheSource).toBe("workstation:v1:alpaca:sip:raw");
  expect(workstationCandlePolicy({ ...env, TRADES_ALPACA_DATA_FEED: "iex" }).cacheSource).toBe("workstation:v1:alpaca:iex:raw");
  expect(() => workstationCandlePolicy({ ...env, TRADES_ALPACA_ADJUSTMENT: "all" })).toThrow("require raw prices");
  expect(() => workstationCandlePolicy({ ...env, TRADES_ALPACA_DATA_BASE_URL: "https://example.com" })).toThrow("must use");
});
it("reads and writes only the isolated cache namespace, using chart credentials", async () => {
  const fetcher = vi.fn().mockImplementation(async () => alpaca()); vi.stubGlobal("fetch", fetcher);
  const result = await loadWorkstationCandles(input);
  expect(result.provider).toMatchObject({ identity: "workstation:v1:alpaca:sip:raw", feed: "sip", adjustment: "raw" });
  expect(db.findMany.mock.calls[0][0].where.source.in).toEqual(["workstation:v1:alpaca:sip:raw"]);
  const [url, options] = fetcher.mock.calls[0];
  expect(new URL(url).searchParams.get("feed")).toBe("sip");
  expect(options.headers["APCA-API-KEY-ID"]).toBe("test-chart-key");
  expect(db.createMany.mock.calls[0][0].data.every((row: { source: string }) => row.source === result.provider.identity)).toBe(true);
  expect(db.upsert.mock.calls.every(([args]) => args.where.symbol_timeframe_time_source.source === result.provider.identity)).toBe(true);
});
it("reuses complete matching cache coverage without reading another feed", async () => {
  const rows = bars.map(bar => ({ time: new Date(bar.t), open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v }));
  db.findMany.mockImplementation(async ({ where }) => where.source.in[0] === "workstation:v1:alpaca:sip:raw" ? rows : []);
  const fetcher = vi.fn().mockImplementation(async () => alpaca()); vi.stubGlobal("fetch", fetcher);
  const cached = await loadWorkstationCandles(input);
  expect(cached.provider.cached).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("TRADES_ALPACA_DATA_FEED", "iex");
  const separate = await loadWorkstationCandles(input);
  expect(separate.provider.identity).toBe("workstation:v1:alpaca:iex:raw");
  expect(separate.provider.cached).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("follows Alpaca page tokens with the same feed, adjustment and cache namespace", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ bars: { AAPL: bars.slice(0, 1) }, next_page_token: "next-test-page" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ bars: { AAPL: bars.slice(1) }, next_page_token: null })));
  vi.stubGlobal("fetch", fetcher);
  const result = await loadWorkstationCandles(input);
  expect(result.candles).toHaveLength(3); expect(fetcher).toHaveBeenCalledTimes(2);
  const second = new URL(fetcher.mock.calls[1][0]);
  expect(second.searchParams.get("page_token")).toBe("next-test-page");
  expect(second.searchParams.get("feed")).toBe("sip"); expect(second.searchParams.get("adjustment")).toBe("raw");
});
it("existing outcome loader still uses its original cache and Yahoo with chart credentials present", async () => {
  const fetcher = vi.fn().mockImplementation(async () => yahoo()); vi.stubGlobal("fetch", fetcher);
  const result = await loadCandlesForSymbol(input);
  expect(result.source).toBe("yahoo");
  expect(db.findMany.mock.calls[0][0].where.source.in).toEqual(["alpaca", "demo"]);
  expect(fetcher.mock.calls.every(([url]) => String(url).includes("finance.yahoo.com"))).toBe(true);
  expect(db.createMany).not.toHaveBeenCalled(); expect(db.upsert).not.toHaveBeenCalled();
});
it("caps SIP requests at the configured historical delay", async () => {
  const fetcher = vi.fn().mockImplementation(async () => alpaca()); vi.stubGlobal("fetch", fetcher);
  const now = Math.floor(Date.now() / 1000);
  const result = await loadWorkstationCandles({ ...input, range: { from: now - 5000, to: now + 5000 } });
  const end = Date.parse(new URL(fetcher.mock.calls[0][0]).searchParams.get("end")!) / 1000;
  expect(end).toBeLessThanOrEqual(now - 900); expect(end).toBeGreaterThan(now - 905);
  expect(result.warnings?.join(" ")).toContain("900s configured delay");
});
it("labels Yahoo fallback with a separate identity and pins later pages to that provider", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string | URL) => String(url).includes("alpaca") ? new Response("", { status: 403 }) : yahoo());
  vi.stubGlobal("fetch", fetcher);
  const fallback = await loadWorkstationCandles(input);
  expect(fallback.provider).toMatchObject({ provider: "yahoo", adjustment: "unverified", fallback: true });
  expect(fallback.warnings?.join(" ")).toContain("Alpaca unavailable");
  expect(db.createMany).not.toHaveBeenCalled();
  fetcher.mockClear();
  await loadWorkstationCandles({ ...input, identity: fallback.provider.identity });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain("finance.yahoo.com");
});
it("does not substitute Yahoo when fallback is disabled or a request is aborted", async () => {
  vi.stubEnv("TRADES_CHART_YAHOO_FALLBACK", "0");
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 })); vi.stubGlobal("fetch", fetcher);
  await expect(loadWorkstationCandles(input)).rejects.toThrow("fallback is disabled");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockClear(); const controller = new AbortController(); controller.abort();
  await expect(loadWorkstationCandles({ ...input, signal: controller.signal })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
