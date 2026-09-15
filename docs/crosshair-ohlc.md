# Crosshair OHLC readout

Each workstation chart shows the candle under its crosshair. Linked charts use the existing session-aware time mapping to show their own timeframe's candle. Pointer exit, whitespace, or a missing linked candle retains the last inspection. Before inspection, the default remains the last completed candle at/before the visible range end.

The controller owns four empty text slots, their visibility and the close-price class. Pointer events read the candlestick entry from Lightweight Charts' `seriesData` map and write the values synchronously. Linked moves update the controller explicitly because Lightweight Charts 5.1.0 suppresses callbacks for programmatic crosshair positioning. Unchanged values skip formatting/DOM writes. No React state, series updates, requests, storage writes, timers, layout measurements, or extra animation frames are introduced by the readout.

After the existing series update, a binary timestamp lookup reconciles a retained inspection against the rendered candles. This handles corrected history and prevents replay from retaining future prices. A same-context reload preserves the inspected time; trade, interval, session and timestamp-interpretation changes clear it. The controller and event subscription are disposed with the chart. Shared trade, journal and preview charts inherit this behavior.

## Verification

- Eight controller tests cover formatting, invalid/missing data, unchanged values, corrections, viewport defaults, history merges, empty datasets, replay exclusion and context/reload behavior.
- Eight browser tests cover one through four panels, mixed timeframes, linked/independent movement, retention, history extension, theme/resize/fullscreen, context changes and replay.
- Browser instrumentation observes actual chart component commits and candle-layer painting. A pointer sweep causes zero chart commits, storage writes or candle-layer repaints; vertical movement within the same candle causes zero OHLC DOM mutations.
- 10,000 updates against real DOM nodes completed synchronously, with a measured p95 of **0.1 ms** and maximum of **0.5 ms** on the local test machine.
- Existing cache/history, sizing/labels, saved-view and authenticated browser regressions are included. One old label test expected a global toggle; it failed identically on the unchanged baseline and was corrected to assert the existing per-panel behavior.

## Repeating the loading comparison

`scripts/benchmark-workstation-ohlc.ts` accepts only the guarded disposable `trades_workstation_auth_test` database on `127.0.0.1:55439`, synthetic DEMOC data, and explicit `WORKSTATION_OHLC_BENCHMARK=1`. Start the unchanged production build on port 3200 and the changed build on port 3101 with the existing offline provider fence and synthetic authentication. Use identical simulated provider delays for both builds. No live provider requests are permitted.

Set `WORKSTATION_OHLC_SAMPLES=10` and run `node --import tsx scripts/benchmark-workstation-ohlc.ts`. The script alternates build order, discards a warm-up pair per scenario, and restores identical cached payloads and coverage before each navigation. It measures actual candlestick canvas painting, not a loading label or a delayed viewport attribute. Outputs are in `artifacts/ohlc/loading-samples.json`.

The single-panel case uses 30 days of hourly candles. The four-panel case uses 5m/1h/1d/1wk candles, with 14 days for 5m and 30 days for the other panels. The 5m range stays within one history page so the warm case does not intentionally request uncached overscroll. Cold, partially cached and fully cached runs record first-panel paint, all-panel paint, candle HTTP requests and simulated provider requests. These local measurements establish regression evidence; they are not production latency guarantees.

Run this serially with other cache/browser suites stopped: it restores the synthetic fixture's cache and resets the test database's cache leases. `WORKSTATION_OHLC_COLD_CHECK=1` repeats only the single-chart cold case and writes `loading-cold-check.json`, including response-to-paint timing for the target symbol.

## Measured results — 15 September 2026

Both production builds used Node 22.23.1, Chromium, a 1920×1080 viewport, identical frozen/synthetic candles and a 50 ms simulated provider delay. The main comparison contains 120 measured navigations; the cold follow-up adds 20. Warm-up pairs are excluded. Values below are medians in milliseconds, measured from navigation to the first candlestick draw in the relevant panel(s).

| Panels | Cache | First panel: baseline → changed | All panels: baseline → changed | Candle HTTP calls per load, both builds |
| --- | --- | ---: | ---: | ---: |
| 1 | Cold | 2617.8 → 2831.1 | 2617.8 → 2831.1 | 5 |
| 1 | Partial | 459.2 → 497.1 | 459.2 → 497.1 | 4 |
| 1 | Warm | 479.1 → 502.6 | 479.1 → 502.6 | 2 |
| 4 | Cold | 2999.8 → 3049.7 | 6427.4 → 6237.8 | 14 |
| 4 | Partial | 609.5 → 547.8 | 3421.5 → 3519.5 | 13 |
| 4 | Warm | 532.7 → 510.0 | 595.8 → 576.4 | 8 |

No repeatable loading slowdown was detected: each scenario's paired mean difference had a 95% confidence interval containing zero. The extra cold comparison reversed the median ordering (2680.6 ms baseline, 2573.1 ms changed). After the target candle response arrived, its median response-to-paint time was 20.35 ms versus 22.10 ms; the paired mean difference's 95% interval was −6.4 to +5.5 ms. This separates variable request/cache timing from browser drawing work. The OHLC controller's own synchronous text update remained within the 1 ms budget.

Warm runs made zero simulated provider calls. Provider counts otherwise matched, except one four-panel partial-cache run on the changed build logged five calls instead of the usual four, with the same 13 browser requests. That outlier remains included in the results. No candle request or backend/provider code was changed.

Final verification: **83 unit/history/cache tests and 29 browser tests passed**, including the corrected existing label test. The final production build, application/workstation TypeScript checks, targeted ESLint and repository-safety scan passed. Raw samples, summaries, the interaction timing and a linked-crosshair screenshot are retained under `artifacts/ohlc/`.
