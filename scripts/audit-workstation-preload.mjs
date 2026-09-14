import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

// Run with: node --env-file=.env --import tsx scripts/audit-workstation-preload.mjs
// Every database operation, including application reads, shares a read-only snapshot.
const require = createRequire(import.meta.url);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const asOf = arg("as-of") ? Date.parse(arg("as-of")) / 1000 : Math.floor(Date.now() / 1000);
const delay = Number(arg("delay") ?? 900), source = arg("source") ?? "workstation:v1:alpaca:sip:raw";
if (!Number.isFinite(asOf) || !Number.isInteger(delay) || delay < 0 || delay > 86400 || !/^workstation:v1:alpaca:(sip|iex):raw$/.test(source)) throw new Error("Invalid audit cutoff, delay or provider identity.");
const cutoff = Math.floor((asOf - delay - (delay ? 1 : 0)) / 900) * 900;
const db = new PrismaClient();
try {
  const report = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    globalThis.prisma = tx;
    const { listWorkstationTrades } = require("../src/lib/server/trade-workstation.ts");
    const { planCandlePreparation, preparationIntervals } = require("../src/lib/server/workstation-cache-jobs.ts");
    const { isOptionTrade } = require("../src/lib/workstation/preparation-eligibility.ts");
    const { tradeChartSession } = require("../src/lib/workstation/chart-session.ts");
    const { candleIdentity } = require("../src/lib/workstation/regular-hours.ts");
    const { decodeCandles } = require("../src/lib/server/workstation-cache-codec.ts");
    const { unionRanges, missingRanges, intersectRange } = require("../src/lib/workstation/candle-ranges.ts");
    const { cacheUsage } = require("../src/lib/server/workstation-cache-store.ts");
    const trades = await listWorkstationTrades(), eligible = trades.filter(t => !isOptionTrade(t));
    const chunks = await tx.workstationCandleChunk.findMany({ include: { coverage: true } });
    const jobs = await tx.workstationCandleJob.findMany();
    const series = new Map(), corrupt = [];
    for (const row of chunks) {
      try {
        decodeCandles(row.payload, row.checksum, row.version);
        const segments = JSON.parse(row.coverage?.segments ?? "[]");
        if (!Array.isArray(segments) || segments.some(s => ![s.from, s.to, s.at].every(Number.isFinite) || s.from >= s.to || s.from < row.start.getTime() / 1000 || s.to > row.end.getTime() / 1000)) throw new Error("Invalid coverage bounds");
        const key = `${row.symbol}:${row.timeframe}:${row.source}`;
        series.set(key, [...(series.get(key) ?? []), ...segments]);
      } catch (error) { corrupt.push({ key: row.key, symbol: row.symbol, timeframe: row.timeframe, reason: error.message }); }
    }
    for (const [key, ranges] of series) series.set(key, unionRanges(ranges));
    const intervals = Object.fromEntries(preparationIntervals.map(i => [i, { complete: 0, partial: 0, unavailable: 0, withoutCoverage: 0 }]));
    const details = [];
    for (const trade of eligible) for (const timeframe of preparationIntervals) {
      const session = tradeChartSession(trade), identity = candleIdentity(source, timeframe, session);
      const expected = unionRanges(planCandlePreparation([trade], asOf - delay - 1).filter(w => w.timeframe === timeframe).map(w => ({ from: w.range.from, to: Math.min(w.range.to, cutoff) })).filter(r => r.from < r.to));
      const covered = series.get(`${trade.symbol}:${timeframe}:${identity}`) ?? [];
      const gaps = expected.flatMap(r => missingRanges(r, covered));
      const hasCoverage = expected.some(r => covered.some(c => intersectRange(r, c)));
      const failures = jobs.filter(j => j.symbol === trade.symbol && j.timeframe === timeframe && j.source === identity && ["unavailable", "failed"].includes(j.status) && gaps.some(g => intersectRange(g, { from: j.start.getTime() / 1000, to: j.end.getTime() / 1000 })));
      const status = !gaps.length ? "complete" : failures.some(j => j.status === "unavailable") ? "unavailable" : "partial";
      intervals[timeframe][status]++;
      if (gaps.length && !hasCoverage) intervals[timeframe].withoutCoverage++;
      details.push({ tradeId: trade.id, symbol: trade.symbol, timeframe, session, identity, status, expected, gaps, failures: failures.map(j => ({ key: j.key, status: j.status, reason: j.lastError })) });
    }
    const immutable = {};
    const names = ["Execution", "ClosedTrade", "ClosedTradeExecution", "ClosedTradeNote", "ClosedTradeAnnotation", "ClosedTradeAnnotationState", "ClosedTradeChartLayout", "ClosedTradeTag", "WorkstationTradeView", "JournalEntry", "JournalChart", "JournalChartMarker", "JournalLink", "Position", "PositionSnapshot", "DailySnapshot", "ExecutionAnalytics"];
    for (const name of names) {
      const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(coalesce(string_agg(digest, '' ORDER BY digest), '')) AS fingerprint FROM (SELECT md5(to_jsonb(t)::text) AS digest FROM "${name}" t) rows`);
      immutable[name] = row;
    }
    const count = values => Object.fromEntries([...new Set(values)].map(v => [v, values.filter(x => x === v).length]));
    const executions = [...new Map(trades.flatMap(t => t.executions).map(e => [e.id, e])).values()];
    const [size] = await tx.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`;
    return { auditedAt: new Date().toISOString(), asOf: new Date(asOf * 1000).toISOString(), coverageCutoff: new Date(cutoff * 1000).toISOString(), delaySeconds: delay, source,
      summary: { trades: trades.length, eligible: eligible.length, symbols: new Set(eligible.map(t => t.symbol)).size, excludedOptions: trades.length - eligible.length, sessions: count(eligible.map(t => tradeChartSession(t))), intervals, executionTimeStatus: count(executions.map(e => e.provenance?.timezoneStatus ?? "unverified")), interpretationStatus: count(executions.map(e => e.provenance?.interpretationStatus ?? "original")), jobs: count(jobs.map(j => j.status)), corruptChunks: corrupt.length, usage: { ...await cacheUsage(tx), currentDatabaseBytes: Number(size.bytes) } },
      immutable, policies: await tx.accountExecutionTimePolicy.findMany(), executions: executions.map(e => ({ id: e.id, time: e.time, provenance: e.provenance })), details, corrupt,
      excludedOptions: trades.filter(isOptionTrade).map(t => ({ id: t.id, symbol: t.symbol })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000, maxWait: 15000 });
  const output = resolve(arg("output") ?? `artifacts/preload-audit-${new Date().toISOString().replaceAll(":", "-")}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, asOf: report.asOf, coverageCutoff: report.coverageCutoff, ...report.summary }, null, 2));
} finally { await db.$disconnect(); }
