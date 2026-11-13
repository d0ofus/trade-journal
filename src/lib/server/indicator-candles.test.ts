import { afterEach, expect, it, vi } from "vitest";
import { loadWorkstationCandles } from "./workstation-candles";
import type { WorkstationCandlePolicy } from "./workstation-candle-policy";

const mocks = vi.hoisted(() => ({ compact: vi.fn(), fetch: vi.fn(), enabled: vi.fn(() => true), slot: vi.fn(async () => true) }));
vi.mock("./workstation-cache-loader", () => ({ loadCompactWorkstationCandles: mocks.compact }));
vi.mock("./workstation-cache-store", () => ({ cacheEnabled: mocks.enabled, takeProviderSlot: mocks.slot }));
vi.mock("./workstation-cache-provider", () => ({ fetchCompactCandles: mocks.fetch, CacheBusyError: class extends Error {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const policy: WorkstationCandlePolicy = { provider: "alpaca", credentials: { keyId: "synthetic", secretKey: "synthetic", feed: "sip", adjustment: "raw", baseUrl: "https://data.alpaca.markets" }, delaySeconds: 0, fallback: false, cacheSource: "fixture" };
const input = { symbol: "UNSEEN", timeframe: "5m" as const, range: { from: 1788958800, to: 1788959100 }, limit: 30001, session: "regular" as const, purpose: "indicator" as const, mode: "fill" as const };
afterEach(() => { vi.clearAllMocks(); mocks.enabled.mockReturnValue(true); });

it("routes indicator fills through supplementary background storage without protecting them as trade windows", async () => {
  mocks.compact.mockResolvedValue({ candles: [], source: "alpaca" });
  await loadWorkstationCandles(input, policy);
  expect(mocks.compact).toHaveBeenCalledWith(expect.objectContaining({ background: true, supplementary: true, preemptible: true, tradeWindow: false, mode: "fill" }), policy);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("uses background provider scheduling and reports verified retrieval without a persistent cache", async () => {
  mocks.enabled.mockReturnValue(false); mocks.fetch.mockResolvedValue([]);
  const result = await loadWorkstationCandles(input, policy);
  expect(mocks.fetch).toHaveBeenCalledWith(input.symbol, input.timeframe, expect.anything(), policy.credentials, true, true, expect.anything());
  expect(result.retrieved).toEqual([input.range]);
});
it("keeps derived-hour indicator requests coordinated even when persistent caching is disabled", async () => {
  mocks.enabled.mockReturnValue(false); mocks.fetch.mockResolvedValue([]);
  const open = Date.parse("2026-09-23T14:00:00Z") / 1000;
  await loadWorkstationCandles({ ...input, timeframe: "1h", range: { from: open, to: open + 300 } }, policy);
  expect(mocks.fetch).toHaveBeenCalledWith(input.symbol, "5m", expect.anything(), policy.credentials, true, true, expect.objectContaining({ yieldToForeground: true, coordinateProvider: true }));
});
