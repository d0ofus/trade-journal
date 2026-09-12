# Cache-first chart history

This is an opt-in workstation cache. Ingestion parsers, materialization, execution records, accounting, timestamp interpretations, journals and the legacy `MarketCandle` consumers keep their existing behavior.

## Request flow

1. The application adapter checks bounded browser memory by symbol, interval, provider/feed/adjustment identity and session. Overlapping verified ranges are reusable across trades and panels.
2. `GET /api/workstation/candles?mode=cache` reads compact chunks and same-identity legacy rows. It never requests Alpaca or Yahoo. Legacy rows are partial data until a complete provider query establishes coverage.
3. The chart publishes these candles immediately. `mode=fill` fills one bounded uncovered window, merges it, and repeats when coverage indicates remaining gaps. A server lease coordinates overlapping requests; cached plots remain mounted. `mode=complete` retains the existing endpoint's default behavior and provides coverage metadata for continuations on unusually large requests.
4. Confirmed historical ranges require no upstream requests after reload. Only data in the latest seven calendar days is eligible for background revalidation after 15 minutes. Recent history advances in 15-minute batches behind SIP's configured delay, avoiding a new one-second cache miss on every selection. The effective cutoff is shown in history details; this is historical review, without live streaming. Users can explicitly refresh the current bounded window from chart history details.
5. Genuine pan/zoom gestures can request adjacent visible history plus a buffer. Initial fitting and chart resizing do not grant automatic fetch budget. After a chart loads, the next two visible trades are prefetched using cache-only requests.

Yahoo fallback remains separate. Once a chart contains Alpaca bars, failures preserve that identity and cached data. Prices and wicks are not clipped, rounded or inferred from execution prices.

## Storage and recovery

Migration `20260914000000_workstation_candle_cache` adds four tables: losslessly compressed OHLCV chunks, verified coverage segments, durable preparation jobs and distributed leases/rate slots. Intraday chunks cover UTC days; daily/weekly chunks use year containers. Checksummed Brotli payloads preserve the original JSON numeric values. Coverage and chunk updates commit together only after every provider page validates. A successful empty period is verified coverage. Expired request leases cannot commit stale writes.

The cache targets 100 MB, and background growth pauses near 400 MB combined database usage on the current PostgreSQL branch, with 1 MB headroom. Recovery can evict 200 least-recently-used exploratory chunks per pass; trade-window chunks remain protected. Deleting cache rows may not immediately reduce physical allocation, so growth stays paused when measured allocation is still high. Ingestion, reviews and attachments are never eviction candidates. These four regenerable tables are excluded from user-data backups and backup freshness.

Successful manual/Flex/scheduled import routes register a guarded Next.js `after()` callback after materialization. Failures cannot alter the import response. Jobs are persisted before provider downloads. Daily `/api/cron/candle-preparation` recovery at 09:00 UTC reconciles the current interpreted trade read model, including missed callbacks, and resumes expired jobs. Each invocation is bounded; it is not an always-running worker. Preparation includes all materialized, nonstale trades and all six intervals, including instruments classified OTHER. Holding periods and default context are unioned and overlapping ranges merged.

At most two background runners operate across instances. Shared database rate slots cap background API requests at 60/minute and all compact-cache requests at 120/minute, leaving allowance below Alpaca Basic's documented 200/minute for other consumers. Foreground demand pauses new background requests briefly. HTTP 429 imposes a shared cooldown; jobs use exponential backoff. Unsupported requests and exhausted retries appear in Settings → Trade data → Market data.

## Rollout

1. Run repository checks, isolated-database tests, and authenticated browser tests. Review the localhost preview.
2. Apply the additive migration to the production database with the standard migration procedure. Keep both flags at `0` during migration.
3. Set `TRADES_CANDLE_CACHE_ENABLED=1`, leave `TRADES_CANDLE_PREPARE_ENABLED=0`, and redeploy. Existing chart-only Alpaca SIP/raw credentials and Yahoo fallback configuration are reused. Check cache misses, warm reloads, provider identity, and chart state.
4. Check **Neon project Usage**, including other branches and compute/transfer budgets. SQL usage is only this branch. The planning estimate for all 391 trades/251 symbols is 60–80 MB, 2,000–2,500 requests and 45–90 minutes; measure a small batch before accepting that estimate.
5. Enable `TRADES_CANDLE_PREPARE_ENABLED=1` and redeploy after confirming headroom. Queue and run a bounded batch in Settings, inspect usage and progress, then resume. Daily recovery and post-import preparation now operate. No separate worker deployment is needed; both run in Vercel functions.
6. For a longer resumable run, set `WORKSTATION_ADMIN_URL` to the application origin and `WORKSTATION_ADMIN_TOKEN` to its `CRON_SECRET` in the runner environment. `node scripts/prepare-workstation-cache.mjs` is read-only status by default. Add `--queue --run --usage-checked` to prepare the backlog, or `--retry --run --usage-checked` after resolving provider failures. No secrets are printed or supplied on the command line. The runner stops when paused, out of immediately runnable work, or at its batch limit.

Rollback: disable background preparation first, then the compact-cache flag. The prior chart path remains available; new tables can remain in place. Do not reverse the migration or delete historical application records to roll back this cache.

## Local acceptance evidence

- Production build, application TypeScript (`tsconfig.build.json`), workstation validation TypeScript, targeted ESLint, repository safety scan and whitespace checks passed.
- 116 isolated backend/regression tests, 76 mocked provider/endpoint tests, 34 workstation/history tests and 11 authenticated browser tests passed. Coverage includes lossless round trips, all eight MU fills, missing/empty ranges, pagination failure, expired leases, storage guards, provider outages, import callback failure isolation, reloads, resizing, replay, exports and review conflicts.
- The final local browser run measured 361 ms for warm trade selection, 630 ms for a warm full-page reload, and 3.5 ms for the database cache read (16 ms endpoint round trip). Cached selection/reload, resize/Fit and multichart replay/export made zero upstream requests. These are individual local observations, not production latency guarantees.
- Desktop, laptop and mobile captures in both themes, partial loading and PNG export are in `screenshots/cache-first-history/`. The authenticated localhost preview uses only the isolated database, frozen MU candles and synthetic demo symbols. External provider traffic is intercepted by an explicitly guarded test double.
- The unscoped root `tsc --noEmit` also includes legacy test suites and reports test-typing errors outside this change. The existing production type-check configuration and the affected workstation test configuration both pass.

Production migrations, feature flags and backlog preparation have not been applied by this local implementation. Live Alpaca/Vercel/Neon timings, cold starts, project-level quotas and actual preload growth remain rollout checks. The first production batch must be observed before starting the full backlog.

References: [Alpaca market data limits](https://docs.alpaca.markets/us/docs/about-market-data-api), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [Neon pricing](https://neon.com/pricing), [Vercel cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing).
