import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";

// Repeatable transport/DB benchmark. No application env files or live provider calls.
const target = assertTestDatabaseSafety(process.env).databaseUrl;
if (target.host !== "127.0.0.1:55439" || target.database !== "trade_journal_candle_benchmark_test") throw new Error("Use the dedicated loopback candle benchmark database.");
const prisma = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
let queries = 0, http = 0, providers = 0;
prisma.$on("query", () => queries++);
Object.assign(process.env, {
  TRADES_CANDLE_CACHE_ENABLED: "1", TRADES_CHART_PROVIDER: "alpaca",
  TRADES_ALPACA_API_KEY_ID: "isolated-dummy-key", TRADES_ALPACA_API_SECRET_KEY: "isolated-dummy-secret",
  TRADES_ALPACA_DATA_FEED: "sip", TRADES_ALPACA_ADJUSTMENT: "raw", TRADES_CHART_YAHOO_FALLBACK: "0",
});

async function main() {
  const { loadWorkstationCandles } = await import("../src/lib/server/workstation-candles");
  const { CandleHistory } = await import("../src/lib/workstation/history");
  const { createApplicationAdapter } = await import("../src/lib/workstation/application-adapter");
  const { demoTrades } = await import("../src/lib/workstation/demo");
  const from = Date.parse("2024-09-03T00:00:00Z") / 1000, to = from + 30 * 86400 - 1;
  const trade = { ...demoTrades[0], symbol: "DEMOHISTORY", openTime: to - 7200, closeTime: to - 3600, chartSession: "regular" as const };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (url.pathname === "/api/workstation/candles" && url.hostname === "127.0.0.1") {
      http++;
      const p = url.searchParams;
      const result = await loadWorkstationCandles({ symbol: trade.symbol, timeframe: "1h", range: { from: Number(p.get("from")), to: Number(p.get("to")) }, limit: 30001, session: "regular", mode: p.get("mode") as "cache" | "fill", signal: init?.signal ?? undefined, identity: p.get("identity") });
      return Response.json({ ...result, metadata: { cache: result.cache, session: result.session, warnings: result.warnings, truncated: false } });
    }
    if (url.hostname !== "data.alpaca.markets") throw new Error("Live network is disabled in this benchmark.");
    providers++;
    await new Promise(resolve => setTimeout(resolve, 50));
    init?.signal?.throwIfAborted();
    const start = Date.parse(url.searchParams.get("start")!), end = Date.parse(url.searchParams.get("end")!);
    const rows = [];
    for (let time = Math.ceil(start / 300000) * 300000; time <= end; time += 300000) {
      const d = new Date(time), minute = d.getUTCHours() * 60 + d.getUTCMinutes();
      if ([0, 6].includes(d.getUTCDay()) || minute < 810 || minute >= 1200) continue;
      rows.push({ t: d.toISOString(), o: 100, h: 102.123456789, l: 98.987654321, c: 101, v: 1000 });
    }
    const offset = Number(url.searchParams.get("page_token") ?? 0);
    return Response.json({ bars: { [trade.symbol]: rows.slice(offset, offset + 10000) }, next_page_token: rows.length > offset + 10000 ? String(offset + 10000) : null });
  };
  try {
    for (const scenario of ["cold", "partial", "warm"]) {
      await prisma.workstationCandleChunk.deleteMany(); await prisma.workstationCandleLease.deleteMany();
      if (scenario !== "cold") {
        let ready = false;
        for (let attempt = 0; attempt < 8 && !ready; attempt++) {
          const seeded = await loadWorkstationCandles({ symbol: trade.symbol, timeframe: "1h", range: { from, to: scenario === "warm" ? to : from + 14 * 86400 - 1 }, limit: 30001, session: "regular", mode: "complete" });
          ready = !seeded.cache?.missing.length && !seeded.cache?.refresh.length;
        }
        if (!ready) throw new Error("Benchmark setup did not establish the required coverage.");
      }
      await prisma.workstationCandleLease.deleteMany(); queries = http = providers = 0;
      const at = performance.now(); let firstCandlesMs: number | null = null;
      const history = new CandleHistory(createApplicationAdapter(), trade, "1h", { from, to }, state => { if (firstCandlesMs === null && state.result.candles.length) firstCandlesMs = performance.now() - at; });
      let success = await history.start(), resumptions = 0;
      while (!success && resumptions < 3) { resumptions++; success = await history.retry(); }
      console.log(JSON.stringify({ scenario, success, resumptions, firstCandlesMs, coverageMs: performance.now() - at, httpRequests: http, providerCalls: providers, databaseQueries: queries, bars: history.state.result.candles.length, missing: history.state.result.cache?.missing.length, error: history.state.error }));
      history.dispose();
      if (!success || history.state.result.cache?.missing.length) throw new Error("Benchmark failed to complete coverage.");
    }
  } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
