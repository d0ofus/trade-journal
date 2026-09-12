import { randomUUID } from "node:crypto";
import type { WorkstationCandleJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Trade, Interval } from "@/lib/workstation/types";
import { initialHistoryRange } from "@/lib/workstation/history";
import { tradeChartSession } from "@/lib/workstation/chart-session";
import { unionRanges, type CandleRange } from "@/lib/workstation/candle-ranges";
import { listWorkstationTrades } from "./trade-workstation";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { boundedCacheRanges, loadCompactWorkstationCandles } from "./workstation-cache-loader";
import { cacheHash } from "./workstation-cache-codec";
import { cacheBudgetAvailable, cacheEnabled, cacheUsage, claimCacheLease, evictExploratoryCache, preparationEnabled, releaseCacheLease } from "./workstation-cache-store";
import { CacheProviderError } from "./workstation-cache-provider";
import { alpacaFailureSummary } from "./alpaca-candle-error";

const intervals: Interval[] = ["5m", "10m", "15m", "1h", "1d", "1wk"];
export type PreparationWindow = { symbol: string; timeframe: Interval; session: "regular" | "extended"; range: CandleRange };
/** Includes OTHER instruments: the provider, not the import classification, determines availability. */
export function planCandlePreparation(trades: Trade[], now = Date.now() / 1000): PreparationWindow[] {
  const groups = new Map<string, { symbol: string; timeframe: Interval; session: "regular" | "extended"; ranges: CandleRange[] }>();
  for (const trade of trades) for (const timeframe of intervals) {
    const session = tradeChartSession(trade), key = `${trade.symbol}:${timeframe}:${session}`;
    const initial = initialHistoryRange(trade, timeframe);
    const range = { from: Math.max(1, Math.floor(Math.min(initial.from, trade.openTime - 86400) / 86400) * 86400), to: Math.min(Math.ceil(now / 86400) * 86400, Math.ceil(Math.max(initial.to, trade.closeTime + 86400) / 86400) * 86400) };
    if (range.to <= range.from) continue;
    const group = groups.get(key) ?? { symbol: trade.symbol, timeframe, session, ranges: [] };
    group.ranges.push(range); groups.set(key, group);
  }
  return [...groups.values()].flatMap(g => unionRanges(g.ranges).flatMap(r => boundedCacheRanges(r, g.timeframe).map(range => ({ symbol: g.symbol, timeframe: g.timeframe, session: g.session, range }))));
}

export async function queueCandlePreparation() {
  if (!preparationEnabled()) return { trades: 0, symbols: 0, windows: 0, added: 0 };
  const policy = workstationCandlePolicy();
  if (policy.provider !== "alpaca") throw new Error("Preparation requires the Alpaca workstation provider.");
  const trades = await listWorkstationTrades();
  const windows = planCandlePreparation(trades, Math.floor(Date.now() / 1000) - policy.delaySeconds - 1);
  let added = 0;
  for (let offset = 0; offset < windows.length; offset += 200) {
    if (!(await cacheBudgetAvailable())) break;
    const result = await prisma.workstationCandleJob.createMany({ skipDuplicates: true, data: windows.slice(offset, offset + 200).map(w => {
      const source = `${policy.cacheSource}:${w.session}`;
      return { availableAt: new Date(), key: cacheHash(`${w.symbol}:${w.timeframe}:${source}:${w.range.from}:${w.range.to}`), symbol: w.symbol, timeframe: w.timeframe, source, session: w.session, start: new Date(w.range.from * 1000), end: new Date(w.range.to * 1000) };
    }) });
    added += result.count;
  }
  return { trades: trades.length, symbols: new Set(trades.map(t => t.symbol)).size, windows: windows.length, added };
}

async function claimJob(): Promise<WorkstationCandleJob | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<WorkstationCandleJob[]>`
    UPDATE "WorkstationCandleJob" SET "status"='running', "leaseToken"=${token}, "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '180 seconds', "attempts"="attempts"+1, "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    WHERE "key"=(SELECT "key" FROM "WorkstationCandleJob" WHERE
      ("status"='pending' AND "availableAt"<=(clock_timestamp() AT TIME ZONE 'UTC')) OR ("status"='running' AND "leaseUntil"<(clock_timestamp() AT TIME ZONE 'UTC'))
      ORDER BY "priority" ASC, "availableAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  return rows[0] ?? null;
}
export async function runCandlePreparation(durationMs = 200_000) {
  if (!preparationEnabled()) return { processed: 0, paused: "Background preparation is disabled." };
  const policy = workstationCandlePolicy();
  if (policy.provider !== "alpaca") return { processed: 0, paused: "Alpaca is not the active provider." };
  // At most two background runners across every server instance; each sends one request at a time.
  const slot = await claimCacheLease("worker:0", 300_000) ?? await claimCacheLease("worker:1", 300_000);
  if (!slot) return { processed: 0, paused: "Two preparation runners are already active." };
  const deadline = Date.now() + Math.min(200_000, Math.max(0, durationMs)); let processed = 0;
  try {
    while (Date.now() < deadline && preparationEnabled()) {
      if (!(await cacheBudgetAvailable())) return { processed, paused: "Storage budget reached. Existing candles remain available." };
      const job = await claimJob(); if (!job) break;
      const update = (data: { status: string; lastError?: string | null; availableAt?: Date }) => prisma.workstationCandleJob.updateMany({ where: { key: job.key, leaseToken: job.leaseToken }, data: { ...data, leaseToken: null, leaseUntil: null } });
      if (job.source !== `${policy.cacheSource}:${job.session}`) { await update({ status: "unavailable", lastError: "Provider identity changed; run preparation again with the current settings." }); continue; }
      try {
        const result = await loadCompactWorkstationCandles({ symbol: job.symbol, timeframe: job.timeframe as Interval, range: { from: job.start.getTime() / 1000, to: job.end.getTime() / 1000 - 0.001 }, session: job.session as "regular" | "extended", limit: 30000, background: true, tradeWindow: true, mode: "fill" }, policy);
        if (result.cache?.missing.length || result.cache?.refresh.length) await update({ status: "pending", availableAt: new Date(Date.now() + Math.max(2000, result.cache.retryAfterMs ?? 0)), lastError: "Waiting for uncovered history or an active chart request." });
        else { await update({ status: "done", lastError: result.candles.length ? null : "Provider query succeeded with no eligible bars in this period." }); processed++; }
      } catch (error) {
        const status = error instanceof CacheProviderError && [400, 404, 422].includes(error.status ?? 0) ? "unavailable" : job.attempts >= 5 ? "failed" : "pending";
        const seconds = Math.min(86400, Math.max(30 * 2 ** Math.min(job.attempts, 10), error instanceof CacheProviderError ? error.retryAfterSeconds : 0));
        await update({ status, availableAt: new Date(Date.now() + seconds * 1000), lastError: `Alpaca: ${alpacaFailureSummary(error)}. Imported trades are unchanged.` });
      }
    }
    return { processed, paused: null };
  } finally { await releaseCacheLease(slot); }
}
export async function marketCacheStatus() {
  if (!cacheEnabled()) return { enabled: false, preparation: preparationEnabled(), usage: null, counts: {}, issues: [] };
  const [usage, groups, issues] = await Promise.all([
    cacheUsage(), prisma.workstationCandleJob.groupBy({ by: ["status"], _count: true }),
    prisma.workstationCandleJob.findMany({ where: { OR: [{ status: { in: ["failed", "unavailable"] } }, { status: "done", lastError: { not: null } }] }, orderBy: { updatedAt: "desc" }, take: 30, select: { key: true, symbol: true, timeframe: true, status: true, lastError: true, start: true, end: true } }),
  ]);
  return { enabled: true, preparation: preparationEnabled(), usage, counts: Object.fromEntries(groups.map(g => [g.status, g._count])), issues };
}
export async function retryCandlePreparation() {
  return prisma.workstationCandleJob.updateMany({ where: { status: { in: ["failed", "unavailable"] } }, data: { status: "pending", attempts: 0, availableAt: new Date(), lastError: null } });
}
export async function recoverCandlePreparation() {
  if (!preparationEnabled()) return;
  await evictExploratoryCache();
  await queueCandlePreparation();
  // Finish the tail of recently prepared sessions and pick up provider corrections on daily recovery.
  await prisma.workstationCandleJob.updateMany({ where: { status: "done", end: { gt: new Date(Date.now() - 7 * 86400_000) }, updatedAt: { lt: new Date(Date.now() - 86400_000) } }, data: { status: "pending", availableAt: new Date() } });
  return runCandlePreparation();
}
