# Workstation execution-time interpretation

Implemented on `feat/execution-time-interpretation` and approved for release to `main`. Timestamp interpretation changes workstation presentation through separate metadata; ingestion and original execution records remain unchanged.

## Review locally

- Corrected MU example: <http://localhost:3000/preview/trades?scenario=execution-timing>
- Original timestamps: <http://localhost:3000/preview/trades?scenario=execution-timing&interpretation=original>
- Authenticated Settings demo: <http://127.0.0.1:3101/settings#timestamp-interpretation>
- Local Settings credentials: `phase2-reviewer` / `phase2-local-test-only`. These public synthetic credentials work only in the disposable local validation server.

In the MU chart, open **Coverage / chart history** and select **SELL 6 @ 1008.71**. The corrected execution details show the stored timestamp, broker wall time, interpreted UTC time, candle interval, provider, and price range. Select **Regular hours**, **Extended hours**, or **Auto** in the toolbar. Auto includes extended hours when a confirmed execution requires them.

The chart preview uses sanitized execution identifiers and a frozen public Yahoo five-minute snapshot for 4–10 September 2026. It does not query the application database. Higher intervals in this fixture aggregate those bars; history outside that fixture is unavailable. Demo fees are zero, so its illustrative P&L is not the production net P&L. The normal preview retains its other synthetic trades.

The Settings demo uses the isolated `trades_workstation_auth_test` database on loopback port 55439. Preview the `DEMO-timestamp-review.csv` batch, confirm US Eastern, and use **Disable** to roll back. The validation server blocks outgoing market-data requests; use the port-3000 preview to interact with charts. Authenticated browser tests supply the frozen candles through a browser request mock.

Screenshots are in the gitignored `screenshots/timestamp-interpretation/` directory: before/after, desktop/laptop/mobile in both themes, and the confirmed Settings panel.

## What changes

`ExecutionTimeInterpretation` is a separate, additive table associated with an import batch. It records the source artifact SHA-256, parser version, execution IDs, original timestamps, broker wall times, interpreted UTC timestamps, source timezone, confirmation basis, normalizer version, and revision. Confirmation is explicitly **user-confirmed**, not documentary broker verification.

The archived CSV is inspected independently. A row must match account, symbol, side, quantity, price, stored timestamp, and the canonical broker execution identity where available. No importer is called. Preview and confirmation compare a fingerprint and revision; confirmation and disabling share a transaction-level lock. A stale source hash, parser version, stored timestamp, or execution value prevents applying that interpretation.

Only reviewed batches are affected. New imports remain unverified until separately confirmed. The initial supported zones are `America/New_York` and `UTC`. Compact IBKR timestamps and ISO timestamps with second precision are supported. Explicit ISO offsets remain authoritative. Daylight-saving gaps/folds, unsupported formats, missing artifacts, and non-unique source matches remain unresolved rather than being guessed. Legacy execution identities that cannot be matched securely may remain unresolved. Interactive inspection is capped at 16 MB / 20,000 executions per batch and displays at most 200 preview rows, with full eligible/unresolved counts.

The shared workstation adapter applies the interpretation once. Chart markers, execution details/list, history requests, Fit trade, date navigation, replay, displayed opening/closing times, and review exports use the resulting UTC time. A version change invalidates chart history and refreshes open workstations in other tabs. If browser storage is disabled, reload those tabs explicitly.

Trade IDs, journal links, original execution rows, prices, quantities, materialized trade grouping, P&L, server date filters, accounting dates, and legacy analytics retain their existing meanings. No drawing coordinates or existing screenshot bytes are shifted. Attachments record the timestamp basis used when captured; older attachments are identified separately. CSV/Markdown exports distinguish broker trade date and workstation UTC time, including partially confirmed trades. ZIP manifest version 2 and review JSON carry detailed provenance.

Yahoo remains the current provider. Extended-hours workstation requests use `includePrePost=true` and do not reuse the shared regular-session candle cache. Session mode and interpretation version are part of workstation cache keys. Provider/adjustment metadata and unavailable-history warnings remain visible. This does not extend Yahoo's intraday retention or assert that every fill must lie within OHLC. Alpaca verification still requires valid credentials and is independent of this timing correction.

## Verification

- Frozen Yahoo regression: **1/8** MU fills match at original stored times; **8/8** match after user-confirmed Eastern interpretation.
- The 6-share MU sell remains **1008.71**, at **2026-09-08 19:09:25 UTC**, in the **19:05–19:10 UTC** candle with low/high **1008.00 / 1012.1972**.
- Read-only inspection of the actual archived MU source matched all eight execution rows; no production rows were written.
- Summer/winter offsets, midnight crossing, explicit UTC/offsets, DST ambiguity and invalid times, repeat confirmation, stale source/timestamp rejection, simultaneous confirm/disable, rollback, and unverified batches are covered.
- Isolated database assertions preserve original executions, materialized trades, review text, drawing anchors, and older evidence through confirmation and rollback. Existing ingestion parity checks remain idempotent: 7 fixture executions, 3 completed trades, 1 open position, with the review surviving refreshes.
- Application and validation TypeScript checks, targeted lint, repository safety checks, and the production build pass. The application check excludes the repository's pre-existing test-typing failures in the unrestricted root TypeScript configuration.
- Relevant suites: 67 unit/database tests, 69 mocked provider/API tests, 30 workstation/history/shortcut tests, 30 mock-preview browser tests, and 7 authenticated browser tests. Database tests run only against isolated local test databases.

## Production rollout

Take a current backup, apply the additive migration `20260913000000_execution_time_interpretation` before starting code that reads the new table, then deploy the reviewed branch. Backup/restore includes the new table and still accepts older backups without it.

In production Settings, preview and confirm only the actual batches whose source timezone has been confirmed. Do not apply a global offset or infer a source timezone from price matches. Check the MU example and its premarket opening fill in the deployed workstation. Disable a batch interpretation to restore original displayed timestamps; ingestion does not need to be stopped or re-run. This release uses the existing Vercel application and its scheduled Flex-import function. No separate worker service or worker schema migration is needed. Keep Yahoo and the existing authentication, database, and ingestion environment settings unchanged.
