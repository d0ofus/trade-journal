# Completed-trade reporting and release procedure

The dashboard uses completed materialized trade cycles from the same history as `/trades`. Its cohort is the configured `REPORTING_ACCOUNT_CODE`, filtered by interpreted final closing date in `America/New_York`. Other genuine accounts remain intact and appear as outside the current reporting scope. Open cycles, their partial exits and their charges never enter dashboard performance. Entries before the selected range remain part of a qualifying completed trade's economics.

## Accounting changes

- Calculation version: `2026-09-27.closed-v2`.
- Forward migration adds contract multiplier, provenance, effective instrument class, broker contract ID and separate transaction tax. Instrument IDs and existing classifications are retained.
- Archived broker multipliers take precedence. Identified legacy options use the approved 100-times assumption, recorded in `multiplierSource`.
- Strong archived execution identities recover taxes and commission components. Unavailable historical taxes are not invented. The current archive matches 162 executions; it does not establish complete historical tax coverage.
- Opening inventory comes from an earlier statement date. Same-day closing snapshots cannot seed that day's opening inventory.
- Gross P&L includes the contract multiplier. Net P&L subtracts allocated commission, fees and transaction tax exactly once.
- Repairs compare every genuine trade key, execution allocation, price, quantity and timestamp before any writes. Monetary fields and opening/closing baseline metadata update in place. Unexpected identity or allocation changes roll back the transaction.
- A preservation hash covers genuine records and review relationships, excluding explicitly permitted accounting metadata and regenerable analytics. Machine rounding of regenerated allocation quantities is tolerated within four floating-point ULPs, but the stored quantities are never rewritten.

For the September 2026 snapshot, the approved reporting scope reconciles to 402 total completed trades and 189 YTD trades: gross **-$18,463.51**, costs **$665.28**, net **-$19,128.79**. The September IBIT put is **$99 gross**, **$93.74284258 net**. These totals depend on the documented legacy-option assumption and available archived charges.

## Dashboard definitions

Both cumulative series start at a separate zero opening point. Daily totals preserve the first day's actual result. Drawdown is a decline in cumulative completed-trade net dollars, not account-equity drawdown. Simultaneous closes are combined before drawdown calculation.

Quantity closed is counted once and divided by active closing days, with shares and contracts separate. Holding times and entry-time buckets use interpreted timestamps; unknown carried entries are excluded from duration/time samples. The UI shows sample sizes, period dates, definitions and import freshness.

Additional reports include entry weekday by 30-minute New York time, dollar drawdown and elapsed recovery, payoff, streaks, daily consistency, best/worst days, rolling 20-trade net performance, symbol/direction/class/holding breakdowns, completed-trade cost drag and positive-profit concentration. Empty or undefined ratios are nullable.

Sharpe, Sortino and Calmar remain unavailable: genuine equity and cash-flow-adjusted return history are absent. [IBKR risk reporting](https://www.ibkrguides.com/reportingreference/reportguide/riskmeasures.htm) uses time-weighted returns for its risk measures. [Sharpe's discussion](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm) defines a return-based measure. [Tradervue's days/times reports](https://app.tradervue.com/help/reports_dt) group closed trades by entry time in US Eastern time.

## Compatibility and cleanup

Ordinary `/trades` URLs retain their existing date semantics. Dashboard links explicitly add `reportingTimezone=America/New_York`; entry heatmap links also carry their weekday and half-hour bucket. Both page modes show the reporting basis. Raw execution history remains accessible, including open-position fills.

The workstation read path remains free of materialization, dashboard aggregation and market-provider requests. The release regression checks also cover persistence, conflicts, recovery, evidence, layouts, drawings, sessions, replay, exports and mocked Notion publishing. Browser fixtures use disposable local databases and local object-transport mocks.

Cleanup uses exact known synthetic account identities and seed provenance. Its private manifest lists primary keys and explicitly handles trade-keyed references. Shared journals, playbooks, instruments, assets and backup pins are retained. The rehearsed deletion includes seven synthetic accounts, 13 positions and 7,960 synthetic cached candles. All 53 existing evidence originals were retained and backed up.

Positions use broker contract identity and dated snapshots plus subsequent fills. Omission from a partial report is not proof of closure. Older unresolved holdings show their evidence date. Position reconciliation does not rewrite genuine stored positions or add them to dashboard performance.

## Operator procedure

1. Take a PostgreSQL custom-format dump, a private row inventory and checksummed evidence originals. Restore the dump into a disposable database and verify preservation, accounting, cleanup and idempotence there. Keep manifests and original assets outside Git and deployment uploads.
2. Apply `20260927090000_accounting_metadata` to the rehearsal database. Configure `DATABASE_URL`, `DIRECT_URL` and `REPORTING_ACCOUNT_CODE` explicitly.
3. Generate a private dry run with `npx tsx scripts/dashboard-maintenance.ts --out <private-plan.json>`. Compare it with the rehearsed manifest. The command is read-only unless `--apply` is supplied.
4. Apply the reviewed manifest with `--apply --manifest-hash <rehearsed-hash> --backup-manifest <backup-manifest.json> --out <private-applied.json>`. The command checks the tested dump checksum and rejects a changed manifest. Save the before/after preservation hashes.
5. Refresh execution analytics using `refreshMaterializedExecutionAnalytics()`, then call it with `skipIfFresh: true` to confirm no further refresh. Repeat the maintenance dry run: all deletion and update lists must be empty.
6. Run accounting tests, compatibility/browser gates and production build before release. Production builds apply additive migrations through the existing `scripts/vercel-build.mjs`. Set `REPORTING_ACCOUNT_CODE` in the deployment environment. Deploy the new code before running the production accounting repair, so older materialization code cannot overwrite corrected economics. The dashboard shows a reconciliation status until execution metadata is ready.
7. Verify the live totals, cohort drilldowns, account/position scope and synthetic-record absence. Do not republish external Notion pages. Retain the dump, asset checksums, deletion manifest, applied report and verification results for rollback.

Rollback requires restoring the tested database backup with compatible application code; do not restore old code against corrected accounting materializations and let it rebuild them. Reconcile any writes after the backup before restoring. This is an operator decision, not an automatic destructive rollback.
