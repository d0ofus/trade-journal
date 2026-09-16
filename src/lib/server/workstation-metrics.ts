import { shareEligibility, metricCalculationVersion } from "@/lib/workstation/share-eligibility";
import { SharedRequests } from "@/lib/workstation/shared-requests";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { firstExecution } from "@/lib/workstation/before-entry";
import { executionTimeResolved } from "@/lib/workstation/execution-time-provenance";
import { calculateMarketMetrics, exchangeDate, previousSession, unavailableMetrics, type MarketMetrics } from "@/lib/workstation/market-metrics";
import type { Candle, Trade } from "@/lib/workstation/types";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { fetchCompactCandles } from "./workstation-cache-provider";
import { cacheHash } from "./workstation-cache-codec";
import { cacheUsage, foregroundPending } from "./workstation-cache-store";
import { historicalShares } from "./historical-shares";

export async function persistMetrics(key: string, value: MarketMetrics, provider: string, version: number) {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  if (bytes > 2048 || !value.asOf) return;
  await prisma.$transaction(async tx => {
    if (await foregroundPending(tx)) return;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731934281)`;
    const usage = await cacheUsage(tx);
    if (usage.cacheBytes >= 80_000_000 || usage.databaseBytes >= 350_000_000) return;
    const entries = await tx.workstationMetricCache.findMany({ orderBy: { accessedAt: "asc" }, select: { key: true, bytes: true } });
    let total = entries.reduce((n, row) => n + (row.key === key ? 0 : row.bytes), bytes);
    for (const row of entries) { if (total <= 5_000_000) break; if (row.key !== key) { await tx.workstationMetricCache.delete({ where: { key: row.key } }); total -= row.bytes; } }
    const data = { symbol: value.symbol, sessionDate: value.asOf!, provider, version, bytes, payload: value as unknown as Prisma.InputJsonValue, accessedAt: new Date(), expiresAt: new Date(Date.now() + (value.adr.value === null ? 300000 : 86400000)) };
    await tx.workstationMetricCache.upsert({ where: { key }, create: { key, ...data }, update: data });
  });
}

const metricRequests = new SharedRequests<MarketMetrics>();

export async function loadTradeMetrics(trade: Trade, signal: AbortSignal): Promise<MarketMetrics> {
  const first = firstExecution(trade);
  if (!first || !executionTimeResolved(first) || ["pending", "stale", "unresolved"].includes(first.provenance?.interpretationStatus ?? "")) return unavailableMetrics(trade.symbol, trade.currency, "Resolve execution time first");
  const reference = previousSession(exchangeDate(first.time));
  if (!reference) return unavailableMetrics(trade.symbol, trade.currency, "Exchange session unavailable");
  const eligibilityBasis = shareEligibility(trade);
  if (!eligibilityBasis) return unavailableMetrics(trade.symbol, trade.currency, "Unsupported instrument", reference.date);
  const policy = workstationCandlePolicy(), credentials = policy.credentials;
  if (!credentials) return unavailableMetrics(trade.symbol, trade.currency, "Daily metrics require the configured Alpaca chart feed", reference.date);
  const provider = `alpaca:${credentials.feed}:split+raw:sec:${trade.currency}:shares:${eligibilityBasis}`, version = metricCalculationVersion, key = cacheHash(`${trade.symbol}:${trade.currency}:${reference.date}:${provider}:${eligibilityBasis}:${version}`);
  return metricRequests.run(key, signal, async signal => {
  const cached = await prisma.workstationMetricCache.findUnique({ where: { key } });
  if (cached && cached.expiresAt > new Date()) return cached.payload as unknown as MarketMetrics;
  const range = { from: reference.open - 550 * 86400, to: reference.close + 1 };
  const [adjustedResult, rawResult, sharesResult] = await Promise.allSettled([
    fetchCompactCandles(trade.symbol, "1d", range, { ...credentials, adjustment: "split" }, true, true, { signal }),
    fetchCompactCandles(trade.symbol, "1d", range, { ...credentials, adjustment: "raw" }, true, true, { signal }),
    eligibilityBasis === "etf" ? Promise.resolve(null) : historicalShares(trade.symbol, reference.date, signal),
  ]);
  signal.throwIfAborted();
  if (adjustedResult.status !== "fulfilled") return unavailableMetrics(trade.symbol, trade.currency, "Daily history unavailable; retry", reference.date);
  const adjusted = adjustedResult.value.filter(c => exchangeDate(c.time) <= reference.date).map(c => ({ ...c, volume: c.volume ?? 0 })) as Candle[];
  const value = calculateMarketMetrics(trade.symbol, trade.currency, reference.date, adjusted, `Alpaca ${credentials.feed.toUpperCase()} · split adjusted`);
  value.eligibilityBasis = eligibilityBasis;
  const fact = sharesResult.status === "fulfilled" ? sharesResult.value : null;
  if (fact && rawResult.status === "fulfilled") {
    const raw = rawResult.value.filter(c => exchangeDate(c.time) <= reference.date);
    const current = raw.find(c => exchangeDate(c.time) === reference.date), adjustedCurrent = adjusted.find(c => exchangeDate(c.time) === reference.date);
    const observed = raw.filter(c => exchangeDate(c.time) <= fact.end).at(-1), adjustedObserved = observed && adjusted.find(c => c.time === observed.time);
    if (current && current.close > 0 && adjustedCurrent && observed && adjustedObserved && adjustedCurrent.close > 0 && adjustedObserved.close > 0 && observed.close > 0) {
      // Raw/split price ratios cancel splits after the reference date and retain
      // only share-count changes between the disclosed observation and reference.
      const splitFactor = (observed.close / adjustedObserved.close) / (current.close / adjustedCurrent.close);
      const estimate = current.close * fact.val * splitFactor;
      value.marketCap = Number.isFinite(estimate) && estimate > 0 ? { value: estimate } : { value: null, reason: "Invalid historical share or price data" };
      value.sharesDate = fact.end; value.sharesFiled = fact.filed; value.sharesSource = fact.source;
    } else value.marketCap = { value: null, reason: "Share observation outside verified split history" };
  }
  if (eligibilityBasis === "etf") value.marketCap = { value: null, reason: "ETF market cap is not a company equity value" };
  await persistMetrics(key, value, provider, version).catch(() => undefined);
  return value;
  });
}
