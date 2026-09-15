import { Prisma } from "@prisma/client";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { TIME_INTERPRETATION_VERSION } from "../src/lib/workstation/timestamp-interpretation";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { listWorkstationTrades } from "../src/lib/server/trade-workstation";
import { defaultPreferences, type Interval } from "../src/lib/workstation/types";

// Run only against the two isolated production builds and synthetic provider fence.
const target = assertTestDatabaseSafety(process.env).databaseUrl;
if (target.host !== "127.0.0.1:55439" || target.database !== "trades_workstation_auth_test" || process.env.WORKSTATION_OHLC_BENCHMARK !== "1") {
  throw new Error("Opt in with WORKSTATION_OHLC_BENCHMARK=1 and the disposable workstation browser database.");
}
const samples = Number(process.env.WORKSTATION_OHLC_SAMPLES ?? 10);
if (!Number.isInteger(samples) || samples < 1 || samples > 30) throw new Error("Use 1–30 samples per scenario/build.");
const comparison = process.env.WORKSTATION_COMPARISON ?? "off";
if (!["off", "SPY", "QQQ"].includes(comparison)) throw new Error("Invalid comparison");
const coldCheck = process.env.WORKSTATION_OHLC_COLD_CHECK === "1";
const chartSession = process.env.WORKSTATION_OHLC_SESSION ?? "regular";
if (chartSession !== "regular" && chartSession !== "extended") throw new Error("Use regular or extended for WORKSTATION_OHLC_SESSION.");
const providerLog = path.join(process.env.TEMP!, "trade-workstation-phase2", "cache-provider.log");
const calls = () => existsSync(providerLog) ? readFileSync(providerLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { symbol: string; metric?: boolean }) : [];
const output = path.resolve("artifacts/comparison", comparison);
const rows: { build: string; scenario: string; panels: number; sample: number; firstCandleMs: number; allCandlesMs: number; paintAfterResponseMs: number; httpRequests: number; providerCalls: number; supplementaryHttp: number; supplementaryProvider: number; shadedPanels: number }[] = [];

async function main() {
  let trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "DEMOC" }))[0];
  if (!trade) throw new Error("Seed the existing synthetic DEMOC browser fixture first.");
  const executions = await prisma.execution.findMany({ where: { id: { in: trade.executions.map(e => e.id) } } });
  const fixtureKey = "COMPARISON-BENCHMARK-FIXTURE";
  const content = executions.map(e => `${e.id},${e.executedAt.toISOString()},${e.price}`).join("\n"), hash = createHash("sha256").update(content).digest("hex");
  await prisma.importArtifact.upsert({ where: { storageKey: fixtureKey }, create: { storageKey: fixtureKey, rawSha256: hash, rawBytes: content.length, content }, update: {} });
  const rowsJson = JSON.stringify(executions.map(e => ({ executionId: e.id, storedTime: e.executedAt.getTime()/1000, interpretedTime: e.executedAt.getTime()/1000, brokerWallTime: e.executedAt.toISOString(), side: e.side, price: e.price, quantity: e.quantity })));
  const batch = await prisma.importBatch.upsert({ where: { id: fixtureKey }, create: { id: fixtureKey, filename: "Synthetic benchmark timestamps", fileType: "executions", rawSha256: hash, rawStorageKey: fixtureKey, parserVersion: "fixture", timeInterpretation: { create: { timezone: "UTC", sourceHash: hash, parserVersion: "fixture", fingerprint: hash, rowsJson, normalizerVersion: TIME_INTERPRETATION_VERSION } } }, update: {} });
  await prisma.execution.updateMany({ where: { id: { in: executions.map(e => e.id) } }, data: { importBatchId: batch.id } });
  trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "DEMOC" }))[0];
  const to = Math.floor(trade.closeTime / 86400) * 86400 + 86400 - 1, from = to + 1 - 30 * 86400;
  const browser = await chromium.launch({ args: ["--disable-background-timer-throttling"] });
  try {
    for (const count of process.env.WORKSTATION_COMPARISON_PANELS ? [Number(process.env.WORKSTATION_COMPARISON_PANELS)] : coldCheck ? [1] : [1, 4]) for (const scenario of process.env.WORKSTATION_COMPARISON_SCENARIO ? [process.env.WORKSTATION_COMPARISON_SCENARIO] : coldCheck ? ["cold"] : ["cold", "partial", "warm"]) {
      let seed: { chunks: Awaited<ReturnType<typeof prisma.workstationCandleChunk.findMany>>; coverage: Awaited<ReturnType<typeof prisma.workstationCandleCoverage.findMany>> } | null = null;
      let supplementarySeed: { chunks: Awaited<ReturnType<typeof prisma.workstationCandleChunk.findMany>>; coverage: Awaited<ReturnType<typeof prisma.workstationCandleCoverage.findMany>>; metrics: Awaited<ReturnType<typeof prisma.workstationMetricCache.findMany>> } | null = null;
      for (let sample = -1; sample < samples; sample++) {
        // Discard one warm-up pair; alternate order to distribute machine/browser drift.
        for (const build of sample % 2 === 0 ? ["baseline", "changed"] : ["changed", "baseline"]) {
          const origin = `http://127.0.0.1:${build === "baseline" ? 3200 : 3101}`;
          const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
          try {
            const csrf = await (await context.request.get(`${origin}/api/auth/csrf`)).json();
            const login = await context.request.post(`${origin}/api/auth/callback/credentials`, { form: { csrfToken: csrf.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
            if (!login.ok()) throw new Error("Synthetic login failed");
            const intervals: Interval[] = count === 1 ? ["1h"] : ["5m", "1h", "1d", "1wk"];
            // Keep 5m within its 14-day page; longer overscroll can intentionally fetch
            // beyond the saved window and would not be a fully warm-cache scenario.
            const panels = intervals.map((interval, i) => ({ ...(build === "changed" ? { benchmark: comparison } : {}), id: `chart-${i + 1}`, interval, session: chartSession, range: { from: interval === "5m" ? to + 1 - 14 * 86400 : from, to } }));
            await prisma.workstationCandleChunk.deleteMany({ where: { symbol: trade.symbol } });
            await prisma.workstationCandleLease.deleteMany();
            await prisma.workstationCandleChunk.deleteMany({ where: { symbol: { in: ["SPY", "QQQ"] } } });
            await prisma.workstationMetricCache.deleteMany({ where: { symbol: trade.symbol } });
            const view = { version: 1, panels, arrangement: "left" };
            await prisma.workstationTradeView.upsert({ where: { groupKey: trade.id }, create: { groupKey: trade.id, view }, update: { view, revision: { increment: 1 } } });
            if (seed) {
              // Restore identical compressed payloads/coverage before each measured navigation.
              await prisma.workstationCandleChunk.createMany({ data: seed.chunks });
              await prisma.workstationCandleCoverage.createMany({ data: seed.coverage });
            } else if (scenario !== "cold") {
              for (const interval of intervals) {
                const params = new URLSearchParams({ symbol: trade.symbol, timeframe: interval, session: chartSession, from: String(from), to: String(scenario === "warm" ? to : from + 14 * 86400 - 1), mode: "complete" });
                let ready = false;
                for (let i = 0; i < 10 && !ready; i++) {
                  const response = await context.request.get(`${origin}/api/workstation/candles?${params}`, { timeout: 120000 });
                  if (!response.ok()) throw new Error(`Cache setup failed: ${response.status()}`);
                  const result = await response.json();
                  ready = !result.metadata?.cache?.missing.length && !result.metadata?.cache?.refresh.length;
                }
                if (!ready) throw new Error("Cache setup did not complete");
              }
              const chunks = await prisma.workstationCandleChunk.findMany({ where: { symbol: trade.symbol } });
              const coverage = await prisma.workstationCandleCoverage.findMany({ where: { chunkKey: { in: chunks.map(chunk => chunk.key) } } });
              seed = { chunks, coverage };
            }
            if (scenario !== "cold") {
              if (supplementarySeed) {
                await prisma.workstationCandleChunk.createMany({ data: supplementarySeed.chunks });
                await prisma.workstationCandleCoverage.createMany({ data: supplementarySeed.coverage });
                await prisma.workstationMetricCache.createMany({ data: supplementarySeed.metrics.map(m => ({ ...m, payload: m.payload ?? Prisma.JsonNull })) });
              } else {
                // Seed using the changed API with its own authenticated cookie.
                const metricsOrigin = "http://127.0.0.1:3101";
                const csrf2 = await (await context.request.get(`${metricsOrigin}/api/auth/csrf`)).json();
                await context.request.post(`${metricsOrigin}/api/auth/callback/credentials`, { form: { csrfToken: csrf2.csrfToken, username: "phase2-reviewer", password: "phase2-local-test-only", json: "true" } });
                if (comparison !== "off") for (const interval of intervals) {
                  const params = new URLSearchParams({ symbol: comparison, purpose: "benchmark", timeframe: interval, session: chartSession, from: String(from), to: String(scenario === "warm" ? to : from + 14 * 86400 - 1), mode: "complete" });
                  const response = await context.request.get(`${metricsOrigin}/api/workstation/candles?${params}`, { timeout: 120000 });
                  if (!response.ok()) throw new Error(`Supplementary fixture failed ${response.status()}`);
                }
                if (scenario === "warm") await context.request.get(`${metricsOrigin}/api/closed-trades/${encodeURIComponent(trade.id)}/market-metrics`, { timeout: 120000 });
                const chunks = await prisma.workstationCandleChunk.findMany({ where: { symbol: { in: ["SPY", "QQQ"] } } });
                supplementarySeed = { chunks, coverage: await prisma.workstationCandleCoverage.findMany({ where: { chunkKey: { in: chunks.map(c => c.key) } } }), metrics: await prisma.workstationMetricCache.findMany({ where: { symbol: trade.symbol } }) };
              }
            }
            const page = await context.newPage();
            await page.addInitScript(prefs => {
              localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs));
              const painted: Record<string, number> = {};
              const shaded: Record<string, boolean> = {};
              (window as unknown as { benchmarkShadedPanels: Record<string, boolean> }).benchmarkShadedPanels = shaded;
              (window as unknown as { ohlcFirstPaints: Record<string, number> }).ohlcFirstPaints = painted;
              const fill = CanvasRenderingContext2D.prototype.fillRect;
              CanvasRenderingContext2D.prototype.fillRect = function(...args) {
                if ((this.fillStyle === "#171e2b" || this.fillStyle === "#f2f5fa") && this.canvas.closest(".ws-chart-canvas")) {
                  const id = this.canvas.closest(".ws-chart")?.getAttribute("data-chart-id");
                  if (id) shaded[id] = true;
                }
                if ((this.fillStyle === "#38bfa6" || this.fillStyle === "#e47886") && this.canvas.closest(".ws-chart-canvas")) {
                  const id = this.canvas.closest(".ws-chart")?.getAttribute("data-chart-id");
                  if (id && !painted[id]) painted[id] = performance.now();
                }
                return fill.apply(this, args);
              };
            }, { ...defaultPreferences(), panels, journal: false });
            let httpRequests = 0, supplementaryHttp = 0;
            page.on("request", request => { if (request.url().includes("/market-metrics") || new URL(request.url()).searchParams.has("purpose")) supplementaryHttp++; else if (request.url().includes("/api/workstation/candles?")) httpRequests++; });
            const providerBefore = calls().length;
            await page.goto(`${origin}/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(trade.id)}`);
            await page.waitForFunction(count => Object.keys((window as unknown as { ohlcFirstPaints: object }).ohlcFirstPaints).length === count, count, { timeout: 120000 });
            const paints = await page.evaluate(() => Object.values((window as unknown as { ohlcFirstPaints: Record<string, number> }).ohlcFirstPaints));
            // Include all candle requests made by loading this saved view, including gap fill.
            await page.waitForFunction(() => document.querySelectorAll(".ws-history-progress, .ws-chart-state").length === 0, undefined, { timeout: 120000 });
            await page.waitForTimeout(300);
            const firstCandleMs = Math.min(...paints);
            if (process.env.WORKSTATION_COMPARISON_PROFILE === "1") {
              const timing = await page.evaluate(() => ({ navigation: performance.getEntriesByType("navigation").map(e => e.toJSON()), resources: performance.getEntriesByType("resource").map(e => e.toJSON()) }));
              mkdirSync(output, { recursive: true }); writeFileSync(path.join(output, `profile-${scenario}-${count}-${build}-${sample}.json`), JSON.stringify(timing, null, 2));
            }
            const responseReady = await page.evaluate(({ first, symbol }) => Math.max(0, ...performance.getEntriesByType("resource")
              .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && entry.name.includes("/api/workstation/candles?") && new URL(entry.name).searchParams.get("symbol") === symbol && entry.responseEnd <= first)
              .map(entry => entry.responseEnd)), { first: firstCandleMs, symbol: trade.symbol });
            const shadedPanels = await page.evaluate(() => Object.keys((window as unknown as { benchmarkShadedPanels: object }).benchmarkShadedPanels).length);
            const primaryTimings = await page.evaluate(symbol => performance.getEntriesByType("resource").filter((e): e is PerformanceResourceTiming => e instanceof PerformanceResourceTiming && e.name.includes("/api/workstation/candles?") && new URL(e.name).searchParams.get("symbol") === symbol).flatMap(e => e.serverTiming.map(t => ({ name: t.name, duration: t.duration }))), trade.symbol);
            if (chartSession === "extended" && build === "changed" && shadedPanels !== (count === 1 ? 1 : 2)) throw new Error("The extended-hours benchmark must paint shading in each intraday panel.");
            const row = { build, scenario, panels: count, sample, firstCandleMs, allCandlesMs: Math.max(...paints), paintAfterResponseMs: firstCandleMs - responseReady, httpRequests, providerCalls: calls().slice(providerBefore).filter(c => c.symbol === trade.symbol && !c.metric).length, supplementaryProvider: calls().slice(providerBefore).filter(c => c.symbol !== trade.symbol || c.metric).length, supplementaryHttp, shadedPanels };
            if (scenario === "warm" && row.providerCalls !== 0) throw new Error(`Warm fixture unexpectedly contacted provider double: ${JSON.stringify(row)}`);
            if (build === "changed" && comparison !== "off") {
              // Also verify the supplementary happy path; merely starting its HTTP
              // request does not establish that the comparison actually appeared.
              await page.waitForFunction(count => [...document.querySelectorAll(".ws-benchmark-legend")].filter(el => el.textContent?.includes(" · O ")).length === count, count, { timeout: 90000 });
              if (await page.locator(".ws-benchmark-error").count()) throw new Error("Benchmark did not complete without manual retry");
            }
            if (sample >= 0) { rows.push({ ...row, ...{ primaryTimings } }); mkdirSync(output, { recursive: true }); writeFileSync(path.join(output, "loading-progress.json"), JSON.stringify(rows, null, 2)); console.log(JSON.stringify(row)); }
          } finally { await context.close(); }
        }
      }
    }
  } finally {
    await browser.close();
    for (const execution of executions) await prisma.execution.update({ where: { id: execution.id }, data: { importBatchId: execution.importBatchId } });
    await prisma.importBatch.delete({ where: { id: fixtureKey } });
    await prisma.importArtifact.delete({ where: { storageKey: fixtureKey } });
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, coldCheck ? "loading-cold-check.json" : "loading-samples.json"), JSON.stringify(rows, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
