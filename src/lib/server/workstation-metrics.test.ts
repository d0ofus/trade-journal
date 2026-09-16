import { afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadTradeMetrics } from "./workstation-metrics";
import { previousSession } from "@/lib/workstation/market-metrics";
import { demoTrades } from "@/lib/workstation/demo";
import type { Candle } from "@/lib/workstation/types";

const mocks = vi.hoisted(() => ({ bars: vi.fn(), shares: vi.fn() }));
vi.mock("./workstation-cache-provider", () => ({ fetchCompactCandles: mocks.bars }));
vi.mock("./historical-shares", () => ({ historicalShares: mocks.shares }));
// Metric identity tests control admission; storage budgets have their own suite.
vi.mock("./workstation-cache-store", () => ({ foregroundPending: async () => false, cacheUsage: async () => ({ cacheBytes: 0, databaseBytes: 0 }) }));
afterEach(async () => { vi.unstubAllEnvs(); vi.clearAllMocks(); await prisma.workstationMetricCache.deleteMany({ where: { symbol: { in: ["METRIC_TEST", "IE"] } } }); });

it("shares concurrent metric work, cancels future splits, and never calculates with post-reference data", async () => {
  vi.stubEnv("TRADES_CHART_PROVIDER", "alpaca"); vi.stubEnv("TRADES_ALPACA_API_KEY_ID", "fixture"); vi.stubEnv("TRADES_ALPACA_API_SECRET_KEY", "fixture");
  const trade = { ...demoTrades[0], symbol: "METRIC_TEST", assetType: "STOCK", executions: [{ ...demoTrades[0].executions[0], time: Date.parse("2026-06-04T13:30:01Z") / 1000 }] };
  const reference = previousSession("2026-06-04")!;
  const raw: Candle[] = []; let cursor = reference;
  for (let i = 0; i < 250; i++) {
    const close = i > 30 ? 100 : 50;
    raw.unshift({ time: cursor.open, open: close, high: close * 1.02, low: close * .98, close, volume: 1000 });
    cursor = previousSession(cursor.date)!;
  }
  // An intervening 2:1 split, plus a subsequent 2:1 split already in adjusted data.
  const adjusted = raw.map(c => { const factor = c.close / 25; return { ...c, open: 25, close: 25, high: 25.5, low: 24.5, volume: c.volume * factor }; });
  mocks.bars.mockImplementation(async (_symbol, _interval, _range, credentials) => [...(credentials.adjustment === "raw" ? raw : adjusted), { ...adjusted.at(-1)!, time: reference.close + 86400, close: 100000 }]);
  mocks.shares.mockResolvedValue({ val: 100, end: new Date(raw[0].time * 1000).toISOString().slice(0, 10), filed: "2025-07-01", source: "https://data.sec.gov/fixture" });
  const [a, b] = await Promise.all([loadTradeMetrics(trade, new AbortController().signal), loadTradeMetrics({ ...trade, id: "another-trade" }, new AbortController().signal)]);
  expect(a).toEqual(b); expect(a.asOf).toBe("2026-06-03"); expect(a.marketCap.value).toBe(10000);
  expect(a.adr.value).toBeCloseTo(4); expect(a.atr.value).toBeCloseTo(4); expect(a.dollarVolume.value).toBe(50000);
  expect(mocks.bars).toHaveBeenCalledTimes(2); expect(mocks.shares).toHaveBeenCalledTimes(1);
  for (const call of mocks.bars.mock.calls) expect(call[2].to).toBe(reference.close + 1);
  await loadTradeMetrics(trade, new AbortController().signal);
  expect(mocks.bars).toHaveBeenCalledTimes(2);
});

it("calculates January 7 legacy IE against January 6, separates eligibility caches, and preserves missing-share and ETF reasons", async () => {
  vi.stubEnv("TRADES_CHART_PROVIDER", "alpaca"); vi.stubEnv("TRADES_ALPACA_API_KEY_ID", "fixture"); vi.stubEnv("TRADES_ALPACA_API_SECRET_KEY", "fixture");
  const trade = { ...demoTrades[0], symbol: "IE", assetType: "OTHER", executions: [{ ...demoTrades[0].executions[0], time: Date.parse("2026-01-07T15:00:00Z") / 1000 }] };
  const reference = previousSession("2026-01-07")!;
  const bars: Candle[] = []; let cursor = reference;
  for (let i = 0; i < 30; i++) { bars.unshift({ time: cursor.open, open: 10, close: 10, high: 11, low: 9, volume: 1000 }); cursor = previousSession(cursor.date)!; }
  mocks.bars.mockResolvedValue(bars); mocks.shares.mockResolvedValue(null);
  const legacy = await loadTradeMetrics(trade, new AbortController().signal);
  expect(legacy.asOf).toBe("2026-01-06"); expect(legacy.eligibilityBasis).toBe("legacy-shares");
  expect(legacy.adr.value).toBe(20); expect(legacy.atr.value).toBe(20); expect(legacy.dollarVolume.value).toBe(10000);
  expect(legacy.marketCap).toEqual({ value: null, reason: "Historical shares unavailable" });
  expect((await loadTradeMetrics({ ...trade, assetType: "STOCK" }, new AbortController().signal)).eligibilityBasis).toBe("stock");
  const etf = await loadTradeMetrics({ ...trade, assetType: "ETF" }, new AbortController().signal);
  expect(etf.eligibilityBasis).toBe("etf"); expect(etf.marketCap.reason).toContain("ETF");
  expect(mocks.bars).toHaveBeenCalledTimes(6); expect(mocks.shares).toHaveBeenCalledTimes(2);
  const cached = await prisma.workstationMetricCache.findMany({ where: { symbol: "IE" } });
  expect(cached).toHaveLength(3); expect(cached.every(row => row.version === 2)).toBe(true);
  const option = await loadTradeMetrics({ ...trade, symbol: "IE260116C00010000" }, new AbortController().signal);
  expect(option.adr.reason).toBe("Unsupported instrument"); expect(mocks.bars).toHaveBeenCalledTimes(6);
});
