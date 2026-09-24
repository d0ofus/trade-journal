import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), splits: vi.fn(), policy: vi.fn() }));
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: mocks.auth }));
vi.mock("@/lib/server/peer-candles", () => ({ loadPeerCandles: mocks.load }));
vi.mock("@/lib/server/workstation-stock-splits", () => ({ loadStockSplits: mocks.splits }));
vi.mock("@/lib/server/workstation-candle-policy", () => ({ workstationCandlePolicy: mocks.policy }));
const request = (symbols = "AAPL,BRK.B") => new NextRequest(`http://localhost/api/workstation/peer-candles?symbols=${symbols}&timeframe=1d&session=regular&adjustment=split&from=100&to=200`);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); mocks.auth.mockResolvedValue(null); mocks.load.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());
it("requires authentication and the workstation feature flag before provider access", async () => {
  mocks.auth.mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 })); expect((await GET(request())).status).toBe(401);
  vi.stubEnv("TRADES_WORKSTATION_ENABLED", "0"); expect((await GET(request())).status).toBe(404); expect(mocks.load).not.toHaveBeenCalled();
});
it("validates batches and returns private transient data", async () => {
  expect((await GET(request(Array(9).fill("AAA").join(",")))).status).toBe(400);
  expect((await GET(request("NASDAQ:AAPL"))).status).toBe(400);
  const result = await GET(request()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.load.mock.calls[0][0]).toMatchObject({ symbols: ["AAPL", "BRK.B"], adjustment: "split" });
});
it("returns a recoverable configuration failure without leaking credentials", async () => {
  mocks.load.mockRejectedValue(new Error("secret")); const result = await GET(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
});
it("verifies only the requested ticker through the background metadata queue, without requesting candles", async () => {
  const credentials = { keyId: "test", secretKey: "test", baseUrl: "https://data.invalid", feed: "sip", adjustment: "split" };
  mocks.policy.mockReturnValue({ credentials }); mocks.splits.mockResolvedValue({ version: 1, asOf: "2026-09-24", splits: [{ time: 100, ratio: 4 }] });
  const input = new NextRequest("http://localhost/api/workstation/peer-candles?metadataOnly=1&symbol=brk.b");
  const response = await GET(input);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ symbol: "BRK.B", splitAdjustment: { splits: [{ time: 100, ratio: 4 }] } });
  expect(mocks.splits).toHaveBeenCalledExactlyOnceWith("BRK.B", credentials, input.signal, true); expect(mocks.load).not.toHaveBeenCalled();
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects invalid metadata symbols and fails explicitly when adjustment verification is unavailable", async () => {
  expect((await GET(new NextRequest("http://localhost/api/workstation/peer-candles?metadataOnly=1&symbol=NASDAQ:AAPL"))).status).toBe(400);
  mocks.policy.mockReturnValue({ credentials: null });
  const response = await GET(new NextRequest("http://localhost/api/workstation/peer-candles?metadataOnly=1&symbol=AAPL"));
  expect(response.status).toBe(503); expect(await response.text()).toContain("could not be verified"); expect(mocks.load).not.toHaveBeenCalled();
});
