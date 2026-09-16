import { beforeEach, expect, it, vi } from "vitest";
import { loadSplitAdjustedWorkstationCandles } from "./workstation-split-candles";
const mocks = vi.hoisted(() => ({ load: vi.fn(), splits: vi.fn() }));
vi.mock("./workstation-candles", () => ({ loadWorkstationCandles: mocks.load }));
vi.mock("./workstation-stock-splits", () => ({ loadStockSplits: mocks.splits }));
vi.mock("./workstation-candle-policy", () => ({ workstationCandlePolicy: () => ({ provider: "alpaca", credentials: { feed: "sip", adjustment: "raw" }, cacheSource: "workstation:v1:alpaca:sip:raw" }) }));
const time = Date.parse("2026-07-02T04:00Z") / 1000;
const adjustment = { version: 1, asOf: "2026-09-16", splits: [{ time, ratio: 4 }] };
const original = { time: time - 86400, open: 760, high: 800, low: 720, close: 780, volume: 100 };
const input = { symbol: "CRWD", timeframe: "1d" as const, range: { from: time - 86400, to: time + 86400 }, limit: 30000, session: "regular" as const };
beforeEach(() => {
  vi.clearAllMocks(); mocks.splits.mockResolvedValue(adjustment);
  mocks.load.mockResolvedValue({ symbol: "CRWD", candles: [original], source: "alpaca", provider: { identity: "workstation:v1:alpaca:sip:raw:regular", provider: "alpaca", adjustment: "raw" }, cache: { enabled: true, status: "hit", covered: [input.range], missing: [], refresh: [] } });
});
it("repairs existing raw cache hits without rewriting rows or coverage and returns projection metadata", async () => {
  const result = await loadSplitAdjustedWorkstationCandles({ ...input, mode: "cache" });
  expect(result.candles[0]).toMatchObject({ close: 195, volume: 400 });
  expect(result.provider.adjustment).toBe("split"); expect(result.provider.identity).toContain(":split-view:v1:");
  expect(result.splitAdjustment).toEqual(adjustment); expect(result.cache?.status).toBe("hit");
  expect(original.close).toBe(780);
  await loadSplitAdjustedWorkstationCandles({ ...input, identity: result.provider.identity });
  expect(mocks.load.mock.calls[1][0].identity).toBe("workstation:v1:alpaca:sip:raw:regular");
});
it("uses independently cached provider-adjusted weekly aggregates without applying the split twice", async () => {
  mocks.load.mockResolvedValue({ candles: [{ ...original, close: 195, open: 190, high: 200, low: 180, volume: 400 }], provider: { provider: "alpaca", adjustment: "split", identity: "weekly-split" } });
  const result = await loadSplitAdjustedWorkstationCandles({ ...input, timeframe: "1wk" });
  expect(mocks.load.mock.calls[0][1].credentials.adjustment).toBe("split");
  expect(mocks.load.mock.calls[0][1].cacheSource).toContain("workstation:v2:alpaca:sip:split:");
  expect(result.candles[0].close).toBe(195);
});
it("refuses to merge changed corporate actions or raw outages into an adjusted series", async () => {
  const result = await loadSplitAdjustedWorkstationCandles(input);
  mocks.splits.mockResolvedValue({ ...adjustment, splits: [{ time, ratio: 5 }] });
  await expect(loadSplitAdjustedWorkstationCandles({ ...input, identity: result.provider.identity })).rejects.toThrow("history changed");
  mocks.splits.mockRejectedValue(new Error("Unavailable"));
  await expect(loadSplitAdjustedWorkstationCandles({ ...input, identity: result.provider.identity })).rejects.toThrow("Unavailable");
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
it("labels an initial split-metadata failure explicitly and leaves Yahoo's unverified basis alone", async () => {
  mocks.splits.mockRejectedValue(new Error("Unavailable"));
  const raw = await loadSplitAdjustedWorkstationCandles(input);
  expect(raw.candles[0].close).toBe(780); expect(raw.warnings?.join()).toContain("Split adjustment unavailable");
  mocks.splits.mockResolvedValue(adjustment);
  mocks.load.mockResolvedValue({ candles: [original], provider: { provider: "yahoo", adjustment: "unverified", identity: "workstation:v1:yahoo:unverified" } });
  const yahoo = await loadSplitAdjustedWorkstationCandles(input);
  expect(yahoo.candles[0]).toEqual(original); expect(yahoo.splitAdjustment).toBeUndefined();
});
