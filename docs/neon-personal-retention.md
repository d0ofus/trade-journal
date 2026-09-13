# Personal-use retention on Neon

The workstation keeps historical candle chunks and verified coverage indefinitely. It does not evict exploratory history automatically. Automatic preparation covers **5m, 1h and 1d**, including the full holding period and default context. Other intervals and panned ranges are fetched on demand and saved under the existing provider/feed/adjustment/session identity.

The cache warns at 80 MB or 350 MB across databases on the Neon branch. Its existing 100 MB / 400 MB guards reserve 1 MB of write headroom. At either guard, background growth pauses. Foreground history can render temporarily with **Storage limit reached—this history was not saved**; it is never advertised as durable coverage and does not trigger persistence retry loops. This guard never gates journal or chart-view saves.

## Chart views

Migration `20260915000000_workstation_trade_views` adds `WorkstationTradeView`. Stable trade keys have independent revisions; no cascading materialization dependency or accounting changes are introduced. The authenticated `/api/closed-trades/[groupKey]/workstation/view` endpoint accepts small, versioned view documents. Navigation saves after one second of inactivity and flushes on trade/navigation changes. Failed and conflicting changes remain in browser storage. **Use saved chart view** explicitly resolves them by returning to the server copy.

Each view stores panel intervals, session mode, UTC ranges, arrangement and sizing. Replay does not overwrite the normal view. Saved ranges are restored without expanding the requested history window; **Fit trade** resets the context. Explicit date requests take precedence over restoration. Demo views are stored separately in the browser.

## Backups and screenshots

New application backups include saved views, review JSON, drawings, timestamp interpretations and screenshots. Workstation screenshots live inside `ClosedTradeNote.workstationJson`; legacy journal screenshots use `JournalChart` and the existing asset manifest. The export adds checksum metadata for inline workstation evidence without duplicating its image bytes. Cache tables/jobs are excluded; legacy `marketCandles` is exported as an empty compatibility array. Older backups can still restore their legacy candles and omit the new optional view table.

**Download & Verify** performs structural/reference/asset checksum checks. It does not restore a database and cannot prove that a browser download was retained on disk. Keep the downloaded file outside the repository. A nonblocking reminder appears when changes are unbacked and the last verified backup is more than seven days old (or absent); Later snoozes it for a week on that device. Review save protection also applies when following the reminder.

## Test resource cleanup

The maintenance scripts never load application environment files. Inventory and archives belong outside the repository. The exact inventory includes database and schema OIDs, table fingerprints, contents, dependency information and active sessions. Eligibility requires configuration review and successful isolated archive restoration. `neon-retention-cleanup.mjs` refuses unexpected identities, missing/changed archives and stale configuration checks. Schema removal locks and rechecks tables, uses RESTRICT rather than CASCADE, and rolls back for dependencies or drift. Database removal prevents new connections during its final inspection and never terminates an existing session. Ambiguous or active resources are skipped.

Database tests now read `.env.test.local`, not `.env`, default to local PostgreSQL and reject remote hosts even when the schema name contains `test`. Set both database URLs to the same isolated local target and `ALLOW_TEST_DATABASE_MUTATIONS=1`. Authenticated browser fixtures use the disposable local port 55439 database with UTC sessions; cache persistence tests also exercise a non-UTC database session.

## Rollout and recovery

Keep `TRADES_CANDLE_CACHE_ENABLED=1`. Leave automatic preparation disabled until the ten-trade pilot succeeds. The authenticated Market data action **Prepare 10 recent trades**, or `scripts/prepare-workstation-cache.mjs --pilot --usage-checked`, can run that bounded pilot while `TRADES_CANDLE_PREPARE_ENABLED=0`. Measure actual storage and provider requests, then enable preparation and queue the remaining three-interval backlog. Daily recovery and post-import callbacks remain independent of ingestion success.

SQL storage measures this branch's databases; Neon dashboard compute, transfer and other-branch usage must be tracked separately. No automatic upgrade, purchase, attachment quality reduction or user-data deletion is performed. If a rollout must be paused, disable preparation; saved candles, reviews and views remain available. Keep the additive view table during application rollback so saved views remain recoverable.
