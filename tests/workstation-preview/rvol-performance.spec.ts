import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { openRvol } from "./rvol-fixture";

test.skip(process.env.WORKSTATION_RVOL_BENCHMARK !== "1", "Opt-in browser benchmark; intercepted market transport only");
test.use({ trace: "off", screenshot: "off" });
const samples = Number(process.env.WORKSTATION_RVOL_SAMPLES ?? 20);
const percentile = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];

for (const cache of ["cold", "partial", "warm"] as const) for (const panels of [1, 4]) for (const lookback of [20, 100]) for (const extended of [false, true]) {
  test(`${cache} · ${panels} charts · ${lookback} periods · ${extended ? "extended" : "regular"}`, async ({ browser }) => {
    test.setTimeout(360000);
    const rows: { enabled: boolean; sample: number; firstPaint: number; allPaints: number; navigationFirstPaint: number; ready: number; requests: number; indicatorFills: number; maximumSlice: number; longTasks: number[] }[] = [];
    for (let sample = 0; sample < samples; sample++) for (const enabled of sample % 2 ? [true, false] : [false, true]) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      try {
        const info = await openRvol(page, { enabled, cache, panels, lookback, extended });
        await expect.poll(() => page.evaluate(() => Object.keys(window.rvolMetrics.paints).length), { timeout: 20000 }).toBe(panels);
        if (enabled) for (const chart of await page.locator(".ws-chart").all()) await expect(chart).toHaveAttribute("data-rvol-status", "ready", { timeout: 60000 });
        const metrics = await page.evaluate(() => ({ ...window.rvolMetrics, ready: performance.now() }));
        // Start at the first foreground candle request. Keep navigation timing too,
        // but exclude Next development-server HTML/compilation jitter from the gate.
        expect(metrics.started).not.toBeNull();
        const row = { enabled, sample, firstPaint: Math.min(...Object.values(metrics.paints)) - metrics.started!, allPaints: Math.max(...Object.values(metrics.paints)) - metrics.started!, navigationFirstPaint: Math.min(...Object.values(metrics.paints)), ready: metrics.ready - metrics.started!, requests: info.requests.length, indicatorFills: info.fills.filter(p => p === "indicator").length, maximumSlice: Math.max(0, ...metrics.calculations.map(m => m.maximumSlice)), longTasks: metrics.longTasks };
        if (info.errors.length) console.log(JSON.stringify({ enabled, sample, errors: info.errors }));
        expect(info.errors).toEqual([]);
        if (!enabled) { expect(info.requests.filter(r => r.purpose === "indicator")).toHaveLength(0); expect(metrics.calculations).toHaveLength(0); expect(metrics.calculationStarts).toHaveLength(0); }
        const allPricePainted = Math.max(...Object.values(metrics.paints));
        for (const started of [...metrics.paneStarts, ...metrics.calculationStarts, ...metrics.indicatorStarts]) expect(started).toBeGreaterThanOrEqual(allPricePainted);
        if (cache === "warm") expect(row.indicatorFills).toBe(0);
        expect(row.maximumSlice).toBeLessThan(50);
        rows.push(row);
        if (process.env.WORKSTATION_RVOL_PROGRESS === "1") console.log(JSON.stringify(row));
      } finally { await context.close(); }
    }
    const baseline = rows.filter(r => !r.enabled), changed = rows.filter(r => r.enabled);
    const report = { cache, panels, lookback, extended, samples, firstPaintP95: { off: percentile(baseline.map(r => r.firstPaint)), on: percentile(changed.map(r => r.firstPaint)) }, allPaintsP95: { off: percentile(baseline.map(r => r.allPaints)), on: percentile(changed.map(r => r.allPaints)) }, rows };
    await mkdir("artifacts/rvol-release", { recursive: true });
    await writeFile(`artifacts/rvol-release/performance-${cache}-${panels}-${lookback}-${extended ? "extended" : "regular"}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, rows: undefined }));
    expect(report.firstPaintP95.on - report.firstPaintP95.off).toBeLessThanOrEqual(100);
    expect(report.allPaintsP95.on - report.allPaintsP95.off).toBeLessThanOrEqual(100);
  });
}
