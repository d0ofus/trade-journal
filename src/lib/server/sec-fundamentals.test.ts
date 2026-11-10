import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadTradeFundamentals } from "./sec-fundamentals";
import { testCompanyFacts } from "./sec-fundamentals-fixtures";
import { demoTrades } from "@/lib/workstation/demo";
import type { SecCacheEntry } from "./sec-fundamentals-cache";
import { SecRequestError } from "./sec-client";
vi.mock("./sec-fundamentals-cache", () => ({ readSecCache: vi.fn(), writeSecCache: vi.fn() }));
vi.mock("./sec-client", async importOriginal => ({ ...await importOriginal<typeof import("./sec-client")>(), secJson: vi.fn(), secText: vi.fn() }));
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
it("falls back after a valid empty/404 Company Facts response, with native currency and versioned caches", async () => {
  const { deps, cache } = setup();
  cache.set("facts:v1:0000000001", { value: {}, fetchedAt: new Date().toISOString() });
  const text = vi.fn(async () => '<h2>Consolidated statements of income</h2><p>IFRS, EUR in millions</p><table><tr><th></th><th>Three months ended March 31, 2025</th></tr><tr><td>Revenue</td><td>120</td></tr><tr><td>Profit for the period</td><td>10</td></tr></table>');
  deps.fetch.mockImplementation(async url => {
    if (url.includes("company_tickers")) return { "0": { ticker: "TEST", cik_str: 1, title: "Test" } };
    if (url.includes("companyfacts")) throw new SecRequestError("Not found", false, 404);
    return { filings: { recent: { form: ["20-F", "6-K"], filingDate: ["2025-04-01", "2025-04-15"], accessionNumber: ["0000000001-25-000001", "0000000001-25-000002"], primaryDocument: ["annual.htm", "quarter.htm"] }, files: [] } } as never;
  });
  const result = await loadTradeFundamentals(trade(), "before-entry", new AbortController().signal, { ...deps, text });
  // The fixture has only a quarterly report and no verified year-end anchor.
  expect(result.currency).toBe("EUR"); expect(result.message).not.toContain("10-Q/10-K");
  expect(cache.has("facts:v2:0000000001")).toBe(true); expect(text).toHaveBeenCalled();
});
it("returns partial available history with Retry when filing retrieval fails", async () => {
  const { deps } = setup();
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("submissions")) throw new Error("provider failure");
    return deps.fetch(url);
  });
  const result = await loadTradeFundamentals(trade(), "before-entry", new AbortController().signal, { ...deps, fetch, text: vi.fn() });
  expect(result).toMatchObject({ status: "ready", retryable: true, coverage: "partial" });
  expect(result.quarters).toHaveLength(4); expect(result.message).toContain("retrieval is incomplete");
});
it("keeps previously cached filing quarters visible when Company Facts refresh fails", async () => {
  const { deps } = setup();
  const fetch = vi.fn(async (url: string): Promise<unknown> => url.includes("submissions") ? { filings: { recent: { form: ["6-K"], filingDate: ["2025-04-15"], accessionNumber: ["0000000001-25-000009"], primaryDocument: ["quarter.htm"] }, files: [] } } : deps.fetch(url));
  const text = vi.fn(async () => '<h2>Consolidated statements of income</h2><p>USD in millions</p><table><tr><th></th><th>Three months ended March 31, 2025</th></tr><tr><td>Revenue</td><td>777</td></tr><tr><td>Net income</td><td>10</td></tr></table>');
  const signal = new AbortController().signal;
  const first = await loadTradeFundamentals(trade(), "before-entry", signal, { ...deps, fetch, text });
  expect(first.quarters.at(-1)?.revenue?.value).toBe(777000000);
  vi.setSystemTime(new Date("2026-09-30T00:00:00Z")); fetch.mockRejectedValue(new Error("SEC unavailable"));
  const stale = await loadTradeFundamentals(trade(), "before-entry", signal, { ...deps, fetch, text });
  expect(stale).toMatchObject({ status: "ready", stale: true, retryable: true, quarters: first.quarters });
  expect(text).toHaveBeenCalledTimes(1);
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
