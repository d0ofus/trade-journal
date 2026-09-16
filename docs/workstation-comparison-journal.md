# Chart comparison and template journaling

## Using the workstation

- Each panel has an **Off / SPY / QQQ** comparison selector and an independent **Before entry** button. Both are saved with that trade's panel view.
- Benchmark candles use original prices on an independent, hidden, automatically scaled axis. They do not affect the trade's price scale or execution coordinates. The legend shows actual OHLC, percentage change from the first common visible open, and Independent scale. Vertical distances between independently scaled series are not directly comparable. Chart settings can change their default blue colour; Shift+I toggles the focused panel's last index selection. See [note controls and diagnosis proposals](workstation-controls-diagnosis.md).
- Missing benchmark timestamps stay missing. Benchmark data cannot add horizontal positions to the primary chart. Comparisons follow the chart interval, session, loaded coverage, replay and export settings.
- **Before entry** excludes the entire candle containing the first interpreted execution. Daily panels exclude its date; weekly panels exclude its week. It also excludes later indicators, markers, drawings with future anchors, and comparison candles. Turning it off restores the previous view without refetching that history. Unresolved execution times or coarse candle date conventions disable the control.
- **Chart settings** contains Buy colour, Sell colour and Reset. These device preferences affect execution markers and exported images.

## Pre-trade metrics

The authenticated endpoint determines the previous New York trading session from the first interpreted execution. Changing the chart timeframe does not change that reference. Supplementary failures leave the primary chart usable.

| Metric | Definition |
| --- | --- |
| ADR% · 14 | Mean of 14 daily high-minus-low ranges, divided by the reference close, times 100 |
| ATR% · 14 | Wilder ATR14 divided by the reference close, times 100; seed with 14 true ranges and smooth over up to 250 sessions |
| Avg dollar volume · 20 | Mean of 20 daily close-times-volume values |
| Market cap · estimated | Raw reference close times eligible SEC-reported historical shares, adjusted for intervening splits |

True range is the maximum of high-minus-low, absolute high-minus-previous-close and absolute low-minus-previous-close. Volatility and dollar volume use Alpaca split-adjusted daily prices and volumes. Windows must contain consecutive completed sessions; short ATR initialization is identified in its tooltip. No currency conversion is applied.

The SEC adapter accepts only shares observations and filings available before the reference cutoff. Same-session filings are excluded because the concept endpoint does not establish their publication time. Ambiguous share classes, ETFs, missing history or unavailable SEC responses produce **Unavailable**, never today's market cap. The raw/split price ratios remove splits after the reference date from the share adjustment. The shares observation and source are displayed when available.

`SEC_USER_AGENT` can supply the operator's SEC identification/contact string. Live SEC requests returned HTTP 403 from the development environment; the selection and split calculations were verified with fixtures. The UI handles this as unavailable historical shares.

Formula and provider references: [TradingView ADR/ATR](https://www.tradingview.com/support/solutions/43000734653-how-are-adr-and-atr-calculated/), [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbarsingle-1), [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [NYSE calendar](https://www.nyse.com/trade/hours-calendars).

## Journal and exports

The shared field mapping in `notion-template.ts` defines all 29 exported properties in their original order. It retains editable template suggestions, custom relation names, Market Regime "Rotation", multiple sector proxies, and numeric X from 50 SMA multiples. Planned entry and stop derive S/L%; qualitative assessments remain manual.

The page has six chart sections, technical positives/negatives, Ideal Execution, Fundamentals, noteworthy positives/negatives, and Takeaways. Editor code loads dynamically when an editor mounts, keeping Tiptap out of the initial chart bundle. Editors mount when their sections open and support bold, italics, underline, bullets, numbered lists, undo/redo and keyboard shortcuts. The property and body use one Takeaways value. Existing plain Takeaways are escaped into paragraphs; unmapped material stays under Previous review fields or preserved original material.

Each chart section has an Attach current chart button. General attachment buttons open a destination selector. Capture and section assignment save together; checkboxes can assign one image to several sections. Removing evidence removes its section references. Navigation during capture cancels the pending attachment.

Export review for Notion saves first, then offers a Database CSV and Review page ZIP from the same saved snapshot. CSV uses template property names, MM/DD/YYYY New York dates, TRUE/FALSE checkboxes, raw numbers, and plain text. Unresolved dates are blank. S/L % (snapshot) is a number in percentage points, not a formula. The ZIP contains only review.html and local image assets, preserving formatting, previous review fields and images under their assigned headings. Older unassigned images appear under Unassigned charts.

In Notion, use Merge with CSV on the existing database; map Name to the title property. Imports add rows and can create duplicates; Trade ID is not an upsert key. Map relation columns to existing relation properties where supported and verify their targets, or import as Text and link manually. Preserve existing formulas; map snapshots to separate Number properties. Import the ZIP through Settings → Import → ZIP, then move its review blocks into the matching database page. File import does not automatically join page content to the CSV row or apply a database template. See [Notion import instructions](https://www.notion.com/help/import-data-into-notion).

PNG captures retain the header and axes, remove the diagnostic footer, and expand the chart into its former space. This applies to individual/layout downloads, clipboard images and new attachments. Stored screenshots are unchanged.

## Older-trade metrics diagnosis (original release)

Read-only inspection reproduced all four unavailable metrics for IE entered January 7, 2026. Its instrument is stored as OTHER. Its first execution has a resolved, user-confirmed New York timestamp; the reference session is January 6. `loadTradeMetrics` returns Unsupported instrument at its asset-type guard, before requesting daily bars or historical shares. Older imported equities commonly retain OTHER classifications. The current parser recognizes STK but does not repair old records. This identifies the immediate blocker, not the original import operation that created it.

Recommended follow-up: add a metrics-specific legacy equity eligibility resolver. Retain explicit option, futures, forex and crypto exclusions, including options historically marked OTHER. Admit legacy USD equity candidates only with supporting instrument/provider evidence; preserve stored classifications and trade identities. Test an IE-equivalent fixture, OTHER options and ambiguous symbols; expose useful unavailable reasons and retryable provider failures. Do not bulk-reclassify instruments merely from ticker shape. Historical market cap still separately requires eligible SEC shares and verified price history.

The original release changed no metric eligibility or calculations. The later approved share-assumption compatibility and saving implementation is described in [workstation controls and saving](workstation-controls-diagnosis.md); stored classifications and automatic history loading remain unchanged.

## App storage monitor

Settings → Cloud storage is independent of the workstation flag. Physical current-database and branch totals include chart/metric cache. Existing 100 MB cache and 400 MB branch growth guards are application limits, not provider quotas. Warnings begin at 80/350 MB and cache persistence pauses at 99/399 MB. Metric cache is a subset of cache; cache is included in database usage.

Logical payload totals include inline JournalChart images, images embedded in ClosedTradeNote workstation JSON, and archived import content. They measure stored text bytes, including base64, before database compression and indexes; do not add them to physical totals. External/local screenshot references have counts but unmeasured file storage. No provider monitoring credentials, cleanup actions, worker or schema migration are required. The authenticated endpoint returns aggregates only. Refresh runs every minute while visible and retains the prior reading as stale on failure.

## Persistence and limits

Migration `20260916000000_workstation_comparison_review` adds nullable `JournalEntry.templateData`, a supplementary flag on candle chunks, and `WorkstationMetricCache`. Compatible columns and relation tables remain authoritative. Template-only content is stored on the linked journal entry and composed into workstation reads; it is omitted from the saved workstation snapshot. Revision conflicts, recovery drafts and backup/restore remain supported. Metric caches are regenerable and omitted from backups.

- Supplementary candle payloads share the existing candle cache and are limited to 10,000,000 bytes. They remain unprotected and can be evicted. A subsequent primary request promotes ownership without duplicating the chunk.
- Metric results are limited to 2,048 bytes each and 5,000,000 payload bytes in total. No complete SEC filings are stored in PostgreSQL.
- Supplementary persistence stops at the existing cache warning threshold. Cache accounting includes the metric table and indexes.
- The existing 4 MB review-package guard remains. Images dominate storage; supported R2 image storage is a separate configuration/migration task.

### Measured storage

`scripts/measure-comparison-storage.ts` reads the supplied OSCR Markdown/images without importing them into application trades. It uses a dedicated disposable PostgreSQL database and writes aggregate measurements to `artifacts/comparison/storage.json`.

| Measurement | Bytes |
| --- | ---: |
| Representative OSCR review text and metadata | 4,971 |
| Template-only JSON | 3,842 |
| Eleven original PNG images | 2,580,317 |
| Review package including base64 images | 3,446,713 |
| Table/index growth for 1,000 template-plus-Takeaways rows | 3,686,400 |
| Representative compact unavailable metric result | 366 |
| Table/index growth for 1,000 metric rows | 802,816 |
| Synthetic one-year SPY and QQQ payloads, all six intervals | 4,723,044 |

The candle figure is a compression estimate from synthetic bars, not a prediction of live provider data. PostgreSQL compression and page allocation make logical JSON size and physical table growth different measurements. Actual review sizes vary with text and images. Live production database headroom was not measured from this workspace.

## Loading and verification

Primary and supplementary requests have separate priorities. Cache probes start independently; the existing server-wide provider limiter makes supplementary network work yield to primary demand. Primary cache leases retain their priority through persistence, including slow database-size accounting. Supplementary loads defer storage-budget checks until persistence and retain their results in memory when a primary lease is active. Shared request lifetimes and caches prevent duplicate work. Abort signals cancel obsolete comparisons. Metric completion updates an isolated strip rather than the chart workspace's React tree. The existing primary OHLC controller continues to write synchronously without React state, network requests or series updates on crosshair movement.

The production benchmark compares baseline commit `650bb497620c1d0f05f0e0e45863bd874cf084ee` against this implementation, with a local synthetic provider, one/four panels, extended sessions, and cold/partial/warm cache fixtures. Each scenario discards a warm-up pair, alternates build order and records five pairs. First-candle times are captured at actual candle canvas writes. Primary request counts and supplementary request counts are recorded separately through completion of the primary loading phase; supplementary provider work may continue afterward. The development server and other build/test jobs are stopped during the final timing run.

Raw results live in ignored `artifacts/comparison/{off,SPY,QQQ}/loading-samples.json`. The benchmark and storage scripts reject databases outside their explicitly named disposable local targets and fence provider requests to synthetic data.

### Production loading results

The final matrix completed **180 measured loads**, plus 36 discarded warm-up loads. The table reports arithmetic means in milliseconds. Confidence intervals use paired differences (changed minus baseline), five pairs and Student's t with four degrees of freedom. Every first-candle and all-panel interval included zero or favored the changed build: no statistically distinguishable slowdown was observed. Wide cold/partial intervals reflect the local database variation; these measurements do not prove exact equivalence or guarantee timings on other machines.

| Comparison | Panels | Cache | First candle: baseline → changed | Difference, 95% CI | All panels: baseline → changed | Difference, 95% CI |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Off | 1 | Cold | 4,151 → 4,433 | 282 [−253, 818] | 4,151 → 4,433 | 282 [−253, 818] |
| Off | 1 | Partial | 773 → 760 | −13 [−137, 111] | 773 → 760 | −13 [−137, 111] |
| Off | 1 | Warm | 808 → 755 | −53 [−249, 143] | 808 → 755 | −53 [−249, 143] |
| Off | 4 | Cold | 5,915 → 6,162 | 247 [−1,546, 2,040] | 12,930 → 12,720 | −210 [−1,783, 1,362] |
| Off | 4 | Partial | 776 → 852 | 76 [−236, 387] | 7,629 → 7,906 | 277 [−4,965, 5,518] |
| Off | 4 | Warm | 826 → 712 | −114 [−323, 96] | 854 → 739 | −115 [−324, 94] |
| SPY | 1 | Cold | 5,661 → 4,408 | −1,253 [−3,642, 1,136] | 5,661 → 4,408 | −1,253 [−3,642, 1,136] |
| SPY | 1 | Partial | 1,019 → 974 | −46 [−827, 736] | 1,019 → 974 | −46 [−827, 736] |
| SPY | 1 | Warm | 773 → 747 | −26 [−166, 113] | 773 → 747 | −26 [−166, 113] |
| SPY | 4 | Cold | 5,446 → 5,098 | −348 [−884, 189] | 11,509 → 10,759 | −750 [−2,008, 508] |
| SPY | 4 | Partial | 773 → 839 | 65 [−1, 132] | 8,497 → 6,650 | −1,847 [−5,187, 1,492] |
| SPY | 4 | Warm | 800 → 754 | −46 [−266, 174] | 836 → 884 | 47 [−159, 254] |
| QQQ | 1 | Cold | 5,201 → 5,117 | −84 [−709, 541] | 5,201 → 5,117 | −84 [−709, 541] |
| QQQ | 1 | Partial | 768 → 813 | 45 [−20, 111] | 768 → 813 | 45 [−20, 111] |
| QQQ | 1 | Warm | 811 → 840 | 29 [−68, 126] | 811 → 840 | 29 [−68, 126] |
| QQQ | 4 | Cold | 5,447 → 4,896 | −551 [−1,813, 712] | 10,738 → 10,297 | −441 [−1,660, 779] |
| QQQ | 4 | Partial | 766 → 702 | −64 [−306, 178] | 8,110 → 4,990 | −3,120 [−4,749, −1,491] |
| QQQ | 4 | Warm | 791 → 786 | −6 [−192, 181] | 819 → 944 | 125 [−89, 340] |

**Primary counts were identical for every paired load**, including existing adjacent-history cache probes:

| Panels | Cache | Primary HTTP requests | Primary provider calls |
| --- | --- | ---: | ---: |
| 1 | Cold / partial | 3 | 1 |
| 1 | Warm | 2 | 0 |
| 4 | Cold / partial | 12 | 4 |
| 4 | Warm | 8 | 0 |

Supplementary HTTP requests through the primary loading phase were 1 with comparison Off (metrics), and respectively 5/3/2 for cold/partial/warm one-panel overlays or 17/11/5 for four-panel overlays. Supplementary provider calls during that phase were 0–2; every warm run made zero provider calls. These are phase counts, not total eventual supplementary traffic. Each enabled-overlay run subsequently waited for actual benchmark OHLC in every panel and asserted no comparison error or manual retry.

Validated areas include template round trips and stale saves, backup restoration, evidence deduplication, timestamp/calendar boundaries, gaps and splits in metrics, cache budgets, history regressions, linked OHLC, comparison/replay controls, mobile layouts, PNG exports and authenticated journal persistence. Browser pointer sweeps with comparisons off and SPY enabled assert no chart commits, storage writes or candle-layer repaints.

The synchronous OHLC controller benchmark recorded 10,000 updates: **0.10 ms p95**, 0.60 ms maximum, below the 1 ms p95 budget. These are measured browser results, not a guarantee for every device. The production loading machine uses Node 22.23.1, Chromium, an Intel Xeon W-1250 (6 cores/12 threads) and 31.7 GiB RAM. Local PostgreSQL database-size checks are a substantial, variable part of cold loads.

## Release

Vercel uses `scripts/vercel-build.mjs`. For production, it requires the existing `DATABASE_URL` and `DIRECT_URL`, applies committed Prisma migrations, runs the repository safety scan, then builds Next.js. A migration failure fails the deployment before promotion. Preview builds do not migrate the production database. No separate worker deployment is required.
