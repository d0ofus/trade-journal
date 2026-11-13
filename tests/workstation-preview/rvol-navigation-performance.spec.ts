import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { openRvol } from "./rvol-fixture";

test.skip(process.env.WORKSTATION_RVOL_BENCHMARK !== "1", "Opt-in navigation benchmark; intercepted transport only");
test.use({ trace: "off", screenshot: "off" });
test("foreground trade navigation preempts a four-chart maximum-lookback warmup", async ({ browser }) => {
  test.setTimeout(360000);
  const samples = Number(process.env.WORKSTATION_RVOL_SAMPLES ?? 20);
  const rows: { enabled: boolean; firstPaint: number; allPaints: number; clickToPaint: number }[] = [];
  for (let sample = 0; sample < samples; sample++) for (const enabled of sample % 2 ? [true, false] : [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), page = await context.newPage();
    try {
      const info = await openRvol(page, { enabled, panels: 4, lookback: 100, extended: true, cache: "cold", delay: 200 });
      if (enabled) await expect.poll(() => info.requests.filter(r => r.purpose === "indicator").length).toBeGreaterThan(0);
      await page.evaluate(() => {
        window.rvolMetrics.paints = {}; window.rvolMetrics.started = null; window.rvolMetrics.symbol = "AAPL";
        // Measure the actual input event, excluding Playwright's stability wait.
        document.addEventListener("click", () => { window.rvolMetrics.clickedAt = performance.now(); }, { capture: true, once: true });
      });
      await page.getByRole("button", { name: /^AAPL .*Long/ }).click();
      await expect.poll(() => page.evaluate(() => Object.keys(window.rvolMetrics.paints).length)).toBe(4);
      const metrics = await page.evaluate(() => window.rvolMetrics), paints = Object.values(metrics.paints);
      expect(info.errors).toEqual([]); expect(metrics.started).not.toBeNull(); expect(metrics.clickedAt).toBeGreaterThan(0);
      rows.push({ enabled, firstPaint: Math.min(...paints) - metrics.started!, allPaints: Math.max(...paints) - metrics.started!, clickToPaint: Math.min(...paints) - metrics.clickedAt! });
    } finally { await context.close(); }
  }
  const p95 = (key: "firstPaint" | "allPaints" | "clickToPaint", enabled: boolean) => rows.filter(r => r.enabled === enabled).map(r => r[key]).sort((a,b) => a-b)[Math.ceil(samples * .95) - 1];
  const deltas = Object.fromEntries((["firstPaint", "allPaints", "clickToPaint"] as const).map(key => [key, p95(key, true) - p95(key, false)]));
  await mkdir("artifacts/rvol-release", { recursive: true });
  await writeFile("artifacts/rvol-release/navigation-performance.json", JSON.stringify({ samples, deltas, rows }, null, 2));
  console.log(JSON.stringify({ samples, deltas }));
  for (const delta of Object.values(deltas)) expect(delta).toBeLessThanOrEqual(100);
});
