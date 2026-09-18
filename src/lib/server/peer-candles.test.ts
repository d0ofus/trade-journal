import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadPeerCandles } from "./peer-candles";
import type { PeerCandleQuery } from "../workstation/peers";
const mocks = vi.hoisted(() => ({ slot: vi.fn(), cooldown: vi.fn() }));
vi.mock("./workstation-cache-store", () => ({ takeProviderSlot: mocks.slot, deferProviderRequests: mocks.cooldown }));
vi.mock("./workstation-candle-policy", () => ({ workstationCandlePolicy: () => ({ credentials: { keyId: "test", secretKey: "test", feed: "sip", baseUrl: "https://data.alpaca.markets" }, delaySeconds: 900 }) }));
const from = Date.parse("2024-09-10T00:00Z") / 1000;
const query: PeerCandleQuery = { symbols: ["AAPL", "BRK.B"], from, to: from + 86400, timeframe: "1d", session: "regular", adjustment: "split" };
const bar = (t = "2024-09-10T04:00:00Z") => ({ t, o: 10, h: 12, l: 9, c: 11, v: 100 });
beforeEach(() => { vi.clearAllMocks(); mocks.slot.mockResolvedValue(true); mocks.cooldown.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("uses multi-symbol adjusted requests, paginates to completion, and only takes background rate slots", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ bars: { AAPL: [bar()] }, next_page_token: "page2" })).mockResolvedValueOnce(Response.json({ bars: { "BRK.B": [bar()] }, next_page_token: null })); vi.stubGlobal("fetch", fetcher);
  const result = await loadPeerCandles(query, new AbortController().signal);
  expect(result.map(r => [r.symbol, r.status, r.candles.length])).toEqual([["AAPL", "ready", 1], ["BRK.B", "ready", 1]]);
  const first = new URL(fetcher.mock.calls[0][0]); expect(first.pathname).toBe("/v2/stocks/bars"); expect(first.searchParams.get("symbols")).toBe("AAPL,BRK.B"); expect(first.searchParams.get("adjustment")).toBe("split"); expect(first.searchParams.get("limit")).toBe("10000");
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("page_token")).toBe("page2"); expect(mocks.slot.mock.calls).toEqual([[true], [true]]);
  // Architectural guard: these imports may never lead to OHLCV/coverage/job persistence.
  const source = readFileSync(new URL("./peer-candles.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/loadWorkstationCandles|prisma\.|writeCache|writeCoverage|preparation|cacheSnapshot/);
});
it("aggregates regular hours from 5-minute bars anchored at the NY session open", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ bars: { AAPL: [bar("2024-09-10T13:25:00Z"), bar("2024-09-10T13:30:00Z"), bar("2024-09-10T14:25:00Z"), bar("2024-09-10T14:30:00Z")] } })); vi.stubGlobal("fetch", fetcher);
  const [result] = await loadPeerCandles({ ...query, symbols: ["AAPL"], timeframe: "1h" }, new AbortController().signal);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("timeframe")).toBe("5Min");
  expect(result.candles.map(c => new Date(c.time * 1000).toISOString())).toEqual(["2024-09-10T13:30:00.000Z", "2024-09-10T14:30:00.000Z"]); expect(result.candles[0].volume).toBe(200);
});
it("isolates unsupported symbols and reports empty history explicitly", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 422 })).mockResolvedValueOnce(Response.json({ bars: { AAPL: [] } })).mockResolvedValueOnce(new Response("", { status: 404 })));
  const result = await loadPeerCandles(query, new AbortController().signal); expect(result.map(r => r.status)).toEqual(["empty", "error"]);
});
it("respects provider cooldown and never falls back from credential/feed errors", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "20" } })).mockResolvedValueOnce(new Response("", { status: 401 })); vi.stubGlobal("fetch", fetcher);
  expect((await loadPeerCandles(query, new AbortController().signal))[0]).toMatchObject({ status: "error", retryAfter: 20, feed: "sip" }); expect(mocks.cooldown).toHaveBeenCalledWith(20);
  expect((await loadPeerCandles(query, new AbortController().signal))[0].error).toContain("credentials"); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("clips delayed data and cancels without issuing provider requests", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ bars: {} })); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController(); controller.abort(); await expect(loadPeerCandles(query, controller.signal)).rejects.toBeDefined(); expect(fetcher).not.toHaveBeenCalled();
  const now = Math.floor(Date.now() / 1000); await loadPeerCandles({ ...query, from: now - 2000, to: now }, new AbortController().signal);
  expect(Date.parse(new URL(fetcher.mock.calls[0][0]).searchParams.get("end")!) / 1000).toBeLessThanOrEqual(now - 900);
});
it("waits behind primary chart leases and refuses broken pagination", async () => {
  vi.useFakeTimers(); mocks.slot.mockResolvedValueOnce(false).mockResolvedValue(true);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ bars: {}, next_page_token: "repeated" }))); vi.stubGlobal("fetch", fetcher);
  const work = loadPeerCandles(query, new AbortController().signal); await vi.advanceTimersByTimeAsync(1050);
  expect((await work)[0].error).toContain("pagination"); expect(fetcher).toHaveBeenCalledTimes(2); expect(mocks.slot).toHaveBeenCalledTimes(3);
});
