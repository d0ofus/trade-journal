import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadStockSplits, parseStockSplits } from "./workstation-stock-splits";
const slots = vi.hoisted(() => ({ take: vi.fn(), defer: vi.fn() }));
vi.mock("./workstation-cache-store", () => ({ takeProviderSlot: slots.take, deferProviderRequests: slots.defer }));
beforeEach(() => { slots.take.mockReset().mockResolvedValue(true); });
const credentials = { keyId: "fixture", secretKey: "fixture", baseUrl: "https://data.alpaca.markets", feed: "sip" as const, adjustment: "raw" as const };
const action = { symbol: "CRWD", ex_date: "2026-07-02", new_rate: 4, old_rate: 1 };
const body = (rows: unknown[]) => ({ corporate_actions: { forward_splits: rows }, next_page_token: null });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("uses New York midnight, including winter, and ignores future effective splits", () => {
  expect(parseStockSplits(body([action]), "CRWD", Date.parse("2026-07-02T04:00Z") / 1000)).toEqual([{ time: Date.parse("2026-07-02T04:00Z") / 1000, ratio: 4 }]);
  expect(parseStockSplits(body([action]), "CRWD", Date.parse("2026-07-02T03:59Z") / 1000)).toEqual([]);
  expect(parseStockSplits(body([{ ...action, ex_date: "2026-01-02" }]), "CRWD", Date.parse("2026-02-01") / 1000)[0].time).toBe(Date.parse("2026-01-02T05:00Z") / 1000);
});
it("rejects malformed, mismatched and invalid-ratio records instead of declaring no splits", () => {
  for (const item of [{ ...action, new_rate: 0 }, { ...action, ex_date: "2026-02-30" }, { ...action, symbol: "OTHER" }]) expect(() => parseStockSplits(body([item]), "CRWD", Date.now() / 1000)).toThrow();
  expect(() => parseStockSplits({}, "CRWD", Date.now() / 1000)).toThrow();
});
it("shares paginated requests between charts and caches only complete metadata", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-16"));
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...body([action]), next_page_token: "page-2" })).mockResolvedValueOnce(Response.json(body([action])));
  vi.stubGlobal("fetch", fetcher);
  const [first, second] = await Promise.all([loadStockSplits("CRWD", credentials), loadStockSplits("CRWD", credentials)]);
  expect(first).toEqual(second); expect(first.splits).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get("page_token")).toBe("page-2");
  await loadStockSplits("CRWD", credentials); expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not turn provider failures into an empty successful split list", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  await expect(loadStockSplits("FAIL", credentials)).rejects.toThrow();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body([]))));
  expect((await loadStockSplits("FAIL", credentials)).splits).toEqual([]);
});
it("promotes shared peer metadata when a foreground workspace request joins", async () => {
  slots.take.mockImplementation(async background => !background);
  const fetcher = vi.fn().mockResolvedValue(Response.json(body([]))); vi.stubGlobal("fetch", fetcher);
  const background = loadStockSplits("PRIORITY", credentials, undefined, true);
  await vi.waitFor(() => expect(slots.take).toHaveBeenCalledWith(true));
  const foreground = loadStockSplits("PRIORITY", credentials);
  expect(await background).toEqual(await foreground);
  expect(slots.take).toHaveBeenCalledWith(false); expect(fetcher).toHaveBeenCalledTimes(1);
});
