import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadTradeFundamentals } from "./sec-fundamentals";
import { testCompanyFacts } from "./sec-fundamentals-fixtures";
import { demoTrades } from "@/lib/workstation/demo";
import type { SecCacheEntry } from "./sec-fundamentals-cache";
vi.mock("./sec-fundamentals-cache", () => ({ readSecCache: vi.fn(), writeSecCache: vi.fn() }));
vi.mock("./sec-client", () => ({ secJson: vi.fn() }));
vi.mock("./workstation-cache-store", () => ({ claimCacheLease: vi.fn(), releaseCacheLease: vi.fn() }));
const trade = (date = "2025-05-01T13:30:00Z") => ({ ...demoTrades[0], symbol: "TEST", assetType: "STOCK", executions: [{ ...demoTrades[0].executions[0], time: Date.parse(date) / 1000 }] });
function setup() {
  const cache = new Map<string, SecCacheEntry>();
  const deps = { read: vi.fn(async (key: string) => cache.get(key) ?? null), write: vi.fn(async (key: string, entry: SecCacheEntry) => { cache.set(key, entry); }), claim: vi.fn(async (key: string) => ({ key, token: "test" })), release: vi.fn(async () => {}), fetch: vi.fn(async (url: string) => url.includes("company_tickers") ? { "0": { ticker: "TEST", cik_str: 1, title: "Test Company" } } : testCompanyFacts()) };
  return { cache, deps };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T00:00:00Z")); });
afterEach(() => vi.useRealTimers());
it("automatically fetches cold data, shares cache across trades and recalculates each cutoff", async () => {
  const { deps } = setup(), signal = new AbortController().signal;
  const first = await loadTradeFundamentals(trade(), "before-entry", signal, deps);
  expect(first.status).toBe("ready"); expect(first.quarters).toHaveLength(4); expect(deps.fetch).toHaveBeenCalledTimes(2);
  const later = await loadTradeFundamentals(trade("2025-08-02T13:30:00Z"), "before-entry", signal, deps);
  expect(later.quarters).toHaveLength(6); expect(deps.fetch).toHaveBeenCalledTimes(2);
});
it("deduplicates concurrent requests and applies historical/latest expiry independently", async () => {
  const { deps } = setup(), signal = new AbortController().signal;
  await Promise.all([loadTradeFundamentals(trade(), "before-entry", signal, deps), loadTradeFundamentals(trade(), "before-entry", signal, deps)]);
  expect(deps.fetch).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date("2026-09-28T00:16:00Z"));
  await loadTradeFundamentals(trade(), "before-entry", signal, deps); expect(deps.fetch).toHaveBeenCalledTimes(2);
  await loadTradeFundamentals(trade(), "latest", signal, deps); expect(deps.fetch).toHaveBeenCalledTimes(3);
  vi.setSystemTime(new Date("2026-09-29T01:00:00Z"));
  await loadTradeFundamentals(trade(), "before-entry", signal, deps); expect(deps.fetch).toHaveBeenCalledTimes(5);
});
it("preserves cached historical data on SEC failure without leaking later values", async () => {
  const { deps } = setup(), signal = new AbortController().signal;
  const original = await loadTradeFundamentals(trade(), "before-entry", signal, deps);
  vi.setSystemTime(new Date("2026-09-30T00:00:00Z")); deps.fetch.mockRejectedValue(new Error("provider secret"));
  const fallback = await loadTradeFundamentals(trade(), "before-entry", signal, deps);
  expect(fallback).toMatchObject({ status: "ready", stale: true, retryable: true, quarters: original.quarters });
  expect(JSON.stringify(fallback)).not.toContain("provider secret");
});
it("reports a retryable cold failure and distinguishes unresolved dates, unsupported instruments and tickers", async () => {
  const { deps } = setup(), signal = new AbortController().signal;
  const unresolved = { ...trade(), executions: trade().executions.map(e => ({ ...e, provenance: undefined })) };
  expect((await loadTradeFundamentals(unresolved, "before-entry", signal, deps)).status).toBe("unresolved-date");
  expect((await loadTradeFundamentals({ ...trade(), assetType: "ETF" }, "latest", signal, deps)).status).toBe("unsupported"); expect(deps.fetch).not.toHaveBeenCalled();
  expect((await loadTradeFundamentals({ ...trade(), symbol: "MISSING" }, "latest", signal, deps)).status).toBe("unknown-ticker");
  deps.fetch.mockRejectedValue(new Error("timeout"));
  expect((await loadTradeFundamentals(trade(), "latest", signal, deps)).status).toBe("unavailable");
});
it("rechecks confirmed missing financial facts after one hour", async () => {
  const { deps } = setup(), signal = new AbortController().signal;
  deps.fetch.mockImplementation(async url => url.includes("company_tickers") ? { "0": { ticker: "TEST", cik_str: 1, title: "Test" } } : testCompanyFacts({}));
  expect((await loadTradeFundamentals(trade(), "before-entry", signal, deps)).status).toBe("unsupported");
  vi.setSystemTime(new Date("2026-09-28T01:01:00Z"));
  await loadTradeFundamentals(trade(), "before-entry", signal, deps); expect(deps.fetch).toHaveBeenCalledTimes(4);
});
it("uses the New York day rather than UTC and never fetches unresolved historical data", async () => {
  const { deps } = setup();
  const result = await loadTradeFundamentals(trade("2025-05-02T01:00:00Z"), "before-entry", new AbortController().signal, deps);
  expect(result.cutoff).toBe("2025-05-01"); expect(result.quarters).toHaveLength(4);
});
it.each([undefined, "OTHER", " other "])("loads SEC fundamentals for legacy %s stock imports without changing their classification", async assetType => {
  const { deps } = setup(), legacy = { ...trade(), assetType };
  const result = await loadTradeFundamentals(legacy, "before-entry", new AbortController().signal, deps);
  expect(result.status).toBe("ready"); expect(result.quarters).toHaveLength(4);
  expect(deps.fetch).toHaveBeenCalledTimes(2); expect(legacy.assetType).toBe(assetType);
});
it.each(["OPTION", "OTHER", undefined])("rejects option contracts classified as %s before requesting SEC data", async assetType => {
  const { deps } = setup();
  const result = await loadTradeFundamentals({ ...trade(), symbol: "TEST  250516C00250000", assetType }, "latest", new AbortController().signal, deps);
  expect(result.status).toBe("unsupported"); expect(deps.fetch).not.toHaveBeenCalled();
});
