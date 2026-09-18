import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: auth }));
beforeEach(() => { auth.mockReset().mockResolvedValue(null); vi.stubEnv("MARKET_OVERVIEW_API_BASE", "https://market.test"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("skips metrics only when explicitly requested and preserves the default response", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ groups: [] }))); vi.stubGlobal("fetch", fetcher);
  const lean = await GET(new NextRequest("http://localhost/api/journal/market-context?symbol=brk.b&membershipOnly=1"));
  expect(await lean.json()).toMatchObject({ symbol: "BRK.B", detail: { groups: [] }, metrics: null, errors: [] }); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("https://market.test/api/peer-groups/ticker/BRK.B");
  await GET(new NextRequest("http://localhost/api/journal/market-context?symbol=AAPL")); expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[2][0]).toContain("/metrics");
});
it("authenticates before fetching and reports missing memberships/upstream failures", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("upstream")); vi.stubGlobal("fetch", fetcher);
  auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 })); expect((await GET(new NextRequest("http://localhost/?symbol=AAPL"))).status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  const result = await GET(new NextRequest("http://localhost/?symbol=AAPL&membershipOnly=1")); expect(await result.json()).toMatchObject({ detail: null, metrics: null, errors: [expect.stringContaining("unavailable")] });
  expect((await GET(new NextRequest("http://localhost/"))).status).toBe(400);
});
