import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: mocks.auth }));
vi.mock("@/lib/server/peer-candles", () => ({ loadPeerCandles: mocks.load }));
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
