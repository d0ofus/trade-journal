# Phase two validation — 2026-09-11

Branch: `feat/trades-workstation-revamp`. The user approved merging to GitHub main on 2026-09-11, retaining the existing production candle provider and deferring Alpaca configuration. Local and authenticated-browser verification is complete. The release uses `TRADES_CHART_PROVIDER=legacy`; chart-only Alpaca settings are ignored in this mode. Ingestion, broker trading connections, cron, and outcome provider selection remain unchanged.

## Approved release preflight

The production migration ledger contained exactly the 24 migrations on main, with matching SQL checksums and no incomplete entries. `SHOW TIMEZONE` returned `GMT` (UTC). The only pending migration was `20260911090000_trade_workstation_review`.

Applied that migration before the main deployment. A before/after fingerprint of all six existing reviews, excluding the two new columns, was identical. Production now has the additive schema required by the generated Prisma client; no review content or ingestion data was rewritten.

Set only `TRADES_WORKSTATION_ENABLED=1` and `TRADES_CHART_PROVIDER=legacy` in the existing Vercel project's Production environment. They take effect on the next deployment. No Alpaca, authentication, database, Flex, cron, or outcome settings were changed. Rollback should retain the additive columns; previously migrated reviews remain protected from legacy edits.

The release regression run passed **505 tests across 72 Vitest files**, including two additional checks that default/explicit legacy mode ignores deferred chart-only Alpaca settings and returns the existing loader's output. `vitest.config.ts` excludes the three `node:test` suites, which run separately with `npm run test:workstation`.

## Verified locally

- Applied the 24 migrations from synchronized main to a new PostgreSQL 16.14 database, created a legacy review, then applied the additive workstation migration. Every previous review field and timestamp remained identical. New fields defaulted to `null` / `0`.
- Full Vitest suite: **503 passed, zero skipped**, re-run with UTC database sessions after the quantity-mapping correction. These include mocked provider/API tests and real database import, accounting, materialization, locking, journal, backup, and display-mapping tests.
- **30 workstation unit tests**, **14 Chromium mock-preview browser tests**, and **3 authenticated Chromium browser tests** passed. The authenticated tests use the actual production build and disposable PostgreSQL data, including synthetic cached candles.
- Main and branch ran the same synthetic CSV/Flex import fixtures in separate databases, then repeated the comparison in fresh `phase2_utc_test` schemas with UTC sessions. JSON outputs matched byte for byte: **7 executions, 3 closed trades (including a short with scale-outs), 1 nonzero position**, fees, P&L, analytics, and repeat-import results. Explicit timestamp checks matched the source fixture. Reimport and both materialization refreshes preserved the workstation review and its single journal link.
- A fresh Turbopack production build passed compilation, strict application TypeScript, generated route checking, and static page generation, including a rebuild after correcting quantity mapping. The build used a separate folder to preserve the running mock preview. Application checks use `tsconfig.build.json`; the repository's pre-existing broad test-type errors are not claimed resolved. New phase-two scripts, persistence tests, and browser tests pass `tsconfig.workstation-validation.json`.
- Targeted ESLint, repository safety scanning and `git diff --check` passed. The preview remains at http://localhost:3000/preview/trades.

The regression fixture database and browser fixture database are separate. An initial run containing the ingestion parity fixture exposed a pre-existing exact floating-point assertion in cumulative-P&L testing; the complete suite passed against a fresh database. An initial build-copy junction was rejected by Turbopack; dependencies were then hardlinked inside the build root and the standard build passed.

## Fixes made during validation

- Both workstation review API methods now require authentication **and** the feature flag.
- Review saves compare the note revision, note timestamp, and linked journal timestamp. A compare-and-swap journal update rolls back the complete save if a competing edit wins. Draft recovery tracks the journal token too.
- Workstation saves preserve outcome reasons/calculation data, risk plans, journal-only fields, original annotations (including unsupported tools), and the original journal archive. The archive remains server-owned.
- Legacy review and linked journal writers check migration state under the same closed-trade row lock. Already migrated reviews remain read-only through the legacy editors if the feature flag is turned off; standalone historical journal entries remain editable. A rollback must retain the additive columns. Re-enabling the workstation restores editing; a true reverse migration would require a separate reviewed conversion.
- Saves enforce a **4 MB UTF-8 package limit**, with a client-side check and a recoverable local draft. This leaves headroom under [Vercel's 4.5 MB request/response limit](https://vercel.com/docs/functions/limitations#request-body-size). High-resolution image downloads remain available. Larger collections of attached chart images will need separate object-storage uploads before this cap can be removed.
- The CommonJS demo seed now uses `require` consistently for TSX-loaded TypeScript helpers; its previous dynamic imports returned unusable module namespaces under Node 22. Its safety checks, fixtures and ingestion/materialization calls are preserved.
- The authenticated adapter now displays `ClosedTrade.totalQuantity` as trade size. `openingQuantity` and `closingQuantity` are signed account-position baselines, which previously caused zero/incorrect quantities and false partially-open statuses. Existing materialized rows represent completed trade cycles; the mock adapter continues to demonstrate partial trades independently. Tests cover a flat-start long, a long cycle alongside a carry position, and a liquidated short carry.
- The disposable PostgreSQL installation initially inherited `Australia/Sydney`. Existing raw-SQL materialization under that session timezone shifted its timestamp-without-timezone values. The four disposable databases now default to UTC; the browser fixtures were reseeded and the parity comparison repeated in fresh UTC schemas. No ingestion code was changed. The subsequent production release preflight confirmed `GMT` (UTC).

## Authenticated browser validation

All three tests in `tests/workstation-auth/persistence.spec.ts` passed: real login and production mock-route denial; PostgreSQL autosave, drawings/evidence reload and canonical journal navigation; and second-tab conflict/draft export/recovery. The fixture setup also checks that materialized trade boundaries match the first/last execution timestamps, and the UI quantity matches the stored closed-trade quantity. The final production build was used for the passing run.

The guarded launch succeeded when this phase resumed. A Windows ESM import-path issue in the launcher was corrected to use a file URL; failed process exits are now propagated. Initial test-selector mismatches were corrected to target the existing login placeholders and journal save-status area. An authenticated screenshot is saved at `screenshots/workstation-phase-two-2026-09-11/authenticated-review.png` (synthetic database data).

The prepared scratch build is `%TEMP%\trade-workstation-phase2\build`. The disposable PostgreSQL cluster is running at `127.0.0.1:55439`; databases are `trades_workstation_test` (migration/parity), `trades_baseline_test` (main comparison), `trades_regression_test`, and `trades_workstation_auth_test` (seeded browser fixtures). These names are hard-gated by the relevant harnesses. They contain synthetic data only.

To launch the reviewable test server manually in a dedicated PowerShell terminal, use Node 22:

```powershell
. "$env:TEMP\trade-workstation-phase2\browser-test-env.ps1"
.\scripts\start-workstation-validation.ps1 -NodePath (Get-Command node).Source
```

The script binds only to `127.0.0.1:3101`, uses the isolated browser database and demo-only writes, and blocks external provider HTTP. It does not load `.env.local`. Its public synthetic login is `phase2-reviewer` / `phase2-local-test-only`; these values must never be used in Vercel. Stop it with Ctrl+C after testing. The prepared build is a snapshot; later application edits require a new build copy.

In another terminal with Node 22 on PATH:

```powershell
. "$env:TEMP\trade-workstation-phase2\browser-test-env.ps1"
npm run test:workstation:auth
```

## Deferred Alpaca verification

The user supplied chart-specific credentials in `.env.local`. The live SIP history probe returned **HTTP 401** before any history or cache write. A separate tiny historical IEX probe also returned **HTTP 401**. Both configured variables came from the local file, each appeared once, and checks found no outer whitespace or placeholder/masked values. No key or secret was logged. The matching key pair needs confirmation/correction in the Alpaca dashboard before retrying; the responses do not establish historical or real-time data entitlement. Both regular live and paper accounts use `data.alpaca.markets` for market data according to [Alpaca authentication documentation](https://docs.alpaca.markets/us/docs/authentication).

A separate live Yahoo MSFT 5m request returned **312 bars** and the expected `workstation:v1:yahoo:unverified` identity. This confirms recent Yahoo availability only; it does not provide two-year 5m history or validate Alpaca fallback under a real outage.

No Alpaca credentials are required for this release. A later provider rollout can configure the chart-only variables in Vercel and repeat the live validation with a matching key pair. Do not add global `ALPACA_*` or browser-exposed `NEXT_PUBLIC_*` credentials. See the [provider configuration](./trades-workstation-preview.md#isolated-chart-provider-configuration) for the opt-in interface.

Alpaca documents historical SIP availability when the request end is at least 15 minutes old. The 900-second delay is the conservative initial setting, not a claim about this account's real-time entitlement. Raw candles retain the execution price basis; adjusted execution/drawing coordinates remain a separate future implementation.

`npm run verify:workstation:alpaca` is a dry run by default and has passed. With `-- --live`, the harness requires the disposable `trades_workstation_test` database and explicit test mutation opt-in. It makes only market-data reads and writes namespaced candles to that local test database. It checks a small historical authentication probe, two years of AAPL 5m data in bounded pages, ordering/OHLC validation, regular-session gaps, durable cache rows, repeat-cache behavior, and separate recent Yahoo availability. It never calls account/order/trading APIs and never logs keys or raw provider response bodies. The live run stopped at HTTP 401; no two-year Alpaca coverage or live cache result is claimed. Real-time SIP entitlement and live provider outage behavior are not certified; outage/fallback paths have mocked tests.

The user's revised release sequence supersedes the earlier Alpaca prerequisite: merge the verified workstation with the existing provider first, then configure and validate Alpaca in a separate phase. Yahoo's existing intraday retention limits still apply; this release does not claim two-year live 5m coverage.
