import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { workstationCandlePolicy } from "../src/lib/server/workstation-candle-policy";
import { loadWorkstationCandles } from "../src/lib/server/workstation-candles";
import { evaluateUsEquitiesCandleCoverage } from "../src/lib/server/market-session-calendar";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (!process.argv.includes("--live")) {
    console.log("Dry run: no credentials read, HTTP requests, or database access. Use --live with the isolated test database to validate Alpaca history.");
    return;
  }
  const target = assertTestDatabaseSafety(process.env);
  assert.equal(target.databaseUrl.host, "127.0.0.1:55439", "Live validation cache must stay on disposable loopback PostgreSQL");
  assert.equal(target.databaseUrl.database, "trades_workstation_test");
  let privateEnv: Record<string, string | undefined> = {};
  try { privateEnv = parseEnv(await readFile(".env.local", "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Read only chart settings. Never import database, broker-ingestion, or authentication credentials.
  for (const name of ["TRADES_ALPACA_API_KEY_ID", "TRADES_ALPACA_API_SECRET_KEY", "TRADES_ALPACA_DATA_FEED", "TRADES_ALPACA_ADJUSTMENT", "TRADES_ALPACA_DELAY_SECONDS"]) {
    if (!process.env[name] && privateEnv[name]) process.env[name] = privateEnv[name];
  }
  if (!process.env.TRADES_ALPACA_API_KEY_ID || !process.env.TRADES_ALPACA_API_SECRET_KEY) {
    throw new Error("Alpaca credentials are not configured. Add the two TRADES_ALPACA_* key variables privately to .env.local, then retry.");
  }
  process.env.TRADES_CHART_PROVIDER = "alpaca";
  process.env.TRADES_CHART_YAHOO_FALLBACK = "0";
  const policy = workstationCandlePolicy();
  const credentials = policy.credentials!;
  const now = Math.floor(Date.now() / 1000);
  const end = Math.floor((now - Math.max(900, policy.delaySeconds) - 1) / 86400) * 86400 - 1;
  const startDate = new Date(end * 1000); startDate.setUTCFullYear(startDate.getUTCFullYear() - 2);
  const start = Math.floor(startDate.getTime() / 1000);

  // A tiny uncached read distinguishes authentication/entitlement failures before loading history.
  const probe = new URL("https://data.alpaca.markets/v2/stocks/bars");
  for (const [key, value] of Object.entries({ symbols: "AAPL", timeframe: "5Min", start: new Date(start * 1000).toISOString(), end: new Date((start + 7 * 86400) * 1000).toISOString(), limit: "5", feed: credentials.feed, adjustment: "raw" })) probe.searchParams.set(key, value);
  const response = await fetch(probe, { headers: { "APCA-API-KEY-ID": credentials.keyId, "APCA-API-SECRET-KEY": credentials.secretKey }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Alpaca historical probe returned HTTP ${response.status}. Check the key pair and historical ${credentials.feed.toUpperCase()} entitlement. No provider response body or credentials were logged.`);
  const probeData = await response.json();
  assert.ok(probeData.bars?.AAPL?.length, "Alpaca accepted the key but returned no two-year-old AAPL bars");

  const pages = [];
  let lastTime = -1, total = 0, missingRegularBars = 0;
  for (let from = start; from < end;) {
    const to = Math.min(end, from + 30 * 86400 - 1);
    const loaded = await loadWorkstationCandles({ symbol: "AAPL", timeframe: "5m", range: { from, to }, limit: 30000, signal: AbortSignal.timeout(60_000) });
    assert.equal(loaded.provider.identity, policy.cacheSource);
    assert.equal(loaded.provider.adjustment, "raw");
    assert.equal(loaded.provider.fallback, false);
    assert.ok(loaded.candles.length > 0 && loaded.candles.length < 30000, "History page was empty or reached the page cap");
    for (const candle of loaded.candles) {
      assert.ok(candle.time > lastTime && candle.time >= from && candle.time <= to, "History must be strictly ordered and inside its requested range");
      assert.ok([candle.open, candle.high, candle.low, candle.close].every(Number.isFinite), "OHLC must be finite");
      assert.ok(candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close), "Invalid OHLC bounds");
      lastTime = candle.time;
    }
    const coverage = evaluateUsEquitiesCandleCoverage({ candleTimes: loaded.candles.map(c => c.time), timeframe: "5m", from, to, limit: 30000 });
    const gaps = coverage.missingBars ?? 0;
    missingRegularBars += gaps;
    pages.push({ from, to, bars: loaded.candles.length, coverage, warnings: loaded.warnings ?? [] });
    total += loaded.candles.length;
    console.log(`AAPL 5m history: page ${pages.length}, ${loaded.candles.length} bars, regular-session coverage ${coverage.status}.`);
    from = to + 1;
  }
  const last = pages.at(-1)!;
  const cached = await loadWorkstationCandles({ symbol: "AAPL", timeframe: "5m", range: { from: last.from, to: last.to }, limit: 30000, signal: AbortSignal.timeout(60_000) });
  assert.equal(cached.provider.identity, policy.cacheSource);
  const cacheRows = await prisma.marketCandle.count({ where: { source: policy.cacheSource, symbol: "AAPL", timeframe: "5m" } });
  assert.ok(cacheRows >= total, "Every accepted bar must be stored in the isolated namespaced cache");

  // Test current Yahoo availability independently; fallback failure/identity paths have mocked tests.
  process.env.TRADES_CHART_PROVIDER = "yahoo";
  let yahoo: Record<string, unknown>;
  try {
    const loaded = await loadWorkstationCandles({ symbol: "MSFT", timeframe: "5m", range: { from: end - 7 * 86400, to: end }, limit: 10000, signal: AbortSignal.timeout(30_000) });
    yahoo = { available: loaded.candles.length > 0, bars: loaded.candles.length, identity: loaded.provider.identity };
  } catch { yahoo = { available: false }; }
  const report = { schema: 1, checkedAt: new Date().toISOString(), symbol: "AAPL", interval: "5m", feed: credentials.feed, adjustment: "raw", configuredDelay: policy.delaySeconds, start, end, bars: total, cacheRows, cacheHitOnRepeat: cached.provider.cached, missingRegularBars, pages, yahoo, recentSipEntitlementTested: false };
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ bars: total, pages: pages.length, cacheRows, cacheHitOnRepeat: cached.provider.cached, missingRegularBars, yahoo }));
  if (missingRegularBars) throw new Error("Historical data was returned, but regular-session gaps need review before claiming complete coverage.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live chart validation failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
