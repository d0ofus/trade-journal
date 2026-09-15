import { afterEach, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { persistMetrics } from "./workstation-metrics";
import { unavailableMetrics } from "@/lib/workstation/market-metrics";
import { CachePriorityError, claimCacheLease, foregroundPending, persistCompactCandles, releaseCacheLease, seriesKey, takeProviderSlot } from "./workstation-cache-store";

const prefix = "SUPPLEMENT_TEST";
it("keeps primary requests prioritized until their active lease is released", async () => {
  const primary = (await claimCacheLease(`${prefix}:primary`, 60000, true))!;
  const secondary = (await claimCacheLease(`${prefix}:secondary`))!;
  try {
    expect(await foregroundPending()).toBe(true);
    expect(await takeProviderSlot(true)).toBe(false);
    const from = Date.parse("2026-06-03T13:30Z") / 1000;
    await expect(persistCompactCandles({ symbol: prefix, timeframe: "5m", source: "fixture" }, { from, to: from + 300 }, [], secondary, false, true)).rejects.toBeInstanceOf(CachePriorityError);
    expect(await prisma.workstationCandleChunk.count({ where: { symbol: prefix } })).toBe(0);
  } finally { await releaseCacheLease(primary); await releaseCacheLease(secondary); }
  expect(await foregroundPending()).toBe(false);
});
afterEach(async () => {
  await prisma.workstationMetricCache.deleteMany({ where: { symbol: { startsWith: prefix } } });
  await prisma.workstationCandleChunk.deleteMany({ where: { symbol: { startsWith: prefix } } });
});

it("stores compact metrics once and evicts least recently used results within 5 MB", async () => {
  const value = unavailableMetrics(prefix, "USD", "Fixture", "2026-06-03");
  const base = { symbol: prefix, sessionDate: value.asOf!, provider: "fixture", version: 1, payload: {}, expiresAt: new Date(Date.now() + 100000) };
  // Size metadata models the budget edge without allocating thousands of fixtures.
  await prisma.workstationMetricCache.create({ data: { ...base, key: `${prefix}:old`, provider: "old", bytes: 5_000_000, accessedAt: new Date(0) } });
  await persistMetrics(prefix, value, "fixture", 1);
  expect(await prisma.workstationMetricCache.findUnique({ where: { key: `${prefix}:old` } })).toBeNull();
  const saved = await prisma.workstationMetricCache.findUniqueOrThrow({ where: { key: prefix } });
  expect(saved.bytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(saved.bytes).toBeLessThan(2048);
  await persistMetrics(prefix, value, "fixture", 1);
  expect(await prisma.workstationMetricCache.count({ where: { symbol: prefix } })).toBe(1);
});

it("keeps benchmark history unprotected, shares it with primary reads, and promotes primary ownership", async () => {
  const series = { symbol: prefix, timeframe: "5m" as const, source: "fixture:extended" };
  const from = Date.parse("2026-06-03T13:30Z") / 1000, range = { from, to: from + 300 };
  const candle = { time: from, open: 100, high: 102, low: 99, close: 101, volume: 1000 };
  const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
  try {
    await persistCompactCandles(series, range, [candle], lease, false, true);
    const first = await prisma.workstationCandleChunk.findFirstOrThrow({ where: { symbol: prefix } });
    expect(first).toMatchObject({ supplementary: true, tradeWindow: false });
    await persistCompactCandles(series, range, [candle], lease, true);
    expect(await prisma.workstationCandleChunk.findFirst({ where: { symbol: prefix } })).toMatchObject({ key: first.key, supplementary: false, tradeWindow: true });
    await persistCompactCandles(series, range, [candle], lease, false, true);
    expect(await prisma.workstationCandleChunk.findFirst({ where: { symbol: prefix } })).toMatchObject({ supplementary: false, tradeWindow: true });
    expect(await prisma.workstationCandleChunk.count({ where: { symbol: prefix } })).toBe(1);
  } finally { await releaseCacheLease(lease); }
});

it("evicts supplementary payloads at 10 MB while retaining protected trade history", async () => {
  const start = new Date("2026-06-03T00:00Z"), end = new Date("2026-06-04T00:00Z");
  const data = { symbol: prefix, timeframe: "5m", source: "fixture", start, end, checksum: "budget-only", version: 1, barCount: 0, accessedAt: new Date(0) };
  // Deliberately opaque payloads exercise byte accounting without decoding fake candles.
  await prisma.workstationCandleChunk.createMany({ data: [
    { ...data, key: `${prefix}:victim`, payload: Buffer.alloc(10_000_000), supplementary: true, tradeWindow: false },
    { ...data, key: `${prefix}:protected`, payload: Buffer.alloc(100), supplementary: false, tradeWindow: true },
  ] });
  const series = { symbol: `${prefix}_NEW`, timeframe: "5m" as const, source: "fixture:extended" };
  const lease = (await claimCacheLease(`series:${seriesKey(series)}`))!;
  try {
    const from = start.getTime() / 1000;
    await persistCompactCandles(series, { from, to: from + 300 }, [{ time: from, open: 100, high: 102, low: 99, close: 101, volume: 1000 }], lease, false, true);
    expect(await prisma.workstationCandleChunk.findUnique({ where: { key: `${prefix}:victim` } })).toBeNull();
    expect(await prisma.workstationCandleChunk.findUnique({ where: { key: `${prefix}:protected` } })).not.toBeNull();
    expect(await prisma.workstationCandleChunk.count({ where: { symbol: series.symbol } })).toBe(1);
  } finally { await releaseCacheLease(lease); }
});
