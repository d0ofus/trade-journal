import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), split: vi.fn() }));
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: mocks.auth }));
vi.mock("@/lib/server/workstation-candles", () => ({ loadWorkstationCandles: mocks.load }));
vi.mock("@/lib/server/workstation-split-candles", () => ({ loadSplitAdjustedWorkstationCandles: mocks.split }));
// Response summarization is pure; prevent the shared module's Prisma import from creating a real client.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const url = "http://localhost/api/workstation/candles?symbol=AAPL&timeframe=5m&from=1725890400&to=1725891000&limit=30";
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1");
  mocks.load.mockResolvedValue({ symbol: "AAPL", candles: [], source: "alpaca", provider: { identity: "workstation:v1:alpaca:sip:raw", provider: "alpaca", feed: "sip", adjustment: "raw", delaySeconds: 900, cached: false, fallback: false } });
});
afterEach(() => vi.unstubAllEnvs());
it("keeps authentication and feature flag checks ahead of provider/database calls", async () => {
  mocks.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  expect((await GET(new NextRequest(url))).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue(null); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "0");
  expect((await GET(new NextRequest(url))).status).toBe(404);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("validates ranges, symbols, intervals and limits before loading", async () => {
  for (const [name, value] of [["symbol", "../secret"], ["timeframe", "1s"], ["from", "NaN"], ["to", "1"], ["limit", "30001"], ["to", "99999999999999999"]]) {
    const invalid = new URL(url); invalid.searchParams.set(name, value);
    expect((await GET(new NextRequest(invalid))).status).toBe(400);
  }
  expect(mocks.load).not.toHaveBeenCalled();
});
it("passes provider identity and cancellation, returns public metadata without credentials", async () => {
  const request = new NextRequest(url + "&identity=workstation:v1:alpaca:sip:raw");
  const response = await GET(request); const body = await response.json();
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ signal: request.signal, identity: "workstation:v1:alpaca:sip:raw", limit: 31 }));
  expect(body.provider).toMatchObject({ feed: "sip", adjustment: "raw", delaySeconds: 900 });
  expect(JSON.stringify(body)).not.toMatch(/secretKey|keyId|credentials/);
});
it("does not expose raw provider errors to clients", async () => {
  mocks.load.mockRejectedValue(new Error("sensitive-provider-response"));
  const response = await GET(new NextRequest(url));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("sensitive-provider-response");
});
it("returns split metadata only through the authenticated, validated split view", async () => {
  const splitAdjustment = { version: 1, asOf: "2026-09-16", splits: [{ time: 1782964800, ratio: 4 }] };
  mocks.split.mockResolvedValue({ ...await mocks.load(), splitAdjustment }); mocks.load.mockClear();
  const response = await GET(new NextRequest(url + "&adjustment=split"));
  expect(response.status).toBe(200); expect((await response.json()).metadata.splitAdjustment).toEqual(splitAdjustment);
  expect(mocks.split).toHaveBeenCalledTimes(1); expect(mocks.load).not.toHaveBeenCalled();
  expect((await GET(new NextRequest(url + "&adjustment=all"))).status).toBe(400);
  mocks.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  expect((await GET(new NextRequest(url + "&adjustment=split"))).status).toBe(401);
  expect(mocks.split).toHaveBeenCalledTimes(1);
});
