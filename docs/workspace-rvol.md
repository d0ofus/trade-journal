# Workspace relative volume

The **RVOL** button in the workspace toolbar and fullscreen chart controls shows
or hides a relative-volume pane on each workspace chart. It starts hidden for
new and existing device preferences. Chart settings shares the same visibility,
mode and 1–100 lookback controls. Hiding it retains the settings, cancels warmup,
and creates no RVOL series, calculation or history request. Peer charts are outside
this feature.

| Selected mode | Baseline |
| --- | --- |
| Ordinary | Average of the preceding N candles, excluding the current candle |
| At time, cumulative (default) | Average accumulation through the corresponding bucket in N previous comparable sessions |
| At time, per bar | Average volume of the corresponding bucket in N previous comparable sessions |

The default lookback is 20. Daily and weekly charts use ordinary RVOL while
retaining the selected at-time mode for the next intraday chart. The pane legend
identifies the effective calculation and its units. Crosshair inspection reports
the ratio, actual volume, historical average, sample count and availability.
Forming candles are provisional; their final volume is not estimated.

## Historical inputs

`src/lib/workstation/rvol.ts` is independent of chart rendering. At-time modes
require verified New York exchange/session metadata, follow regular or extended
selection, match local clock times across DST, and use the existing US-equity
holiday and early-close calendar. Extended accumulation resets at local midnight,
including premarket volume when inspecting the regular open. Incompatible bucket
lengths are excluded. Only 2N previous trading sessions are searched.

N valid samples are required. An unqueried or incompletely retrieved recent
session cannot be replaced with an older one. Verified empty buckets can contribute
zero; unreported volume, pre-listing history and a zero historical average remain
unavailable. Before Entry and replay filter candles before calculation. Native
adjusted volumes are consumed directly, with provider/feed/session/split-revision
identity kept separate.

## Loading and panes

Warmup uses the chart's candles, the existing adapter memory cache, then cache-only
probes and bounded fills through `/api/workstation/candles?purpose=indicator`.
There is no volume endpoint or subscription. Indicator fills use supplementary
background storage/scheduling, release ownership between pages and yield to
foreground navigation. One workspace queue waits for all foreground charts and
their native price paints before starting RVOL panes or calculation work.
Warmup has its own bounded buffer, loading state, cancellation and Retry; it never
feeds baseline-only candles back into the primary chart series. Viewport changes
are debounced by 250 ms and calculation batches yield after approximately 8 ms.

The native pane order is price, optional separate index, then RVOL. RVOL initially
uses 20% of plotting height, with saved per-panel ratios bounded to 15–40%. The
index ratio applies to the remaining price/index area. Drawings use actual native
pane references; RVOL itself is not a drawing surface. The raw-volume series stays
alive across primary data updates, avoiding a Lightweight Charts timeline-index
reset when a lower series contains only a subset of the primary timestamps.

PNG/snapshot capture freezes the displayed calculation and legend. The export
chart copies measured pane stretch proportions, date and price ranges, including
the separator and time-axis geometry. Capture locks visibility and layout changes.

Preferences, saved views, recovery and backup validation retain optional settings
and pane ratios without changing document/view versions or the database schema.
No migration or independent worker deployment is needed.

## Verification

The mock-only provider suites run with:

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.workstation.config.ts
npm run test:workstation
npm run check:workstation:validation
```

The development-only RVOL preview uses the real candle adapter against intercepted
synthetic transport. It is unavailable in production. Browser coverage includes
hidden behavior, keyboard controls, settings, coarse-interval fallback, native
resizing, Before Entry/replay, warmup failures and trade-switch cancellation, plus
stock/index drawing and export geometry in both themes at DPR 1, 1.25 and 2.

The opt-in `rvol-performance.spec.ts` matrix uses cold, partially cached and fully
cached transport; one/four charts; regular/extended sessions; and 20/100 lookbacks.
The benchmark defaults to 20 alternating off/on samples per case and measures
first/all price-candle paints from the first foreground candle request, separately
from RVOL readiness. Raw navigation
timings and browser long tasks are also retained. The chart-loading gate excludes
development-server HTML/compilation jitter; this is a controlled browser comparison,
not a production-provider latency guarantee. Hidden calculations/indicator calls,
warm-cache provider fills, calculation slice duration and p95 chart-loading deltas
are asserted. Pane creation, calculation and indicator transport timestamps must
follow every mounted price chart's first paint. Raw results and generated PNGs stay
in ignored `artifacts/rvol-release`.

Release validation used a complete 24-configuration matrix with ten paired trials
per configuration and expanded 20-pair checks for navigation and the three largest
regular-session cases. The final worst p95 increase was 92.7 ms for the first chart
and 93.0 ms for all charts. Navigation increased by 80 ms from the actual click
event, including 38.5 ms from the first candle request. The longest measured
calculation slice was 20.7 ms. Hidden RVOL performed no calculation or indicator
retrieval, and fully cached lookbacks required zero indicator provider fills.

276 mock-only unit/provider checks, 71 existing workstation regressions, and 28
distinct browser scenarios passed across the focused runs (13 RVOL, ten index
drawing, and five peer scenarios). Type checking, affected-file lint, repository
safety and the production build passed. Exported dark/light PNGs at all three DPRs
were visually inspected. Captures wait for pending pane activation before freezing
their geometry, including when a capture immediately follows the RVOL toggle.

A read-only audit of checksum-verified stored five-minute SIP volumes on 13 November
2026 matched independent sums and averages for all three modes with N=20:

| Ticker / UTC candle | Ordinary | At-time per bar | At-time cumulative |
| --- | ---: | ---: | ---: |
| TSEM / 2026-03-12 19:55 | 6.914124× | 0.851873× | 1.340530× |
| LUNR / 2026-07-07 19:55 | 4.638440× | 0.501487× | 0.595852× |

The inspected NVDA cache lacked contiguous 20-session coverage and was correctly
unavailable. The audit fetched no provider data and made no database writes.
