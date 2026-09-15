import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { cacheHash, candleChunks, decodeCandles, encodeCandles, replaceSegments } from "./workstation-cache-codec";
import { cacheBudgetAvailable, cacheUsage, claimCacheLease, persistCompactCandles, readCompactCandles, releaseCacheLease, seriesKey, takeProviderSlot } from "./workstation-cache-store";
import { loadWorkstationCandles } from "./workstation-candles";
import { fetchCompactCandles } from "./workstation-cache-provider";
import { planCandlePreparation, queueCandlePreparation, runCandlePreparation, retryCandlePreparation } from "./workstation-cache-jobs";
import { demoTrades } from "@/lib/workstation/demo";
import { missingRanges, unionRanges } from "@/lib/workstation/candle-ranges";
import type { Candle, CandleTimeframe } from "./market-candles";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import muFixture from "../../../fixtures/workstation-alpaca-mu-bars.json";
import { timingDemoTrade } from "@/lib/workstation/timing-demo";
import { diagnoseExecution } from "@/lib/workstation/execution-diagnostics";
import { candleIdentity } from "@/lib/workstation/regular-hours";
import type { CandleSession } from "@/lib/workstation/types";
import * as workstationRead from "./trade-workstation";
import * as cacheStore from "./workstation-cache-store";

const from = Date.parse("2024-09-03T12:00:00Z") / 1000;
const range = { from, to: from + 3600 }, source = "workstation:v1:alpaca:sip:raw:extended";
const series = { symbol: "CACHE_TEST", timeframe: "5m" as const, source };
const candle = (time = from, price = 1008.71000000001): Candle => ({ time, open: price, high: price + 1.123456789, low: price - 0.12345678, close: price + 0.5, volume: 1234567 });
const api = (bars: Candle[], next: string | null = null, symbol = series.symbol) => Response.json({ bars: { [symbol]: bars.map(c => ({ t: new Date(c.time * 1000).toISOString(), o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })) }, next_page_token: next });
const input = { symbol: series.symbol, timeframe: series.timeframe, range: { from, to: range.to - 1 }, limit: 30001, session: "extended" as const };
beforeEach(async () => {
  vi.stubEnv("TRADES_CANDLE_CACHE_ENABLED", "1"); vi.stubEnv("TRADES_CANDLE_PREPARE_ENABLED", "1");
  vi.stubEnv("TRADES_CHART_PROVIDER", "alpaca"); vi.stubEnv("TRADES_ALPACA_API_KEY_ID", "isolated-dummy-key"); vi.stubEnv("TRADES_ALPACA_API_SECRET_KEY", "isolated-dummy-secret");
  vi.stubEnv("TRADES_ALPACA_DATA_FEED", "sip"); vi.stubEnv("TRADES_ALPACA_DELAY_SECONDS", "900");
  await prisma.workstationCandleLease.deleteMany(); await prisma.workstationCandleJob.deleteMany(); await prisma.workstationCandleChunk.deleteMany();
  vi.stubGlobal("fetch", vi.fn(async () => api([candle()])));
});
afterEach(async () => { await prisma.workstationCandleChunk.deleteMany(); await prisma.workstationCandleLease.deleteMany(); await prisma.workstationCandleJob.deleteMany(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("compact candle cache on isolated PostgreSQL", () => {
  it("lets supplementary work enter the provider queue before expensive storage accounting", async () => {
    const preflight = vi.spyOn(cacheStore, "cacheBudgetAvailable");
    const result = await loadWorkstationCandles({ ...input, purpose: "benchmark", mode: "complete" });
    expect(result.candles).toHaveLength(1);
    expect(preflight).not.toHaveBeenCalled();
    expect(result.cache?.timings?.storageCheckMs).toBe(0);
    expect(await prisma.workstationCandleChunk.findFirst({ where: { symbol: series.symbol } })).toMatchObject({ supplementary: true, tradeWindow: false });
  });
  it("preserves all eight confirmed MU fills against frozen native Alpaca SIP/raw bars", () => {
    const encoded = encodeCandles(muFixture.candles), bars = decodeCandles(encoded.payload, encoded.checksum).map(c => ({ ...c, volume: c.volume ?? 0 }));
    expect(bars).toEqual(muFixture.candles);
    for (const execution of timingDemoTrade(true).executions) expect(diagnoseExecution(execution, bars, "5m", muFixture.session as CandleSession).status).toBe("matching");
  });
  it("round-trips original numbers exactly and rejects corrupt/unsupported payloads", () => {
    const bars = [candle(), { ...candle(from + 300), volume: undefined }]; const encoded = encodeCandles(bars);
    expect(decodeCandles(encoded.payload, encoded.checksum)).toEqual(bars);
    expect(() => decodeCandles(encoded.payload, "bad")).toThrow(); expect(() => decodeCandles(encoded.payload, encoded.checksum, 2)).toThrow();
    expect(() => encodeCandles([{ ...candle(), high: 1 }])).toThrow();
    expect(cacheHash(encoded.payload)).toHaveLength(64);
  });
  it("tracks half-open coverage independently from empty candle periods", () => {
    expect(unionRanges([{ from: 2, to: 4 }, { from: 1, to: 2 }])).toEqual([{ from: 1, to: 4 }]);
    expect(missingRanges({ from: 1, to: 8 }, [{ from: 2, to: 5 }, { from: 4, to: 6 }])).toEqual([{ from: 1, to: 2 }, { from: 6, to: 8 }]);
    expect(replaceSegments([{ from: 1, to: 8, at: 10 }], { from: 3, to: 4, at: 20 })).toEqual([{ from: 1, to: 3, at: 10 }, { from: 3, to: 4, at: 20 }, { from: 4, to: 8, at: 10 }]);
    expect(candleChunks({ from: Date.parse("2024-12-31Z") / 1000, to: Date.parse("2025-01-02Z") / 1000 }, "1d")).toHaveLength(2);
  });
  it.each(["5m", "10m", "15m", "1h", "1d", "1wk"] as CandleTimeframe[])("reuses extended %s history after a new request with zero upstream calls", async timeframe => {
    const first = await loadWorkstationCandles({ ...input, timeframe }); expect(first.candles).toEqual([candle()]); expect(first.cache?.missing).toEqual([]);
    vi.mocked(fetch).mockClear(); const second = await loadWorkstationCandles({ ...input, timeframe });
    expect(second.candles).toEqual(first.candles); expect(second.provider.cached).toBe(true); expect(fetch).not.toHaveBeenCalled();
    expect((await cacheUsage()).cacheBytes).toBeLessThan(1e6);
  });
  it("publishes legacy rows as partial data without downloading or claiming verified coverage", async () => {
    const c = candle();
    await prisma.marketCandle.create({ data: { symbol: series.symbol, timeframe: "5m", source, time: new Date(from * 1000), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume } });
    try { const result = await loadWorkstationCandles({ ...input, mode: "cache" }); expect(result.candles).toHaveLength(1); expect(result.candles[0].low).toBeCloseTo(c.low, 10); expect(result.cache?.status).toBe("partial"); expect(fetch).not.toHaveBeenCalled(); }
    finally { await prisma.marketCandle.deleteMany({ where: { symbol: series.symbol, source } }); }
  });
  it("does not re-request successful sparse/empty sessions, weekends or holidays", async () => {
    vi.mocked(fetch).mockImplementation(async () => api([]));
    for (const date of ["2024-09-02", "2024-09-07", "2024-03-10", "2024-11-03"]) {
      const start = Date.parse(date) / 1000;
      const request = { ...input, range: { from: start, to: start + 86399 }, mode: "fill" as const };
      await prisma.workstationCandleLease.deleteMany();
      const result = await loadWorkstationCandles(request); expect(result.cache?.missing).toEqual([]);
      vi.mocked(fetch).mockClear(); expect((await loadWorkstationCandles(request)).candles).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    }
  });
  it("fetches only an overlapping request's missing suffix and separates regular session identity", async () => {
    await loadWorkstationCandles(input); vi.mocked(fetch).mockClear(); await prisma.workstationCandleLease.deleteMany();
    await loadWorkstationCandles({ ...input, range: { from: from + 1800, to: from + 7200 }, mode: "fill" });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0])); expect(Date.parse(url.searchParams.get("start")!) / 1000).toBe(range.to - .999);
    vi.mocked(fetch).mockClear(); await prisma.workstationCandleLease.deleteMany();
    await loadWorkstationCandles({ ...input, session: "regular" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("coalesces simultaneous panels through a database lease", async () => {
    let finish!: () => void; const blocked = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementation(async () => { await blocked; return api([candle()]); });
    const first = loadWorkstationCandles(input);
    while (!vi.mocked(fetch).mock.calls.length) await new Promise(r => setTimeout(r, 5));
    const second = await loadWorkstationCandles(input); expect(second.cache?.retryAfterMs).toBe(1000); expect(fetch).toHaveBeenCalledTimes(1);
    finish(); await first; expect((await loadWorkstationCandles(input)).cache?.missing).toEqual([]); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("commits all pages together and discards an interrupted pagination without coverage", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => api([candle()], "page2")).mockImplementationOnce(async () => api([candle(from + 300)]));
    const result = await loadWorkstationCandles(input); expect(result.candles).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(2); expect(result.cache?.missing).toEqual([]);
    await prisma.workstationCandleChunk.deleteMany(); await prisma.workstationCandleLease.deleteMany();
    vi.stubEnv("TRADES_CHART_YAHOO_FALLBACK", "0");
    vi.mocked(fetch).mockImplementationOnce(async () => api([candle()], "page2")).mockImplementationOnce(async () => Response.json({}, { status: 503 }));
    await expect(loadWorkstationCandles(input)).rejects.toThrow(); expect(await prisma.workstationCandleCoverage.count()).toBe(0);
  });
  it("fences expired writes and rolls coverage back with failed persistence", async () => {
    const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
    await prisma.workstationCandleLease.update({ where: { key: lease.key }, data: { expiresAt: new Date(0) } });
    await expect(persistCompactCandles(series, range, [candle()], lease, false)).rejects.toThrow("expired");
    expect(await prisma.workstationCandleCoverage.count()).toBe(0);
    const next = (await claimCacheLease(lease.key))!; await releaseCacheLease(lease); expect(await prisma.workstationCandleLease.count({ where: next })).toBe(1);
  });
  it("excludes corruption, never rounds long wicks, and leaves protected trade windows intact", async () => {
    const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
    const wick = { ...candle(), high: 1250.123456789, low: 850.99999999 };
    await persistCompactCandles(series, range, [wick], lease, true);
    expect((await readCompactCandles(series, range, 30000)).candles).toEqual([wick]);
    await prisma.workstationCandleChunk.updateMany({ data: { checksum: "damaged" } });
    const result = await readCompactCandles(series, range, 30000); expect(result.candles).toEqual([]); expect(result.cache.missing).toEqual([range]);
    await persistCompactCandles(series, range, [wick], lease, false); expect((await prisma.workstationCandleChunk.findFirst())?.tradeWindow).toBe(true);
  });
  it("keeps historical Alpaca bars during outages and refuses to mix a different identity", async () => {
    await loadWorkstationCandles(input); await prisma.workstationCandleLease.deleteMany(); vi.mocked(fetch).mockImplementation(async () => Response.json({}, { status: 503 }));
    const result = await loadWorkstationCandles({ ...input, range: { from, to: from + 7200 } }); expect(result.candles).toEqual([candle()]); expect(result.provider.provider).toBe("alpaca"); expect(result.provider.fallback).toBe(false);
    await expect(loadWorkstationCandles({ ...input, identity: "workstation:v1:alpaca:iex:raw:extended" })).rejects.toThrow("identity");
  });
  it("honours rate-limit cooldown and background priority", async () => {
    await prisma.workstationCandleLease.create({ data: { key: "foreground", token: "test", expiresAt: new Date(Date.now() + 5000) } });
    expect(await takeProviderSlot(true)).toBe(false); expect(await takeProviderSlot(false)).toBe(true);
    await prisma.workstationCandleLease.deleteMany(); vi.mocked(fetch).mockImplementation(async () => Response.json({}, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(fetchCompactCandles(series.symbol, "5m", range, workstationCandlePolicy().credentials!)).rejects.toThrow("429");
    expect(await takeProviderSlot(false)).toBe(false); expect(await prisma.workstationCandleCoverage.count()).toBe(0);
  });
  it("plans the three selected timeframes, coalesces duplicates and covers entire long holdings", () => {
    const trade = { ...demoTrades[0], closeTime: demoTrades[0].openTime + 97 * 86400 };
    const planned = planCandlePreparation([trade, trade], trade.closeTime + 10 * 86400);
    expect(new Set(planned.map(p => p.timeframe)).size).toBe(3);
    const five = planned.filter(p => p.timeframe === "5m"); expect(five.length).toBeGreaterThan(6);
    expect(missingRanges({ from: trade.openTime, to: trade.closeTime }, five.map(p => p.range))).toEqual([]);
    expect(planned).toEqual(planCandlePreparation([trade], trade.closeTime + 10 * 86400));
  });
  it("durably retries failed background jobs without touching imported data", async () => {
    await prisma.workstationCandleJob.create({ data: { key: "test-job", ...series, session: "extended", start: new Date(from * 1000), end: new Date(range.to * 1000) } });
    vi.mocked(fetch).mockImplementation(async () => Response.json({}, { status: 503 }));
    const before = await prisma.execution.count(); await runCandlePreparation(100);
    const job = await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "test-job" } });
    expect(job.status).toBe("pending"); expect(job.attempts).toBe(1); expect(job.lastError).toContain("503"); expect(await prisma.execution.count()).toBe(before);
    vi.stubEnv("TRADES_CANDLE_PREPARE_ENABLED", "0"); expect((await queueCandlePreparation()).added).toBe(0);
  });
  it("preserves both exploratory and trade chunks when growth is paused", async () => {
    const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
    await persistCompactCandles(series, range, [candle()], lease, true);
    const later = { from: from + 86400, to: range.to + 86400 };
    await persistCompactCandles(series, later, [candle(later.from)], lease, false);
    const reader = { $queryRaw: async <T>() => [{ cache: BigInt(100_000_000), databases: BigInt(400_000_000) }] as T } as Parameters<typeof cacheBudgetAvailable>[0];
    expect(await cacheBudgetAvailable(reader)).toBe(false);
    expect(await prisma.workstationCandleChunk.count()).toBe(2);
    expect(await prisma.workstationCandleCoverage.count()).toBe(2);
    expect((await cacheUsage(reader)).persistencePaused).toBe(true);
  });
  it("revalidates recent data no more often than 15 minutes and never refreshes old history implicitly", async () => {
    const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
    await persistCompactCandles(series, range, [candle()], lease, false);
    const row = await prisma.workstationCandleCoverage.findFirstOrThrow();
    const now = range.to + 3600;
    await prisma.workstationCandleCoverage.update({ where: { chunkKey: row.chunkKey }, data: { segments: JSON.stringify([{ ...range, at: now - 899 }]) } });
    expect((await readCompactCandles(series, range, 30000, now)).cache.refresh).toEqual([]);
    expect((await readCompactCandles(series, range, 30000, now + 2)).cache.refresh).toEqual([range]);
    expect((await readCompactCandles(series, range, 30000, now + 8 * 86400)).cache.refresh).toEqual([]);
  });
  it("persists the three selected timeframe jobs idempotently before fetching any bars", async () => {
    vi.spyOn(workstationRead, "listWorkstationTrades").mockResolvedValue([demoTrades[0], demoTrades[0]]);
    const first = await queueCandlePreparation(), second = await queueCandlePreparation();
    expect(first.added).toBeGreaterThanOrEqual(3); expect(second.added).toBe(0); expect(fetch).not.toHaveBeenCalled();
    const jobs = await prisma.workstationCandleJob.findMany(); expect(new Set(jobs.map(j => j.timeframe)).size).toBe(3); expect(jobs.every(j => j.status === "pending")).toBe(true);
  });
  it("excludes legacy options, retires obsolete pending work and rechecks completed jobs on request", async () => {
    const option = { ...demoTrades[0], symbol: "ZS    250516C00250000", assetType: "OTHER" };
    expect(planCandlePreparation([option])).toEqual([]);
    vi.spyOn(workstationRead, "listWorkstationTrades").mockResolvedValue([demoTrades[0], option]);
    await prisma.workstationCandleJob.create({ data: { key: "obsolete", ...series, session: "extended", start: new Date(from * 1000), end: new Date(range.to * 1000) } });
    await queueCandlePreparation();
    expect((await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "obsolete" } })).status).toBe("skipped");
    expect(await prisma.workstationCandleJob.count({ where: { symbol: option.symbol } })).toBe(0);
    await prisma.workstationCandleJob.updateMany({ where: { status: "pending" }, data: { status: "done" } });
    await queueCandlePreparation(false, true);
    expect(await prisma.workstationCandleJob.count({ where: { status: "pending" } })).toBeGreaterThanOrEqual(3);
    await prisma.workstationCandleJob.update({ where: { key: "obsolete" }, data: { status: "done", updatedAt: new Date(0), end: new Date() } });
    await queueCandlePreparation(false, false, true);
    expect((await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "obsolete" } })).status).toBe("done");
    const instrument = await prisma.instrument.create({ data: { symbol: option.symbol, assetType: "OTHER", exchange: "CACHE-OPTION-TEST" } });
    try {
      await prisma.workstationCandleJob.create({ data: { key: "option-failure", ...series, symbol: option.symbol, session: "extended", start: new Date(from * 1000), end: new Date(range.to * 1000), status: "unavailable" } });
      await retryCandlePreparation();
      expect((await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "option-failure" } })).status).toBe("skipped");
    } finally { await prisma.instrument.delete({ where: { id: instrument.id } }); }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resumes an expired job lease and protects its completed trade window", async () => {
    await prisma.workstationCandleJob.create({ data: { key: "expired-job", ...series, session: "extended", start: new Date(from * 1000), end: new Date(range.to * 1000), status: "running", leaseUntil: new Date(0), leaseToken: "old-worker" } });
    const result = await runCandlePreparation(1000); expect(result.processed).toBe(1);
    expect((await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "expired-job" } })).status).toBe("done");
    expect((await prisma.workstationCandleChunk.findFirstOrThrow()).tradeWindow).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await claimCacheLease("worker:0"); await claimCacheLease("worker:1");
    expect((await runCandlePreparation(100)).paused).toContain("Two preparation runners"); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}])("recognizes a successful empty bars envelope (%j)", async bars => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ bars, next_page_token: null }));
    expect((await loadWorkstationCandles(input)).cache?.missing).toEqual([]);
    vi.mocked(fetch).mockClear(); expect((await loadWorkstationCandles(input)).candles).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not create new one-second provider requests as the recent cutoff moves", async () => {
    const now = Math.floor(Date.now() / 900_000) * 900_000 + 300_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const request = { ...input, range: { from: Math.floor(now / 1000) - 3 * 86400, to: Math.floor(now / 1000) + 86400 } };
    const first = await loadWorkstationCandles(request); expect(first.cache?.missing).toEqual([]);
    vi.mocked(fetch).mockClear(); clock.mockReturnValue(now + 1000);
    const second = await loadWorkstationCandles(request); expect(second.cache?.effectiveRange).toEqual(first.cache?.effectiveRange); expect(fetch).not.toHaveBeenCalled();
  });
  it("pauses growth at either independent budget with write headroom", async () => {
    const reader = (cache: number, databases: number) => ({ $queryRaw: async <T>() => [{ cache: BigInt(cache), databases: BigInt(databases) }] as T }) as Parameters<typeof cacheBudgetAvailable>[0];
    expect(await cacheBudgetAvailable(reader(98_999_999, 398_999_999))).toBe(true);
    expect(await cacheBudgetAvailable(reader(99_000_000, 10_000_000))).toBe(false);
    expect(await cacheBudgetAvailable(reader(10_000_000, 399_000_000))).toBe(false);
  });
});

describe("separate market-open hourly cache", () => {
  const day = Date.parse("2024-09-03Z") / 1000, open = day + 13.5 * 3600, close = day + 20 * 3600;
  const request = { symbol: series.symbol, timeframe: "1h" as const, range: { from: day, to: day + 86400 - .001 }, limit: 30000, session: "regular" as const };
  async function saveSource(range: { from: number; to: number }, bars: Candle[]) {
    const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!; await persistCompactCandles(series, range, bars, lease, true); await releaseCacheLease(lease);
  }
  it("successful background progress clears failure attempts and is immediately eligible", async () => {
    await prisma.workstationCandleJob.create({ data: { key: "partial-job", symbol: series.symbol, timeframe: "1h", source: candleIdentity(workstationCandlePolicy().cacheSource, "1h", "regular"), session: "regular", start: new Date(day * 1000), end: new Date((day + 30 * 86400) * 1000), attempts: 4 } });
    const progress = await runCandlePreparation(1000);
    expect(progress.advanced).toBeGreaterThan(0);
    const job = await prisma.workstationCandleJob.findUniqueOrThrow({ where: { key: "partial-job" } });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeNull();
    expect(job.availableAt.getTime() - job.updatedAt.getTime()).toBeLessThan(100);
    expect(fetch).toHaveBeenCalled();
  });
  it("fills one bounded hourly window without retry delay or duplicate source-cache reads", async () => {
    const reads = vi.spyOn(prisma.workstationCandleChunk, "findMany");
    vi.mocked(fetch).mockImplementation(async () => api([candle(open)]));
    const result = await loadWorkstationCandles({ ...request, range: { from: day, to: day + 30 * 86400 - 1 }, mode: "fill" });
    expect(result.cache?.progressed).toBe(true);
    expect(result.cache?.missing.length).toBeGreaterThan(0);
    expect(result.cache?.retryAfterMs).toBeUndefined();
    expect(result.cache?.timings?.providerRequestCount).toBe(1);
    // One hourly snapshot plus three batched 14-day reads, shared with aggregation.
    expect(reads).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("cancels a provider wait without marking any missing bars covered", async () => {
    const controller = new AbortController();
    await prisma.workstationCandleLease.create({ data: { key: "rate:cooldown", token: "test", expiresAt: new Date(Date.now() + 60_000) } });
    const timers = vi.spyOn(globalThis, "setTimeout");
    const pending = fetchCompactCandles(series.symbol, "5m", range, workstationCandlePolicy().credentials!, false, true, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(timers).toHaveBeenCalledWith(expect.any(Function), 525));
    controller.abort();
    await rejected;
    expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.workstationCandleCoverage.count()).toBe(0);
  });
  it("cancels an in-flight provider download without certifying coverage", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true })));
    const pending = fetchCompactCandles(series.symbol, "5m", range, workstationCandlePolicy().credentials!, false, false, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort(); await rejected;
    expect(await prisma.workstationCandleCoverage.count()).toBe(0);
  });
  it("plans 30 days before the final interpreted fill without shrinking older entry coverage", () => {
    const close = day + 40 * 86400;
    const trade = { ...demoTrades[0], openTime: close - 3600, closeTime: close, executions: [{ ...demoTrades[0].executions[0], time: close + 3600 }] };
    const planned = planCandlePreparation([trade, trade], close + 10 * 86400).filter(p => p.timeframe === "1h");
    expect(missingRanges({ from: close + 3600 - 30 * 86400, to: close + 3600 }, planned.map(p => p.range))).toEqual([]);
    expect(planned.every(p => p.range.to <= close + 10 * 86400)).toBe(true);
  });
  it("reuses cached 5m coverage, persists independent hourly chunks and revisits with zero provider requests", async () => {
    const bars = [candle(open), candle(open + 300), candle(close - 300)]; await saveSource({ from: open, to: close }, bars);
    const partial = await loadWorkstationCandles({ ...request, mode: "cache" }); expect(partial.candles).toHaveLength(2); expect(fetch).not.toHaveBeenCalled();
    const result = await loadWorkstationCandles(request); expect(result.candles).toHaveLength(2); expect(result.cache?.missing).toEqual([]); expect(result.session?.aggregation).toBe("session-open-5m-v1"); expect(fetch).not.toHaveBeenCalled();
    expect((await loadWorkstationCandles(request)).candles).toEqual(result.candles); expect(fetch).not.toHaveBeenCalled();
    expect(await prisma.workstationCandleChunk.count({ where: { timeframe: "1h", source: { endsWith: "session-open-5m-v1" } } })).toBe(1);
  });
  it("fetches only missing source, does not retain additional 5m, and handles a mid-hour request", async () => {
    await saveSource({ from: open, to: open + 3600 }, [candle(open)]);
    vi.mocked(fetch).mockImplementation(async () => api([candle(open + 3600), candle(close - 300)]));
    const result = await loadWorkstationCandles({ ...request, range: { from: open + 1500, to: close - 100 } });
    expect(result.candles[0].time).toBe(open); expect(result.candles).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1); const url = new URL(String(vi.mocked(fetch).mock.calls[0][0])); expect(Date.parse(url.searchParams.get("start")!) / 1000).toBe(open + 3600);
    const sourceBars = await readCompactCandles(series, { from: day, to: day + 86400 }, 30000); expect(sourceBars.candles).toHaveLength(1);
    expect(sourceBars.cache.covered).toEqual([{ from: open, to: open + 3600 }]);
  });
});
