import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { secJson } from "./sec-client";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), read: vi.fn(), write: vi.fn(), wait: vi.fn() }));
vi.mock("./workstation-cache-store", () => ({ claimCacheLease: mocks.claim }));
vi.mock("@/lib/prisma", () => ({ prisma: { workstationCandleLease: { findUnique: mocks.read, upsert: mocks.write } } }));
vi.mock("@/lib/workstation/shared-requests", () => ({ waitForHistory: mocks.wait }));
beforeEach(() => { vi.resetAllMocks(); mocks.claim.mockResolvedValue({ key: "rate:sec", token: "one" }); mocks.read.mockResolvedValue(null); mocks.wait.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllGlobals());
it("automatically retries transient HTTP failures through the shared SEC gate", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValue(new Response('{"facts":{}}', { status: 200 })); vi.stubGlobal("fetch", fetcher);
  expect(await secJson("https://data.sec.gov/test", new AbortController().signal)).toEqual({ facts: {} });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(mocks.claim).toHaveBeenCalledWith("rate:sec", 500); expect(mocks.wait).toHaveBeenCalledWith(500, expect.anything());
  expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Accept: "application/json" } });
});
it("respects Retry-After globally rather than hammering a throttled provider", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } })); vi.stubGlobal("fetch", fetcher);
  await expect(secJson("https://data.sec.gov/test", new AbortController().signal)).rejects.toThrow("limiting");
  expect(fetcher).toHaveBeenCalledTimes(1); expect(mocks.write.mock.calls[0][0].update.expiresAt.getTime()).toBeGreaterThan(Date.now() + 110000);
  mocks.read.mockResolvedValue({ expiresAt: new Date(Date.now() + 120000) });
  await expect(secJson("https://data.sec.gov/test", new AbortController().signal)).rejects.toThrow("cooling down"); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds network retries and honors cancellation", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch", fetcher);
  await expect(secJson("https://data.sec.gov/test", new AbortController().signal)).rejects.toThrow("timeout"); expect(fetcher).toHaveBeenCalledTimes(3);
  const controller = new AbortController(); controller.abort();
  mocks.claim.mockImplementation(async () => { controller.signal.throwIfAborted(); return null; });
  await expect(secJson("https://data.sec.gov/test", controller.signal)).rejects.toBeDefined(); expect(fetcher).toHaveBeenCalledTimes(3);
});
