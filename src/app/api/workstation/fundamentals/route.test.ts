import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), trades: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: mocks.auth }));
vi.mock("@/lib/server/trade-workstation", () => ({ listWorkstationTrades: mocks.trades }));
vi.mock("@/lib/server/sec-fundamentals", () => ({ loadTradeFundamentals: mocks.load }));
const request = (query = "tradeId=one&mode=before-entry") => new NextRequest(`http://localhost/api/workstation/fundamentals?${query}`);
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); mocks.auth.mockResolvedValue(null); mocks.trades.mockResolvedValue([{ id: "one", symbol: "SERVER" }]); mocks.load.mockResolvedValue({ symbol: "SERVER", quarters: [] }); });
afterEach(() => vi.unstubAllEnvs());
it("requires authentication and validates identifiers/modes before accessing a provider", async () => {
  mocks.auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 })); expect((await GET(request())).status).toBe(401);
  expect((await GET(request("mode=latest"))).status).toBe(400); expect((await GET(request("tradeId=one&mode=anything"))).status).toBe(400);
  vi.stubEnv("TRADES_WORKSTATION_ENABLED", "0"); expect((await GET(request())).status).toBe(404); expect(mocks.load).not.toHaveBeenCalled();
});
it("derives the ticker from the stored trade, ignores user ticker/cutoff overrides, and prevents shared HTTP caching", async () => {
  const response = await GET(request("tradeId=one&mode=before-entry&symbol=EVIL&cutoff=2099-01-01"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toMatchObject({ symbol: "SERVER" });
  expect(mocks.load.mock.calls[0].slice(0, 2)).toEqual([{ id: "one", symbol: "SERVER" }, "before-entry"]);
  mocks.trades.mockResolvedValueOnce([]); expect((await GET(request())).status).toBe(404);
});
