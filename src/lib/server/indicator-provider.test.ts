import { afterEach, expect, it, vi } from "vitest";
const queue = vi.hoisted(() => ({ foreground: vi.fn(async () => true), slot: vi.fn(async () => true) }));
vi.mock("./workstation-cache-store", () => ({ foregroundPending: queue.foreground, takeProviderSlot: queue.slot, deferProviderRequests: vi.fn() }));
import { CacheBusyError, fetchCompactCandles } from "./workstation-cache-provider";

const credentials = { keyId: "synthetic", secretKey: "synthetic", feed: "sip" as const, adjustment: "raw" as const, baseUrl: "https://data.alpaca.markets" };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("releases preemptible indicator work before a provider slot when foreground work arrives", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(fetchCompactCandles("UNSEEN", "5m", { from: 1788958800, to: 1788959100 }, credentials, true, true, { yieldToForeground: true })).rejects.toBeInstanceOf(CacheBusyError);
  expect(queue.slot).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("keeps existing foreground requests eligible while background indicators yield", async () => {
  const fetch = vi.fn(async () => Response.json({ bars: { UNSEEN: [] }, next_page_token: null })); vi.stubGlobal("fetch", fetch);
  await expect(fetchCompactCandles("UNSEEN", "5m", { from: 1788958800, to: 1788959100 }, credentials, false, true, { yieldToForeground: true })).resolves.toEqual([]);
  expect(queue.slot).toHaveBeenCalledWith(false); expect(fetch).toHaveBeenCalledOnce();
});
