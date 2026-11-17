/** Intercepted preview only. Record `baseline` on the parent commit, then `implemented`. */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openRvol } from "../tests/workstation-preview/rvol-fixture";

declare global { interface Window { timezoneDurations: number[] } }

type Row = { panels: number; cache: string; sample: number; first: number; all: number; navigation: number; requests: number; maximumTimezoneTask: number };
const percentile = (rows: number[]) => [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * .95) - 1];
async function main() {
  const phase = process.argv[2] ?? "implemented", samples = Number(process.env.TIMEZONE_SAMPLES ?? 20);
  if (!["baseline", "implemented"].includes(phase)) throw new Error("Choose baseline or implemented.");
  const baseURL = process.env.WORKSTATION_PREVIEW_BASE_URL ?? "http://127.0.0.1:3217";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Use a loopback preview server.");
  const browser = await chromium.launch(), rows: Row[] = [];
  try {
    const warm = await browser.newContext({ baseURL }), page = await warm.newPage(); await openRvol(page); await warm.close();
    for (const panels of [1, 4]) for (const cache of ["warm", "cold"] as const) {
      for (let sample = 0; sample < samples; sample++) {
        const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, timezoneId: "Australia/Sydney" }), page = await context.newPage();
        try {
          await page.addInitScript(() => { window.timezoneDurations = []; window.addEventListener("workstation-timezone-updated", e => window.timezoneDurations.push((e as CustomEvent).detail.duration)); });
          const info = await openRvol(page, { panels, cache, enabled: panels === 4, index: true });
          await page.waitForFunction(n => Object.keys(window.rvolMetrics.paints).length === n, panels);
          const initial = await page.evaluate(() => ({ started: window.rvolMetrics.started!, paints: Object.values(window.rvolMetrics.paints) }));
          await page.evaluate(() => { window.rvolMetrics.paints = {}; window.rvolMetrics.started = null; window.rvolMetrics.symbol = "AAPL"; document.addEventListener("click", () => { window.rvolMetrics.clickedAt = performance.now(); }, { capture: true, once: true }); });
          await page.getByRole("button", { name: /^AAPL .*Long/ }).click();
          await page.waitForFunction(n => Object.keys(window.rvolMetrics.paints).length === n, panels);
          const nav = await page.evaluate(() => ({ metrics: window.rvolMetrics, maximumTimezoneTask: Math.max(0, ...window.timezoneDurations) }));
          if (info.errors.length) throw new Error(info.errors.join("\n"));
          rows.push({ panels, cache, sample, first: Math.min(...initial.paints) - initial.started, all: Math.max(...initial.paints) - initial.started, navigation: Math.min(...Object.values(nav.metrics.paints)) - nav.metrics.clickedAt!, requests: info.requests.length, maximumTimezoneTask: nav.maximumTimezoneTask });
        } finally { await context.close(); }
      }
      console.log(JSON.stringify({ phase, panels, cache, completed: samples }));
    }
    await mkdir("artifacts/timezone-release", { recursive: true });
    await writeFile(`artifacts/timezone-release/${phase}-performance.json`, JSON.stringify({ phase, samples, rows }, null, 2));
    if (phase === "implemented") {
      const baseline = JSON.parse(await readFile("artifacts/timezone-release/baseline-performance.json", "utf8")) as { rows: Row[] };
      const comparisons = [];
      for (const panels of [1, 4]) for (const cache of ["warm", "cold"]) {
        const before = baseline.rows.filter(r => r.panels === panels && r.cache === cache), after = rows.filter(r => r.panels === panels && r.cache === cache);
        const deltas = Object.fromEntries((["first", "all", "navigation"] as const).map(key => [key, percentile(after.map(r => r[key])) - percentile(before.map(r => r[key]))]));
        comparisons.push({ panels, cache, deltas });
      }
      const maximumTimezoneTask = Math.max(...rows.map(r => r.maximumTimezoneTask));
      await writeFile("artifacts/timezone-release/performance-comparison.json", JSON.stringify({ comparisons, maximumTimezoneTask }, null, 2));
      console.log(JSON.stringify({ comparisons, maximumTimezoneTask }));
      if (maximumTimezoneTask >= 50 || comparisons.some(c => Object.values(c.deltas).some(value => value > 100))) throw new Error("Timezone performance budget exceeded.");
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
