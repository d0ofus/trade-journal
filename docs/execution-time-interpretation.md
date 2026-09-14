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

Report-specific confirmations take precedence over account defaults, including disabled report exceptions. The supported zones are `America/New_York` and `UTC`. Compact IBKR timestamps and ISO timestamps with second precision are supported. Explicit ISO offsets remain authoritative. Daylight-saving gaps/folds, source conflicts and non-unique source matches remain unresolved. Interactive inspection is capped at 16 MB / 20,000 executions per batch and displays at most 200 preview rows, with full eligible/unresolved counts.

The shared workstation adapter applies the interpretation once. Chart markers, execution details/list, history requests, Fit trade, date navigation, replay, displayed opening/closing times, and review exports use the resulting UTC time. A version change invalidates chart history and refreshes open workstations in other tabs. If browser storage is disabled, reload those tabs explicitly.

Trade IDs, journal links, original execution rows, prices, quantities, materialized trade grouping, P&L, server date filters, accounting dates, and legacy analytics retain their existing meanings. No drawing coordinates or existing screenshot bytes are shifted. Attachments record the timestamp basis used when captured; older attachments are identified separately. CSV/Markdown exports distinguish broker trade date and workstation UTC time, including partially confirmed trades. ZIP manifest version 2 and review JSON carry detailed provenance.

Production uses Alpaca SIP with raw prices. Session mode and interpretation version are part of workstation request keys. Provider/adjustment metadata and unavailable-history warnings remain visible. Confirming the time does not assert that every fill must lie within OHLC; missing-candle and price-mismatch diagnostics remain independent.

## Verification

- Frozen Yahoo regression: **1/8** MU fills match at original stored times; **8/8** match after user-confirmed Eastern interpretation.
- The 6-share MU sell remains **1008.71**, at **2026-09-08 19:09:25 UTC**, in the **19:05–19:10 UTC** candle with low/high **1008.00 / 1012.1972**.
- Read-only inspection of the actual archived MU source matched all eight execution rows; no production rows were written.
- Summer/winter offsets, midnight crossing, explicit UTC/offsets, DST ambiguity and invalid times, repeat confirmation, stale source/timestamp rejection, simultaneous confirm/disable, rollback, and unverified batches are covered.
- Isolated database assertions preserve original executions, materialized trades, review text, drawing anchors, and older evidence through confirmation and rollback. Existing ingestion parity checks remain idempotent: 7 fixture executions, 3 completed trades, 1 open position, with the review surviving refreshes.
- Application and validation TypeScript checks, targeted lint, repository safety checks, and the production build pass. The application check excludes the repository's pre-existing test-typing failures in the unrestricted root TypeScript configuration.
- Relevant suites: 67 unit/database tests, 69 mocked provider/API tests, 30 workstation/history/shortcut tests, 30 mock-preview browser tests, and 7 authenticated browser tests. Database tests run only against isolated local test databases.

## Production rollout

### Confirmed Flex New York account mode (September 2026)

Settings → Account timestamp defaults offers `verified-reports` and `confirmed-flex-new-york`. The latter records the user's confirmation that offsetless Flex clock fields use `America/New_York`. It follows MU: stored `2026-09-04T08:28:27Z` plots at `12:28:27 UTC`; `09:32:47Z` and `09:32:48Z` plot at `13:32:47 UTC` and `13:32:48 UTC`. Winter uses the five-hour offset. Explicit offsets are preserved.

Archived rows still pass source and execution matching. Legacy Flex/execution imports without archives reconstruct the clock fields from the original stored value, never from an already interpreted value. These applications have `user-confirmed` provenance and display **New York time — user-confirmed**. Missing documentary evidence is not called independent verification. Actual source conflicts and ambiguous/nonexistent DST times remain unresolved with reasons. The same account mode applies to future imports through the existing preparation callback.

The existing policy `basis`, revision and application fields store this mode; **no new migration or environment variable is required**. `GET /api/workstation/timestamp-interpretations?accountId=…&mode=confirmed-flex-new-york` previews the selection. The session-authenticated PATCH `confirm-account` includes the same mode, expected revision and preview fingerprint. `prepare-account` resumes the bounded ledger. Disabling/revising the account policy reverses its chart overlay; report-specific exceptions retain precedence.

Deploy the tested commit to Vercel, record a read-only baseline and privately preserve the previous policy metadata, then activate the approved mode. Replan candle preparation with `{ "action": "plan", "recheck": true }` and run bounded worker calls. Rechecking completed jobs reuses verified matching coverage and repairs only gaps or eligible recent refreshes. Existing caches, review views, drawings and device-local chart labels remain intact. Auto session follows resolved times; explicit saved session selection remains authoritative. Options are excluded from automatic preparation, including OCC symbols imported as OTHER.

Use `node --env-file=.env --import tsx scripts/audit-workstation-preload.mjs --as-of=<ISO cutoff> --output=artifacts/<private-name>.json` before and after the run with the same cutoff. `--delay=900` and Alpaca SIP/raw identity are the defaults; pass deployed settings explicitly if different. The script runs a repeatable-read, read-only transaction, verifies checksums and bounded coverage directly, and never touches cache access timestamps. It reports complete/partial/unavailable by interval, valid empty coverage, corrupt chunks, option exclusions, branch storage, execution provenance and fingerprints of accounting/review/view tables. Private row-level reports are gitignored. SQL usage covers the current PostgreSQL branch, not Neon project-wide compute, transfer or other branches.

The following paragraphs describe the original per-report release and its already-applied migration.

Validation for the account-mode release: 67 affected unit/isolated PostgreSQL tests, 39 workstation/history tests, 76 provider tests, three runner continuation tests, and eight authenticated browser scenarios passed. Browser coverage includes legacy confirmation, live confirmation/disable with viewport preservation, markers and PNG export, saved-view persistence/conflicts, and the bounded 30-day hourly preload. Application and validation TypeScript, lint, repository safety and a production webpack build passed. The database/browser suites used disposable loopback PostgreSQL and frozen or synthetic provider responses; these are not production latency measurements.

Take a current backup, apply the additive migration `20260913000000_execution_time_interpretation` before starting code that reads the new table, then deploy the reviewed branch. Backup/restore includes the new table and still accepts older backups without it.

In production Settings, preview and confirm the batches or account policy whose source timezone the user has confirmed. Do not infer a timezone from price matches. Check MU and its premarket opening fill in the deployed workstation. Disabling an interpretation restores its prior displayed timestamps; ingestion does not need to be re-run. The existing Vercel application supplies scheduled Flex-import and candle-preparation functions. No separate worker service is needed. Keep the existing provider, authentication, database and ingestion settings.
