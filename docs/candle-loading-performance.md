# Candle loading, hourly preload and chart labels

This change targets the existing Alpaca SIP/raw workstation cache. It does not change the provider, schema, saved trade-view API or production environment. Deployment and production backfill remain separate release actions.

## Configuration and ranges

Set `TRADES_CHART_PROVIDER=alpaca`, `TRADES_ALPACA_DATA_FEED=sip` and `TRADES_CANDLE_CACHE_ENABLED=1`. Automatic preparation additionally requires `TRADES_CANDLE_PREPARE_ENABLED=1`. Existing Alpaca credentials, raw adjustment and configured provider delay still apply. No new environment variable is required.

For a short trade, the default initial request remains:

| Interval | Initial context | Preparation context |
| --- | --- | --- |
| 5m | Entry minus one day through exit plus one day | Existing context plus the full holding period |
| 1h | Ten days centered on the trade midpoint | Existing context and full holding period, extended to at least 30 calendar days before the final interpreted execution |
| 1d | 240 days centered on the trade midpoint | Existing context plus the full holding period |

`preloadHistoryRange` in `src/lib/workstation/history.ts` defines the shared preparation range. It falls back to `trade.closeTime` when no valid execution timestamp exists. UTC seconds define the 30-day duration; the background planner rounds outward to UTC days. The loader clips requests to the existing provider-delay cutoff and 15-minute cache batches. Successful empty sessions establish coverage, including weekends and holidays.

Default hourly initialization requests the existing visible context first, then fills additional context in windows of at most 14 days. Prepending history preserves the viewport. Saved views, timeframe changes that retain a visible context, and explicit date navigation keep their existing bounded requests. Explicit navigation cancels pending contextual preload. Replanning changes job ranges but reuses verified cache coverage; it downloads only missing or stale windows.

## Fetch behavior

Each fill takes the series lease before reading its authoritative snapshot. Compatible regular and extended 5m source lookups share a database query, retain separate identities and verified coverage, and reuse decoded results while aggregating market-open hourly candles. A successful fenced, atomic write supplies the response directly, avoiding a final full cache read.

Successful partial fills continue immediately. Contention, rate limits and failures retain their delays. Background jobs count failures rather than successful partial passes; progress resets their failure count. The existing provider slots, maximum two background workers, pagination checks, 100 MB cache / 400 MB database guards and 1 MB write reserve remain in force. Storage-paused bars remain temporary and never certify persistence.

Shared browser requests register each consumer. Closing or navigating one chart releases its consumer; the transport is aborted only after the last consumer leaves. Cancellation reaches provider queue waits, fetch downloads and response processing. Provider identity and pagination failures still prevent false coverage.

Optional cache timing metadata now includes `cacheReadMs` (including source-cache reads), `queueWaitMs`, `providerFetchMs` (through JSON download), `persistenceMs`, `storageCheckMs` and `providerRequestCount`. The corresponding `Server-Timing` entries are `cache`, `queue`, `provider`, `persist`, `storage`, plus total history time. Persistence includes its own mandatory storage check; `storage` measures the earlier growth check. Lease and other endpoint overhead remain part of total time.

## Device-local labels

The existing workstation preference document now contains a `chartLabels` map keyed by `chart-1` through `chart-4`. It migrates the legacy `labels` value into every slot, including compact and fully hidden modes. The map is independent of per-trade saved views.

Every chart header, including fullscreen, toggles its labels between full labels and compact markers. The shared toolbar and marker selectors control the active chart; the selectors retain fully hidden mode. Rendering, execution visibility, hit targets and PNG exports use the slot's mode. Closing a slot, switching trades/timeframes/layouts and reloading preserve its choice. Label changes do not request candles or save a review/view.

## Reproducible measurements

`scripts/benchmark-workstation-history.ts` requires the dedicated database `trade_journal_candle_benchmark_test` on loopback host `127.0.0.1`, port `55439`, matching `DATABASE_URL` / `DIRECT_URL`, and `ALLOW_TEST_DATABASE_MUTATIONS=1`. Apply existing migrations to that disposable database first. The script rejects other targets and external hosts. It uses deterministic September 2024 5m bars, a fixed 50 ms provider response delay, a 30-day regular-session hourly window and actual PostgreSQL queries. Cold has no cache, partial has 14 verified days and warm has all 30 verified days. Setup is excluded from the measurements.

Run `npx tsx scripts/benchmark-workstation-history.ts` against both the baseline commit `2c9d12f` and the local implementation, using the same script and isolated database sequentially. Each row reports history-state availability, complete coverage, transport requests, provider calls and Prisma query events. History-state availability is **not browser paint**. The transport benchmark bypasses Next.js/authentication/network overhead.

One complete before/after run on Windows with portable PostgreSQL 16.14:

| Scenario | First candles, before → after | Coverage, before → after | HTTP | Provider | DB queries, before → after |
| --- | --- | --- | --- | --- | --- |
| Cold | 12.403 s → 26.907 s | 44.777 s → 47.673 s | 4 → 4 | 3 → 3 | 193 → 69 |
| Partial | 0.072 s → 0.054 s | 21.993 s → 33.686 s | 3 → 3 | 2 → 2 | 132 → 50 |
| Warm | 0.032 s → 0.074 s | 0.032 s → 0.074 s | 1 → 1 | 0 → 0 | 2 → 2 |

All scenarios completed without resuming and returned the same 154 hourly bars. Cold/partial query counts fell by 64%/62%. These samples do **not** show a wall-clock speedup: local storage-size queries were slow and variable. An earlier baseline exceeded the 90-second history deadline, and regression runs under memory pressure exceeded the existing 20-second transaction limit. The affected cases passed individually after competing work finished. Database workloads run serially. No production latency claim follows from these measurements.

A follow-up pair after the builds and preview tests finished showed the same request counts and bar values:

| Scenario | First candles, before → after | Coverage, before → after | DB queries, before → after |
| --- | --- | --- | --- |
| Cold | 5.956 s → 2.527 s | 16.394 s → 14.986 s | 192 → 67 |
| Partial | 0.020 s → 0.037 s | 8.312 s → 11.964 s | 130 → 49 |
| Warm | 0.018 s → 0.011 s | 0.018 s → 0.012 s | 2 → 2 |

Warm history again made zero provider calls. Timing variation remains too large to infer a production speedup; the repeatable result is reduced database work and removal of the fixed continuation delay. Small query-count differences between runs reflect rate-slot polling.

For actual browser measurements, opt into `tests/workstation-auth/history-performance.spec.ts` with `WORKSTATION_HISTORY_BENCHMARK=1`. It uses the existing guarded browser database, frozen provider double, three cache scenarios and an identical saved 30-day range on both versions. Set `WORKSTATION_TEST_QUERY_LOG` on both the test server and test runner to an external log path to count server database queries, and label results with `WORKSTATION_BENCHMARK_VERSION`. The test attaches metrics per scenario. This benchmark clears synthetic candle fixtures and belongs only in the disposable browser database.

The existing `scripts/start-workstation-validation.ps1 -Cache` starts the prepared local build; `-Cache -Baseline` selects the prepared `baseline-build` directory under the same temporary validation root. Both enforce the isolated database and dummy provider credentials. The browser double adds a fixed 1,200 ms per provider response; its values are frozen/generated test fixtures, not live Alpaca data.

Measured Chromium navigation through usable chart rendering and server coverage:

| Scenario | First chart paint, before → after | Complete coverage, before → after | HTTP | Provider | Server DB queries, before → after |
| --- | --- | --- | --- | --- | --- |
| Cold | 17.304 s → 9.451 s | 63.030 s → 25.565 s | 6 → 6 | 3 → 3 | 338 → 206 |
| Partial | 2.577 s → 3.356 s | 14.057 s → 18.497 s | 5 → 5 | 2 → 2 | 289 → 204 |
| Warm | 2.537 s → 2.049 s | 2.060 s → 1.439 s | 3 → 3 | 0 → 0 | 156 → 150 |

Browser first-paint timing uses the chart's visible-data state as its readiness signal. Complete coverage is observed from the endpoint response and can precede rendering on a warm load. Counts include application/authentication reads and cache-only prefetch. These single-run results were collected on a shared workstation with variable memory/storage pressure; they are not production guarantees or a controlled hardware performance comparison.

## Validation results

- Workstation history, rendering and shortcut unit suite: 39 passed.
- Mocked provider/API suite: 76 passed.
- Isolated PostgreSQL cache suite: all 35 cases passed across the full run and focused reruns, including lease fencing, corrupt-cache recovery, pagination failure, storage limits, cancellation and immediate background progress. The companion label, execution-visibility, timestamp and post-response suites passed 25 cases.
- Authenticated browser checks: hourly 30-day preload with stable zoom and bounded saved-view restoration; three saved-view persistence/conflict/API cases; four cache/preparation/label-isolation/export cases passed. Label-only actions produced no candle or review/view requests.
- Preview browser checks: four passed, covering two-, three- and four-chart labels, fullscreen, slot reopening, reload, trade/timeframe switching, legacy migration and PNG generation.
- Application TypeScript, validation TypeScript, full lint, repository safety checks and the production webpack build passed. No schema or dependency files changed.

The browser suites use synthetic trades only. Export tests inspect the application's actual PNG blob and retain the download-event assertion: native Playwright file copying returned `EPERM` on this Windows host. The saved-view tests now drag to pan; a wheel zoom over the sparse frozen fixture can change logical bar spacing without changing its timestamp boundaries. A benchmark-created trade view is cleared before the cache navigation test, and storage-status tests wait for the actual response. These changes make the checks independent of fixture order and local storage latency.

## Deployment configuration

Production Vercel function and database regions were not verified: deployment/account access was unavailable. The repository's `vercel.json` defines cron schedules and a build command, with no region override; the workstation candle route retains `maxDuration = 300`. Verify the actual function region and database region together before attributing production latency to the code or changing deployment configuration. See [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region) and the [Alpaca stock-bars pagination contract](https://docs.alpaca.markets/us/reference/stockbars).
