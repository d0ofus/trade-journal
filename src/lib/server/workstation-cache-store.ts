import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { intersectRange, missingRanges, unionRanges, type CandleRange, type CandleCacheMetadata } from "@/lib/workstation/candle-ranges";
import { candleChunks, cacheHash, decodeCandles, encodeCandles, replaceSegments, validateCandles, type CacheSegment } from "./workstation-cache-codec";
import { readCachedCandlesWithRetry, type Candle, type CandleTimeframe } from "./market-candles";

export type CacheSeries = { symbol: string; timeframe: CandleTimeframe; source: string };
export type CacheLease = { key: string; token: string };
export const seriesKey = (s: CacheSeries) => cacheHash(`${s.symbol}:${s.timeframe}:${s.source}`);
const chunkKey = (s: CacheSeries, from: number) => cacheHash(`${seriesKey(s)}:${from}`);
export const cacheEnabled = () => process.env.TRADES_CANDLE_CACHE_ENABLED === "1";
export const preparationEnabled = () => cacheEnabled() && process.env.TRADES_CANDLE_PREPARE_ENABLED === "1";
export async function claimCacheLease(key: string, durationMs = 60_000): Promise<CacheLease | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "WorkstationCandleLease" ("key", "token", "expiresAt") VALUES (${key}, ${token}, (clock_timestamp() AT TIME ZONE 'UTC') + ${durationMs} * interval '1 millisecond')
    ON CONFLICT ("key") DO UPDATE SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "WorkstationCandleLease"."expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') RETURNING "key"`;
  return rows.length ? { key, token } : null;
}
export async function releaseCacheLease(lease: CacheLease) {
  await prisma.workstationCandleLease.deleteMany({ where: lease });
}
/** Atomic time slots coordinate request rates across serverless instances. */
export async function takeProviderSlot(background: boolean): Promise<boolean> {
  const blockers = await prisma.workstationCandleLease.count({ where: { key: { in: background ? ["rate:cooldown", "foreground"] : ["rate:cooldown"] }, expiresAt: { gt: new Date() } } });
  if (blockers) return false;
  if (background && !(await claimCacheLease("rate:background", 1000))) return false;
  return !!(await claimCacheLease("rate:all", 500));
}
export async function deferProviderRequests(seconds: number) {
  await prisma.workstationCandleLease.upsert({ where: { key: "rate:cooldown" }, create: { key: "rate:cooldown", token: "cooldown", expiresAt: new Date(Date.now() + seconds * 1000) }, update: { expiresAt: new Date(Date.now() + seconds * 1000) } });
}
export async function markForegroundRequest() {
  await prisma.workstationCandleLease.upsert({ where: { key: "foreground" }, create: { key: "foreground", token: "priority", expiresAt: new Date(Date.now() + 5000) }, update: { expiresAt: new Date(Date.now() + 5000) } });
}
type UsageReader = Pick<Prisma.TransactionClient, "$queryRaw">;
export class CacheBudgetError extends Error { constructor() { super("Chart cache storage budget reached."); } }
export async function cacheUsage(db: UsageReader = prisma) {
  const rows = await db.$queryRaw<{ cache: bigint; databases: bigint }[]>`
    SELECT (pg_total_relation_size('"WorkstationCandleChunk"') + pg_total_relation_size('"WorkstationCandleCoverage"') +
      pg_total_relation_size('"WorkstationCandleJob"') + pg_total_relation_size('"WorkstationCandleLease"'))::bigint AS cache,
      (SELECT sum(pg_database_size(oid))::bigint FROM pg_database WHERE NOT datistemplate) AS databases`;
  return { cacheBytes: Number(rows[0].cache), databaseBytes: Number(rows[0].databases), cacheLimit: 100_000_000, databaseLimit: 400_000_000 };
}
export async function cacheBudgetAvailable(db: UsageReader = prisma): Promise<boolean> {
  const usage = await cacheUsage(db);
  return usage.cacheBytes < usage.cacheLimit - 1_000_000 && usage.databaseBytes < usage.databaseLimit - 1_000_000;
}
export async function protectTradeCache(series: CacheSeries, range: CandleRange) {
  await prisma.workstationCandleChunk.updateMany({ where: { ...series, tradeWindow: false, start: { lt: new Date(range.to * 1000) }, end: { gt: new Date(range.from * 1000) } }, data: { tradeWindow: true } });
}
export async function evictExploratoryCache() {
  if (await cacheBudgetAvailable()) return;
  // Only dispensable chart chunks are eligible. Coverage is deleted with its chunk.
  const candidates = await prisma.workstationCandleChunk.findMany({ where: { tradeWindow: false }, orderBy: { accessedAt: "asc" }, take: 200, select: { key: true, accessedAt: true, updatedAt: true } });
  if (candidates.length) await prisma.workstationCandleChunk.deleteMany({ where: { tradeWindow: false, OR: candidates } });
  // Physical table allocation may not shrink immediately. Stay paused until measurements permit growth.
}

export async function readCompactCandles(series: CacheSeries, range: CandleRange, limit: number, now = Date.now() / 1000) {
  const records = await prisma.workstationCandleChunk.findMany({ where: { symbol: series.symbol, timeframe: series.timeframe, source: series.source, start: { lt: new Date(range.to * 1000) }, end: { gt: new Date(range.from * 1000) } }, include: { coverage: true }, orderBy: { start: "asc" } });
  let candles: Candle[] = []; const segments: CacheSegment[] = []; let corrupt = false;
  for (const row of records) {
    try {
      const decoded = decodeCandles(row.payload, row.checksum, row.version);
      const verified: CacheSegment[] = JSON.parse(row.coverage?.segments ?? "[]");
      if (!Array.isArray(verified) || verified.some(s => ![s.from, s.to, s.at].every(Number.isFinite) || s.from >= s.to || s.from < row.start.getTime() / 1000 || s.to > row.end.getTime() / 1000)) throw new Error("Invalid coverage");
      candles.push(...decoded); segments.push(...verified);
    } catch { corrupt = true; }
  }
  // Throttle access bookkeeping so repeated pans do not turn reads into heavy writes.
  const touch = records.filter(r => now - r.accessedAt.getTime() / 1000 > 3600).map(r => r.key);
  if (touch.length) await prisma.workstationCandleChunk.updateMany({ where: { key: { in: touch } }, data: { accessedAt: new Date(now * 1000) } });
  const covered = unionRanges(segments.map(s => intersectRange(s, range)).filter((s): s is CandleRange => !!s));
  const missing = missingRanges(range, covered);
  // Legacy rows are usable partial data, never proof that a sparse window was completely fetched.
  if (missing.length) {
    const old = await readCachedCandlesWithRetry({ ...series, sources: [series.source], range: { from: range.from, to: range.to - 0.001 }, limit }).catch(() => []);
    candles = validateCandles([...old, ...candles]);
  } else candles = validateCandles(candles);
  const recent = { from: now - 7 * 86400, to: now }; // Includes the latest three sessions across weekends/holidays.
  const refresh = unionRanges(segments.filter(s => now - s.at >= 900).map(s => intersectRange(s, range)).filter((s): s is CandleRange => !!s).map(s => intersectRange(s, recent)).filter((s): s is CandleRange => !!s));
  const metadata: CandleCacheMetadata = { enabled: true, status: missing.length ? candles.length ? "partial" : "miss" : refresh.length ? "refreshing" : "hit", covered, missing, refresh, effectiveRange: range };
  return { candles: candles.filter(c => c.time >= range.from && c.time < range.to).slice(0, limit), cache: metadata, corrupt };
}

export async function persistCompactCandles(series: CacheSeries, range: CandleRange, incoming: Candle[], lease: CacheLease, tradeWindow: boolean) {
  const accepted = validateCandles(incoming).filter(c => c.time >= range.from && c.time < range.to);
  const bounds = candleChunks(range, series.timeframe), keys = bounds.map(b => chunkKey(series, b.from));
  await prisma.$transaction(async tx => {
    // Fencing: an expired/reassigned network request cannot overwrite newer data.
    const live = await tx.$queryRaw<{ key: string }[]>`SELECT "key" FROM "WorkstationCandleLease" WHERE "key"=${lease.key} AND "token"=${lease.token} AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (!live.length) throw new Error("Chart fetch lease expired; retry from cache.");
    // Recheck allocation under a global write lock: many requests may have passed
    // the pre-fetch check before any of their responses reached the database.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731934281)`;
    if (!(await cacheBudgetAvailable(tx))) throw new CacheBudgetError();
    const previous = await tx.workstationCandleChunk.findMany({ where: { key: { in: keys } }, include: { coverage: true } });
    const now = new Date(), at = now.getTime() / 1000;
    const chunks: Prisma.Sql[] = [], coverage: Prisma.Sql[] = [];
    for (const b of bounds) {
      const key = chunkKey(series, b.from), part = intersectRange(b, range)!;
      const prior = previous.find(c => c.key === key);
      let old: Candle[] = [], segments: CacheSegment[] = [];
      try { if (prior) { old = decodeCandles(prior.payload, prior.checksum, prior.version); segments = JSON.parse(prior.coverage?.segments ?? "[]"); if (!Array.isArray(segments) || segments.some(s => ![s.from, s.to, s.at].every(Number.isFinite) || s.from >= s.to || s.from < b.from || s.to > b.to)) throw new Error("Invalid coverage"); } } catch { old = []; segments = []; }
      const merged = validateCandles([...old.filter(c => c.time < part.from || c.time >= part.to), ...accepted.filter(c => c.time >= b.from && c.time < b.to)]);
      const encoded = encodeCandles(merged), ranges = replaceSegments(segments, { ...part, at });
      chunks.push(Prisma.sql`(${key},${series.symbol},${series.timeframe},${series.source},${new Date(b.from * 1000)},${new Date(b.to * 1000)},${encoded.payload},${encoded.checksum},1,${merged.length},${tradeWindow || !!prior?.tradeWindow},${now},${now})`);
      coverage.push(Prisma.sql`(${key},${JSON.stringify(ranges)})`);
    }
    if (!chunks.length) return;
    await tx.$executeRaw`INSERT INTO "WorkstationCandleChunk" ("key","symbol","timeframe","source","start","end","payload","checksum","version","barCount","tradeWindow","accessedAt","updatedAt") VALUES ${Prisma.join(chunks)}
      ON CONFLICT ("key") DO UPDATE SET "payload"=EXCLUDED."payload", "checksum"=EXCLUDED."checksum", "version"=1,"barCount"=EXCLUDED."barCount","tradeWindow"=EXCLUDED."tradeWindow","accessedAt"=EXCLUDED."accessedAt","updatedAt"=EXCLUDED."updatedAt"`;
    await tx.$executeRaw`INSERT INTO "WorkstationCandleCoverage" ("chunkKey","segments") VALUES ${Prisma.join(coverage)} ON CONFLICT ("chunkKey") DO UPDATE SET "segments"=EXCLUDED."segments"`;
  }, { timeout: 20_000 });
}
