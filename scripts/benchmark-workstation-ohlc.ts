import { chromium } from "@playwright/test";
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
const coldCheck = process.env.WORKSTATION_OHLC_COLD_CHECK === "1";
const providerLog = path.join(process.env.TEMP!, "trade-workstation-phase2", "cache-provider.log");
const calls = () => existsSync(providerLog) ? readFileSync(providerLog, "utf8").trim().split("\n").filter(Boolean).length : 0;
const output = path.resolve("artifacts/ohlc");
const rows: { build: string; scenario: string; panels: number; sample: number; firstCandleMs: number; allCandlesMs: number; paintAfterResponseMs: number; httpRequests: number; providerCalls: number }[] = [];

async function main() {
  const trade = (await listWorkstationTrades({ account: "DEMO-WORKSTATION", symbol: "DEMOC" }))[0];
  if (!trade) throw new Error("Seed the existing synthetic DEMOC browser fixture first.");
  const to = Math.floor(trade.closeTime / 86400) * 86400 + 86400 - 1, from = to + 1 - 30 * 86400;
  const browser = await chromium.launch({ args: ["--disable-background-timer-throttling"] });
  try {
    for (const count of coldCheck ? [1] : [1, 4]) for (const scenario of coldCheck ? ["cold"] : ["cold", "partial", "warm"]) {
      let seed: { chunks: Awaited<ReturnType<typeof prisma.workstationCandleChunk.findMany>>; coverage: Awaited<ReturnType<typeof prisma.workstationCandleCoverage.findMany>> } | null = null;
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
            const panels = intervals.map((interval, i) => ({ id: `chart-${i + 1}`, interval, session: "regular" as const, range: { from: interval === "5m" ? to + 1 - 14 * 86400 : from, to } }));
            await prisma.workstationCandleChunk.deleteMany({ where: { symbol: trade.symbol } });
            await prisma.workstationCandleLease.deleteMany();
            const view = { version: 1, panels, arrangement: "left" };
            await prisma.workstationTradeView.upsert({ where: { groupKey: trade.id }, create: { groupKey: trade.id, view }, update: { view, revision: { increment: 1 } } });
            if (seed) {
              // Restore identical compressed payloads/coverage before each measured navigation.
              await prisma.workstationCandleChunk.createMany({ data: seed.chunks });
              await prisma.workstationCandleCoverage.createMany({ data: seed.coverage });
            } else if (scenario !== "cold") {
              for (const interval of intervals) {
                const params = new URLSearchParams({ symbol: trade.symbol, timeframe: interval, session: "regular", from: String(from), to: String(scenario === "warm" ? to : from + 14 * 86400 - 1), mode: "complete" });
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
            const page = await context.newPage();
            await page.addInitScript(prefs => {
              localStorage.setItem("execution-lab:workstation:preferences:application:v1", JSON.stringify(prefs));
              const painted: Record<string, number> = {};
              (window as unknown as { ohlcFirstPaints: Record<string, number> }).ohlcFirstPaints = painted;
              const fill = CanvasRenderingContext2D.prototype.fillRect;
              CanvasRenderingContext2D.prototype.fillRect = function(...args) {
                if ((this.fillStyle === "#38bfa6" || this.fillStyle === "#e47886") && this.canvas.closest(".ws-chart-canvas")) {
                  const id = this.canvas.closest(".ws-chart")?.getAttribute("data-chart-id");
                  if (id && !painted[id]) painted[id] = performance.now();
                }
                return fill.apply(this, args);
              };
            }, { ...defaultPreferences(), panels, journal: false });
            let httpRequests = 0;
            page.on("request", request => { if (request.url().includes("/api/workstation/candles?")) httpRequests++; });
            const providerBefore = calls();
            await page.goto(`${origin}/trades?account=DEMO-WORKSTATION&groupKey=${encodeURIComponent(trade.id)}`);
            await page.waitForFunction(count => Object.keys((window as unknown as { ohlcFirstPaints: object }).ohlcFirstPaints).length === count, count, { timeout: 120000 });
            const paints = await page.evaluate(() => Object.values((window as unknown as { ohlcFirstPaints: Record<string, number> }).ohlcFirstPaints));
            // Include all candle requests made by loading this saved view, including gap fill.
            await page.waitForFunction(() => document.querySelectorAll(".ws-history-progress, .ws-chart-state").length === 0, undefined, { timeout: 120000 });
            await page.waitForTimeout(300);
            const firstCandleMs = Math.min(...paints);
            const responseReady = await page.evaluate(({ first, symbol }) => Math.max(0, ...performance.getEntriesByType("resource")
              .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming && entry.name.includes("/api/workstation/candles?") && new URL(entry.name).searchParams.get("symbol") === symbol && entry.responseEnd <= first)
              .map(entry => entry.responseEnd)), { first: firstCandleMs, symbol: trade.symbol });
            const row = { build, scenario, panels: count, sample, firstCandleMs, allCandlesMs: Math.max(...paints), paintAfterResponseMs: firstCandleMs - responseReady, httpRequests, providerCalls: calls() - providerBefore };
            if (scenario === "warm" && row.providerCalls !== 0) throw new Error(`Warm fixture unexpectedly contacted provider double: ${JSON.stringify(row)}`);
            if (sample >= 0) { rows.push(row); console.log(JSON.stringify(row)); }
          } finally { await context.close(); }
        }
      }
    }
  } finally {
    await browser.close();
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, coldCheck ? "loading-cold-check.json" : "loading-samples.json"), JSON.stringify(rows, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
