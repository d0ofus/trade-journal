# TODO

## Workstation Uplift Tracker
Branch: `workstation-uplift`
Last checkpoint: 2026-07-22

### Review-Gated Iteration Protocol
- Start each resumed work session with a checkpoint report.
- Run one focused iteration at a time.
- After each iteration, record what changed, what was verified, and what needs localhost review.
- Pause for product review before continuing to the next package.

### Current Readiness Matrix
| Area | Current State | Next Review Target | Status |
| --- | --- | --- | --- |
| Data safety core | Non-destructive closed-trade refresh, stale materialization handling, schema-scoped global execution-analytics serialization, atomically matched analytics watermarks, account-serialized position imports, and configured-schema-qualified closed-trade review locks are implemented with tests. | Re-run reconciliation scenarios only when the import identity, lifecycle contract, materialization inputs, or database schema target changes. | Mostly done |
| Auth and import durability | Route-level mutation auth, import lifecycle metadata, raw artifacts, row errors, account-serialized full/partial position snapshots, strict dates, canonical IBKR assets, per-fill execution identity, exact-retry idempotency, charge-only corrections, atomic cohorts, durable parent/section provenance, persisted direct/rollback roles, conserved row dispositions, explicit Flex commission outcomes, complete cohort-safe history pagination, and shared multipart/Flex post-import failure recovery are implemented. | Review `Rows applied` and `Processing failed` lifecycle presentation on `/import` and `/settings`, then review the grouped Flex, failed, and legacy history records. | Active review |
| Metrics and ledger trust | Closed-trade-first dashboard metrics, calendar realized P&L, execution drill-down, carry-in basis preservation, aligned gross/net cumulative baselines, strict UTC date-only filtering, UTC day/Monday-week/month/year periods, and deterministic demo reconciliation are verified. | Review dashboard/trades/calendar agreement for June 18 and June 17-22 on localhost. | Verified |
| Chart workstation | Saved layouts, durable annotations, cancellation-safe shared requests, retained chart paint, execution overlays, exact 5m-to-15m derivation, source provenance, and the 5m/1h/1d `1+2` review workspace are implemented. Phase 12 prevents delayed range writes and unfinished trends from crossing chart contexts and rejects invalid primary symbols. | Review `/trades?account=DEMO-WORKSTATION` on localhost for rapid 5M -> 15M -> 1H -> 15M transitions, DEMOA -> DEMOC -> DEMOA changes, nonblank retained charts, comparison add/remove, Focus/Show all, saved ranges after reload, and overall pan/zoom feel. | Active review |
| Journaling workflow | Structured reviews, review queues, tags, journal bridge, dirty/in-flight guards, resumable selected-trade URLs, conflict-safe chart/journal flows, and keyboard review navigation are implemented. Phase 11 adds guarded sidebar/filter/history navigation, authoritative group-key source links, row-lock-safe closed-trade journal creation, keyboard-reachable chart range selection, live status semantics, and accessible delete controls. | Review dirty sidebar/filter/Back navigation, keyboard range selection on Capture, source-trade round trips, Save & Next URL persistence, and the existing save/delete/chart conflict states. | Active review |
| Backup and health | Verified backup download, durable backup audit history, snapshot-consistent source metadata, expanded timestamped-table freshness coverage, required source-signature verification, source/table row-count binding, restore dry-run validation, readiness generation, readable verify-failure handling, table-manifest warning counts, storage sizing, decoded screenshot bytes, import artifact growth, stale-trade health, automatic settings refresh after verification, persistent latest verified SHA/size tiles, and deterministic browser coverage for Needs Backup -> Current are implemented. | Review `/settings` backup freshness: it should show Needs Backup before verification, then Current after Download & Verify without a manual reload. | Active review |
| Repository safety | Phase 16 sanitizes the current tree. Phase 17 added the redacted all-object scanner and was packaged locally as unpushed `4b1fef7`. Phase 18 now has a fail-closed cutover preflight, verified no-hardlink Phase 17 candidate, complete bundles, clean fresh clone, and redacted readiness evidence. Source and remotes remain unrevised. | Review `docs/history-purge-readiness.md` and approve only Phase 18 packaging; Phase 19 remains on HOLD for branch mapping, owner, freeze, ecosystem, communication, and rollback decisions. | Phase 18 verified; packaging approval required |
| Full product QA | The Phase 18 fresh candidate and source package pass 469 unit tests with 5 intentional skips, lint, build, and all 59 Chromium tests against the isolated Phase 18 database. Release-security, real history rewrite, production migration, backup custody, and rollback gates remain open. | User review on `localhost:3000`, led by import lifecycle history, settings health, dashboard metrics, and the closed-trade chart workstation, then resolve every Phase 19 HOLD item. | Candidate verified; product remains Phase 16 |

### Phase 18 Cutover Readiness Handoff

**Checkpoint and scope**
- Phase 17 is packaged locally as `4b1fef7c3b260798262e24037859a1663e7b6ea0` and remains unpushed.
- Phase 18 changes are intentionally unstaged and uncommitted. The source `HEAD`, index, refs, reflogs, unique object inventory, remotes, and `localhost:3000` remain at their packaged baseline apart from the listed Phase 18 worktree files.
- No source/remote rewrite, source ref or reflog change, source garbage collection, fetch, push, force-push, merge, deployment, branch-protection change, credential rotation, or production/normal-database mutation was performed.

**Implemented**
- Added a dependency-free, read-only-by-default cutover preflight with a strict digest-bound private ledger, inspection-only Git command adapter, repeated observation checks, and redacted `READY`/`HOLD` output that never grants push authorization.
- Added 19 deterministic tests for missing or expired approvals, state/ref drift, stale remote evidence, wrong restoration bytes/modes, unsafe mappings and Git environments, tool and bundle substitution, TOCTOU changes, and redaction.
- Rebaselined all 13 restoration blobs and modes from packaged Phase 17. `README.md` and `TODO.md` now use their Phase 17 digests; 12 paths are restoration-only and the full-statement fixture remains verification-only.
- Built a new no-hardlink external candidate, filtered 15 paths across 4 approved namespace refs, applied the proposed mapping only there, restored the product branch, pruned only the candidate, and reached zero findings, zero unresolved refs, zero signatures, and `rewriteAllowed=true`.
- Created and verified complete prerequisite-free original and rewritten bundles, then independently cloned and scanned the candidate with no alternates, shared object identities, multi-link files, reflogs, findings, unapproved refs, or signatures.

**Verification**
- Cutover preflight: 19 tests passed. Live result: `HOLD` only for the 9 missing real production responsibility acknowledgements.
- Repository safety: 35 history tests and 20 current-tree tests passed; candidate and fresh-clone all-ref scans are clean.
- Application: 67 files and 469 tests passed with 5 intentional skips in the fresh candidate and Phase 18 source package; lint and production build passed in both.
- Browser: all 59 Chromium tests passed in 10.3 minutes on a dedicated loopback port, covering `/trades`, `/journal`, `/dashboard`, `/import`, and `/settings`.
- Only `trade_journal_phase18_test` was reset/migrated/seeded. Final deterministic state: 8 executions, 8 analytics rows, 3 non-stale closed trades, 1 demo account, 0 non-demo accounts, and 1 current watermark.
- Full redacted evidence, digests, responsibilities, limitations, and HOLD items are in `docs/history-purge-readiness.md`.

**Next approval boundary**
- `Approve Phase 18 packaging` authorizes staging and committing only the reviewed preflight tooling and redacted documentation.
- It does not authorize Phase 19, any source or remote rewrite, ref/reflog deletion, source garbage collection, push, force-push, merge, deployment, branch-protection change, credential rotation, or production/normal-database operation.
- Phase 19 remains on HOLD until the owner approves the exact production mapping and decides whether the real candidate must be rebuilt from packaged Phase 18 so the readiness tooling/documentation is included in final history.

### Phase 17 History Purge Rehearsal Handoff

**Checkpoint and scope**
- Phase 16 is packaged locally at `346a62587c37def252c143de380edba6ed4580ec`; it has not been pushed.
- Phase 17 tooling and documentation were packaged locally as `4b1fef7c3b260798262e24037859a1663e7b6ea0`; the commit has not been pushed.
- The source `HEAD`, branch, index, namespace refs, reflogs, objects, and remotes match their pre-rehearsal fingerprints.
- No source rewrite/garbage collection, remote fetch/push, force-push, merge, deployment, credential rotation, or production/normal-database mutation was performed.
- `localhost:3000` remains the verified Phase 16 build and returns HTTP 200.

**Implemented and verified**
- Pinned `git-filter-repo` 2.47.0 in an isolated external virtual environment and recorded the wheel, executable, command, commit-map, and evidence digests without changing global or project dependencies.
- Exported all 13 restoration files from raw Git blobs. This caught and documented a Windows archive-extraction CRLF conversion hazard.
- Created an independent mirror with 3,044 objects, zero alternates/remotes/shared file identities, and exact private treatment of the platform capture ref.
- Filtered 15 paths across 4 approved namespace refs with explicit partial ref scope, preserved identities, stripped rewritten signatures, and restored sanitized files only to `workstation-uplift`.
- The pre-prune scan had 308 dangling-only findings and zero reachable findings. Mirror-only cleanup pruned 1,898 objects; the final 1,561-object mirror has zero findings, signatures, reflogs, or unreachable objects and `rewriteAllowed=true`.
- Verified the 97-row commit map, every ref transition, all 15 path outcomes, 12 restoration-only histories, 3 permanently absent paths, and all 13 restoration blob/mode digests.
- Hardened scanner v3 with an exact-path/raw-hash/all-alias reviewed-binary policy for the application favicon. Invalid, normalized, changed, mixed-alias, pathless, and magic-file cases remain fail closed.
- Full redacted evidence and limitations are in `docs/history-purge-rehearsal.md`.

**Fresh rewritten clone**
- Independent clone scan: zero findings, zero unapproved refs, zero signatures, zero shared object identities, and `rewriteAllowed=true`.
- Repository safety: 35 history tests and 20 current-tree tests passed; current-tree scan covered 272 candidate versions with zero findings.
- Application verification: 67 Vitest files passed with 469 tests passing and 5 intentional skips; lint and production build passed.
- Browser verification: all 59 Chromium tests passed in 4.7 minutes, including `/trades`, `/journal`, `/dashboard`, `/import`, and `/settings`.
- Only `trade_journal_phase17_test` was created/reset/migrated/seeded. Final demo state: 8 executions, 8 analytics rows, 3 non-stale closed trades, 1 demo account, 0 non-demo accounts, and 1 current watermark.

**Next approval boundary**
- Phase 17 packaging approval was exercised only for the reviewed scanner, tests, and redacted documentation in local commit `4b1fef7`; no push followed.
- Phase 18 may add only readiness tooling, corrected redacted evidence, and external disposable candidate artifacts. It does not authorize a real source/remote rewrite, ref/reflog deletion, source garbage collection, push, force-push, merge, deployment, credential rotation, or production/normal-database mutation.
- The real rewrite remains Phase 19 and stays on HOLD pending an explicit branch mapping, freeze window, owner-side remote/ecosystem inventory, backup custody, branch-protection and CI coordination, collaborator communication, post-push verification, and rollback authority.

### Phase 16 Repository Safety Handoff

**Checkpoint**
- Branch: `workstation-uplift`
- Packaged Phase 15 commit: `66f5591f2468ff9f48780caac6057f3dca373f12`
- Phase 16 packaging was approved and committed locally as `346a62587c37def252c143de380edba6ed4580ec`. No push, merge, deployment, history rewrite, ref deletion, reflog expiry, object pruning, or credential rotation was performed.
- Phase 16 used only the separately created `trade_journal_phase16_test` database with `ALLOW_TEST_DATABASE_MUTATIONS=1`; both URLs resolved to the same direct isolated target. The normal/public database was not migrated, reset, seeded, imported into, or otherwise targeted by the application or test commands.

**Current-tree sanitization**
- Removed the tracked private brokerage-statement fixture and replaced all retained financial fixtures with deterministic `DEMO-*` data. A synthetic full-statement fixture preserves end-to-end parser coverage without retaining the removed export.
- Removed copied account/trade defaults from production and test code, removed the personal local path and private document link from tracked documentation, blanked database placeholders in `.env.example`, and made demo-only browser writes opt-in.
- Hardened `.gitignore` for private environments, editor state, databases and sidecars, dumps, archives, financial exports, backups, generated reports, screenshots, and test artifacts. Only the five reviewed synthetic financial fixtures and Prisma migration SQL are explicitly restored.
- Demo seeding now requires one explicit mode. Test seeding requires an isolated test target; shared demo seeding is rejected in CI and requires both URLs to resolve to the same target with a distinct `demo` token.
- Vercel builds are read-only. Migration deployment remains an explicit protected release step rather than part of the build command.

**Repository safety gate**
- Added a dependency-free Git-aware scanner over tracked files, unignored untracked files, staged index contents, sparse index blobs, symlinks, and submodule entries. It fails closed on private artifact paths, financial exports without exact canonical hashes, credential/account patterns, personal paths and email addresses, invalid filenames, unreadable Git state, and unsupported repository structures.
- Scanner output redacts matched values and sensitive-looking paths. Exact allowlists bind each synthetic fixture and intentional database-URL test file to its complete canonical SHA-256 digest.
- `npm run check:repo-safety` is CI-friendly and is automatically enforced by `pretest` and `prebuild`. The adversarial scanner suite covers staged-only secrets, UTF-16/NUL content, invalid UTF-8 hashing, sparse files, submodules, SQLite sidecars, archives, SQL exceptions, contextual credentials, redaction, dotenv comments, and operational failure output.
- `docs/history-purge-manifest.md` records only opaque finding IDs, affected paths, reachability classes, stop conditions, and a separately approved `git filter-repo` blueprint. It is a plan, not authorization to execute it.

**Redacted historical findings**
- Reachable history retains a SQLite database, the removed brokerage statement, prior brokerage-shaped fixture/default content, and personal documentation references.
- Local unreachable residue includes generated browser artifacts plus database, binary, editor-state, brokerage-account, personal-path, and private-document categories. A platform-managed capture ref appeared after the initial Phase 17 checkpoint and remains untouched pending an exact private disposition. Commit identity metadata and signed-commit disposition still need explicit owner decisions.
- No recognized private-key block, common provider-token shape, JWT, bearer credential, webhook secret URL, or hard-coded secret assignment was found under the audit rules. This bounded result is not proof that no unknown credential exists.

**Verification**
- Repository safety suite: 20 tests passed. Current candidate scan: 269 Git/worktree versions scanned with zero findings. Ignore-policy probes and `git diff --check` passed.
- Focused Phase 16 suite: 4 files and 34 tests passed for IBKR parsers, closed-trade ledger behavior, and demo-seed safety.
- Full suite: 67 files passed with 469 tests passing and 5 intentionally skipped whole-ledger database cases. `npm run lint` and `npm run build` passed; test and build each re-ran the safety scanner automatically.
- The first full-suite attempt failed before assertions because the isolated database did not exist. The target was created separately, the safety preflight passed, all 24 committed migrations were reset only there, and the complete rerun passed. No normal database fallback was used.
- Full `npm run test:e2e` passed all 59 Chromium tests in 4.2 minutes against a production build on a dedicated loopback port. Coverage includes `/trades`, `/journal`, `/dashboard`, `/import`, `/settings`, auth redirects, desktop/mobile containment, chart persistence/conflicts, journaling guards, import durability, metrics, and backup health.
- The isolated schema was reset and seeded again after browser verification. Final audit: 8 source executions, 8 analytics rows, a current analytics watermark, 3 non-stale closed trades, one demo account, and zero non-demo accounts, transient Phase 16 accounts, non-demo imports, `ROWS_APPLIED` batches, or `MATERIALIZATION_FAILED` batches.

**Known limitations and approval boundary: HOLD**
- The current tree is sanitized, but contaminated history, retained refs/reflogs, and unreachable objects still exist. Do not push or broaden repository access until a separately approved rewrite and owner-side remote/cache/fork/backup review are complete.
- The scanner is a deterministic preventive gate, not a forensic guarantee. Pattern coverage can miss unknown formats; binary screenshots are not OCR-inspected; and exact allowlists must be reviewed whenever an allowlisted file changes.
- A normal fresh clone can prove only the advertised refs it fetches. Hidden server refs, unreachable remote objects, CI caches, artifacts, forks, old clones, and backups require owner-specific evidence and remediation.
- `Approve Phase 16 packaging` authorizes staging and committing only this reviewed current-tree package. It does not authorize a push, merge, deployment, history rewrite, ref deletion, reflog expiry, garbage collection, force-push, credential rotation, or production database operation.

### Phase 15 Materialization And Lifecycle Handoff

**Checkpoint**
- Branch: `workstation-uplift`
- Packaged Phase 14 commit: `c70e92bb7d1d7aa103262e8fef1b136b2b438050`
- Phase 15 packaging was approved on 2026-07-21. The package is committed locally; push, merge, deployment, and history rewriting remain separate approvals.
- Phase 15 used only `trade_journal_phase15_test` with `ALLOW_TEST_DATABASE_MUTATIONS=1`; both test URLs were pointed at the same direct isolated target. The normal/public schema was not migrated, reset, seeded, imported into, or mutated.

**Execution analytics serialization contract**
- Execution analytics is now explicitly global-only because cumulative P&L is portfolio-global. The unsafe account-scoped persistence path was removed, and deterministic demo seeding requests a canonical global refresh.
- Every refresh acquires a schema-scoped PostgreSQL transaction advisory lock plus `SHARE` locks on the schema-qualified instrument, execution, and position-snapshot source tables before reading source data. Those locks remain held through analytics replacement, watermark writing, and transaction commit, so source writers cannot race the committed snapshot.
- Execution and opening-position rows are loaded with single joined queries qualified to the configured PostgreSQL schema. This prevents relation tearing during concurrent deletes and prevents test-schema raw SQL from resolving to `public`.
- Source signatures are checked again before persistence inside the locked transaction. Instrument identity and analytics-relevant fields use a deterministic SHA-256 digest; execution and position-snapshot sources retain count plus maximum `updatedAt` guards.
- Analytics replacement and its watermark are one transaction. Injected pre-commit failure restores the prior complete rows and watermark exactly.
- Lazy dashboard/trade callers recheck freshness after acquiring the lock, avoiding queued redundant rebuilds when another caller has already completed the same source revision.
- Analytics and closed-trade refreshes remain sequential, separate transactions. Their advisory locks are never nested, preserving the current lock order.

**Import lifecycle contract**
- Multipart and Flex imports now use one shared post-import finalizer. Materializer failures and final `MATERIALIZED` status-write failures both trigger best-effort cohort-wide `MATERIALIZATION_FAILED` recovery.
- Imported business rows, raw artifacts, provenance, row errors, and accounting remain committed when downstream processing fails.
- Success and failure status helpers reject empty identifiers, deduplicate IDs, verify every expected batch exists, require one non-null cohort ID, compare the supplied set with every persisted cohort member, require all members to be `ROWS_APPLIED`, and transition the complete cohort atomically. A missing member cannot silently produce a partial lifecycle update.
- If recovery also fails, the service preserves both the primary and recovery errors in `ImportLifecycleRecoveryError`; it does not mask the original failure.
- Import history now labels `MATERIALIZATION_FAILED` as `Processing failed`, settings counts it as `Post-Import Processing Failures`, and durable notes describe incomplete post-import processing rather than claiming every failure was a refresh failure.
- Manual Flex and cron routes retain their existing authentication and return truthful HTTP 500 responses when the shared service reports lifecycle failure.

**Verification**
- Three focused read-only audits checked analytics transaction boundaries, every production caller, global cumulative-P&L semantics, lifecycle divergence, deterministic test seams, and browser presentation coverage before edits.
- Isolated global analytics pack: 1 file and 7 tests passed. Its 5 database cases cover an observed source writer blocked through commit, older/newer refresh ordering, three queued refreshes, exact analytics/watermark rollback, persisted global chronological P&L across accounts, and two independent import cohorts reaching `ROWS_APPLIED` while refreshes serialize; 2 pure cases verify schema-scoped parameterized lock construction.
- Focused lifecycle/import pack: 9 files and 66 tests passed, covering shared orchestration, recovery-error preservation, atomic complete-cohort transitions, multipart row/artifact retention, two-member Flex final-status recovery, manual/cron success and failure responses, and position-import regressions.
- `npm run test` passed 66 files with 462 tests and 5 intentionally skipped global-ledger database tests; those five database tests are the separately isolated cases above and are gated by `RUN_EXECUTION_ANALYTICS_DB_TESTS=1` so parallel fixture churn cannot invalidate their whole-ledger source assumptions. Existing carry-in, reversal, duplicate import, corrected commission, and position-snapshot scenarios remained green in the full suite.
- `npm run lint`, `npm run build`, and `git diff --check` passed. No dependency or migration was added.
- All 24 committed migrations were reset only into the Phase 15 schema. Deterministic demo seeding passed before and after browser verification.
- Full `npm run test:e2e` passed all 59 Chromium tests in 4.2 minutes. New browser coverage verifies `Rows applied` and `Processing failed` on `/import` desktop and `/settings` mobile, the renamed post-import processing failure count, and horizontal containment. Existing dashboard, trades, chart, journal, backup, auth, and responsive checks all remained green.
- The in-app interactive browser was unavailable for a separate manual pass. The complete production-backed Chromium suite covered `/import`, `/settings`, `/dashboard`, and `/trades` at desktop/mobile sizes with browser-error assertions.
- Final demo audit: 8 source executions, 8 analytics rows, current matching execution-analytics watermark, 3 demo closed trades, one demo account, and zero transient Phase 15 fixtures, non-demo imports, `ROWS_APPLIED` batches, or `MATERIALIZATION_FAILED` batches.
- The verified production build is running at `http://localhost:3000` against `trade_journal_phase15_test` with demo-only writes. An unauthenticated `/trades?account=DEMO-WORKSTATION` request correctly redirects to login with the deep link preserved.

**Known limitations and release decision: HOLD**
- Execution and position-snapshot source signatures remain count plus maximum `updatedAt`, not full row digests; instruments now use an exact digest of analytics-relevant fields. Normal Prisma corrections advance `updatedAt`, while out-of-band source writes that deliberately preserve timestamps require an explicit refresh/reconciliation.
- Execution, position-snapshot, and instrument writers briefly wait while the global execution-analytics refresh holds its source table locks. This favors a provably consistent ledger over concurrent source mutation during replacement.
- Closed-trade materialization still uses a fixed database-wide numeric advisory key. It is safe but can cause unnecessary cross-schema contention on the same database.
- Execution analytics and closed trades are not one joint transaction. If closed-trade refresh fails after analytics succeeds, the cohort truthfully reports processing failure and should be retried/reconciled.
- If the database also rejects the best-effort failure-status recovery, affected rows can remain `ROWS_APPLIED`; the composite error now records that condition for operational reconciliation.
- Release remains blocked by sensitive brokerage data in Git history, the separately approved history purge/ref scan, production database connectivity and migration checks, fresh backup/PITR and restore rehearsal, and the remaining release checklist below.
- Do not push, merge, deploy, or expose this repository to broader CI/access until those gates are explicitly cleared.

### Phase 14 Import Serialization Handoff

**Checkpoint**
- Branch: `workstation-uplift`
- Packaged Phase 13 commit: `b7467367d75623eecffde01fb9885eea60b3467d`
- Phase 14 packaging was approved on 2026-07-20. The package is committed locally; push, merge, and deployment remain separate approvals.
- Phase 14 used only `trade_journal_phase14_test` with `ALLOW_TEST_DATABASE_MUTATIONS=1`; both test URLs were pointed at the same direct isolated target. The normal/public schema was not migrated, seeded, imported into, or mutated.

**Account serialization contract**
- Every full or partial position import acquires schema-scoped PostgreSQL transaction advisory locks for its complete sorted account set before freshness reads, account/instrument creation, current-position writes, history writes, or pruning.
- Atomic cohorts prelock the union of every position account once before applying any member. Reversed multi-account cohorts use the same deterministic order, while disjoint accounts remain independently runnable.
- Freshness is checked after locking. Older full and partial snapshots cannot overwrite newer known position state, and mixed effective dates for one account in a file are rejected before business rows commit.
- Equal-date full corrections remain supported. The later serialized correction replaces both current positions and same-date historical membership, including obsolete symbols, while exact retries remain accepted.
- Account and instrument creation order is deterministic, closing shared-unique-index deadlock exposure for disjoint accounts importing the same new instruments.
- Advisory keys structurally encode schema/account tuples and remain parameter-bound. Direct and atomic interactive transactions both allow up to 120 seconds for legitimate lock waits.
- The import lifecycle remains unchanged: atomic losers retain raw artifacts, direct/rollback roles, truthful errors, conserved row counts, and zero committed business rows.

**Verification**
- Three read-only implementation audits and three read-only post-implementation audits checked transaction boundaries, production callers, lock semantics, failure accounting, and deterministic test coverage.
- Focused import pack: 2 files and 40 tests passed, including observed ungranted advisory locks from `pg_locks`, full/full exact replacement, both newer/older orders, both full/partial orders, stale and mixed-date partial rejection, same-date corrections, reversed multi-account cohorts, disjoint-account independence, opposite-file-order shared-instrument creation, delimiter-safe instrument identities, and failed-cohort artifact/rollback evidence.
- `npm run test` passed 61 files and 444 tests. `npm run lint`, `npm run build`, and `git diff --check` passed.
- All 24 committed migrations were reset only into the Phase 14 schema, deterministic demo seeding passed, and the complete production-backed Playwright suite passed all 58 Chromium tests in 8.1 minutes. The schema was reset and reseeded again afterward so localhost contains only the deterministic review dataset.
- Fresh 1440x1000 and 390x844 screenshots for `/trades`, `/positions`, `/import`, and `/settings` were inspected. The trade workstation painted all three panels and overlays; every route had no horizontal overflow, framework overlay, page error, or console error.
- No dependency or migration was added. Packaging was approved locally; no push, merge, rebase, deployment, or history rewrite was performed.
- The verified production build is running at `http://localhost:3000` against `trade_journal_phase14_test` with demo-only writes.

**Release decision: HOLD**
- Position snapshot concurrency is no longer a release blocker.
- Release remains blocked by sensitive brokerage data in Git history, the separately approved history purge/ref scan, production database connectivity and migration checks, fresh backup/PITR and restore rehearsal, and the remaining operational limitations below.
- The Phase 14 audit also found a separate stale-overwrite race in global execution-analytics materialization and a final-status asymmetry in Flex imports. Those are deferred candidates for the next bounded phase and were not mixed into the position-import transaction package.
- Do not push, merge, deploy, or expose this repository to broader CI/access until the remaining gates are explicitly cleared.

### Phase 13 Release Handoff

**Checkpoint**
- Branch: `workstation-uplift`
- Packaged Phase 12 commit: `b80f71da681521ba143e00bab885a535889ec448`
- Phase 13 changes are intentionally unstaged and uncommitted.
- Phase 13 used only `trade_journal_phase13_test` with `ALLOW_TEST_DATABASE_MUTATIONS=1`; the normal/public schema was not migrated, seeded, imported into, or mutated.

**Canonical UTC contract**
- Date-only inputs are strict real `YYYY-MM-DD` values parsed at UTC midnight. Range endpoints remain inclusive from `00:00:00.000Z` through `23:59:59.999Z`.
- `ClosedTrade.tradeDate` is the calendar dimension for closed-trade range filtering, daily grouping, and dashboard realized day/week/month cards. `closeTime` remains the execution instant used for ordering, hold duration, and explicitly zoned ISO timeline points.
- Dashboard day and month periods begin at UTC midnight; weeks begin Monday at `00:00:00.000Z`. Period cards are the selected range intersected with the UTC period ending on the selected anchor day.
- Dashboard YTD/3m/6m presets derive the current UTC date and use clamped UTC calendar arithmetic. Execution volume buckets, scatter times, and closed-trade chart keys are generated in UTC.
- Calendar month/year queries use inclusive UTC boundaries. Position snapshots include only the prior UTC day as the MTM baseline, and calendar navigation/grids/labels use UTC arithmetic and formatting.

**Verification**
- Focused UTC pack: 7 files and 39 tests passed across helpers, presets, dashboard aggregation/chart formatting, calendar query ranges/aggregation, closed-trade filters, and demo reconciliation.
- Regressions cover near-midnight period cards and date keys under `UTC`, `Australia/Sydney`, and `America/New_York`; January 1/December 31 year membership; Monday week boundaries; leap and month-end arithmetic; inclusive endpoints; and the June 18 demo loss.
- Demo metrics remain 3 trades, `$591.40` net, `66.67%` win rate, `$197.13` expectancy, and `5.84` profit factor. The June 17-22 cards are `$293.90` day/week and `$591.40` month; June 18 is one DEMOB loss at `-$122.10` across dashboard, trades, and calendar.
- `npm run test` passed 60 files and 426 tests after one transient Neon connectivity retry; `npm run lint`, `npm run build`, and `git diff --check` passed.
- All 24 committed migrations were reset only into the Phase 13 schema, then deterministic demo seeding passed. The complete production-backed Playwright suite passed all 58 Chromium tests in 5.8 minutes.
- Fresh 1440x1000 and 390x844 screenshots for dashboard, trades, and calendar were inspected. All three trade charts painted, the June calendar reconciled, and route containment passed at both sizes.
- No migration or dependency was added. No stage, commit, push, merge, rebase, or history rewrite was performed.

**Release decision: HOLD**
- Canonical UTC metric/calendar correctness is no longer a release blocker.
- Release remains blocked by sensitive brokerage data in Git history, the separately approved history purge/ref scan, production database connectivity and migration checks, fresh backup/PITR and restore rehearsal, and the remaining operational limitations below.
- Do not push, merge, deploy, or expose this repository to broader CI/access until those gates are explicitly cleared.

### Phase 12 Release Handoff

**Checkpoint**
- Branch: `workstation-uplift`
- Packaged Phase 11 commit: `288ed99e4db50ff6299c2d77bdc2e6e2c745466d`
- Comparison base: `main` at `deb0c79`; this branch is 12 commits ahead and changes 190 files.
- Branch delta includes 15 new migrations (24 committed migrations total), about 35,000 added lines, and the complete workstation, import, journal, backup, auth, metrics, and chart uplift.
- Phase 12 uses only `trade_journal_phase12_test` with `ALLOW_TEST_DATABASE_MUTATIONS=1`. No normal/public-schema mutation is permitted.

**Bounded Phase 12 package**
- Chart context changes now discard a pending pan/zoom range before changing symbol, comparison, timeframe, or range, preventing the old viewport from being saved into the new context.
- An unfinished trend is bound to panel, symbol, timeframe, and range. Context changes clear it, so points from different chart contexts cannot be combined.
- Invalid primary symbols are rejected in the chart UI before candle or layout requests.
- Regression: rapid pan then timeframe switch leaves the new layout range empty; an unfinished trend disappears without an annotation write; an invalid symbol neither requests candles nor changes the saved layout.
- No dependency or migration is added. Local checkpoint packaging was approved on 2026-07-20; release and push approval remain separate.

**Release decision: HOLD**
- Do not push, merge, deploy, or expose this repository to broader CI/access yet.
- A tracked CSV fixture and earlier Git history contain real-looking brokerage/account data. The current tree must be sanitized and the affected Git history purged in a separately approved history-rewrite operation.
- The 2026-07-17 read-only target audit found two unapplied production migrations, an out-of-date verified backup, and unreliable runtime pooler connectivity.
- Timezone-dependent dashboard period cards and calendar year boundaries remain a confirmed correctness blocker.

#### Release Checklist
- [x] Replace all tracked brokerage fixtures and hard-coded account defaults with deterministic demo values.
- [ ] Approve and perform a repository history purge, then rescan every ref for account IDs, executions, positions, prices, P&L, tokens, private keys, and database files.
- [ ] Confirm Preview and test deployments use databases/schemas isolated from Production.
- [ ] Restore and independently verify `DATABASE_URL` pooler connectivity; keep `DIRECT_URL` for migrations.
- [ ] Create a fresh provider-native snapshot/PITR point and a new encrypted JSON backup verified after the latest source-data change.
- [ ] Rehearse provider snapshot restoration into an isolated database; record owner, expected recovery time, and cutover decision.
- [ ] Run duplicate/precondition queries for the forward-only correction and journal-link deduplication; approve any deletion policy.
- [ ] Reconcile imports left in `ROWS_APPLIED` and prevent imports/Flex/cron traffic during migration.
- [ ] Apply committed migrations with `npm run prisma:migrate:deploy`, then verify Prisma migration status before starting application traffic.
- [ ] Run unit, lint, build, full Playwright, route smoke, auth-negative, import, backup, and storage-health checks against an isolated release-candidate database.
- [ ] Verify `/trades`, `/journal`, `/dashboard`, `/calendar`, `/import`, and `/settings` at 1440x1000 and 390x844 with nonblank chart canvases.
- [x] Fix and verify canonical UTC day/week/month/year boundaries before release.

#### Environment Checklist
- Required core: `DATABASE_URL`, `DIRECT_URL`, production `NEXTAUTH_URL`, strong `NEXTAUTH_SECRET`, `AUTH_USERNAME`, and `AUTH_PASSWORD`.
- Required for scheduled Flex: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`, and `CRON_SECRET`.
- Required only for external bearer calls to `/api/flex/run`: `IBKR_FLEX_RUN_SECRET`.
- Optional: Flex polling/base URL, Alpaca, market-overview, TradingView, diagnostics, and the complete R2 credential/bucket/public URL set.
- Production must leave `ALLOW_TEST_DATABASE_MUTATIONS` and `ALLOW_SHARED_DEMO_SEED` unset/disabled.
- Production must leave `E2E_DEMO_ONLY_WRITES` unset or `0`. `.env.example` now defaults it to `0`; Playwright enables it only for its isolated loopback server.
- Never use Production credentials or URLs in local, Preview, test, or CI demo-seed jobs.

#### Migration Summary
- The branch adds 15 forward migrations covering non-destructive closed-trade refresh, import durability/lifecycle/raw artifacts/errors, chart versions and annotations, structured reviews/tags, uniqueness corrections, materialization watermarks, position snapshot modes, backup audits, and import cohort provenance.
- `20260625170500_unique_closed_trade_journal_links` removes duplicate links before enforcing uniqueness.
- `20260625175000_forward_only_prisma_correction` aborts if conflicting closed-trade execution links remain; its preconditions must be checked immediately before deployment.
- `20260716090000_import_cohort_provenance` is required by current import write/query code.
- The 2026-07-17 read-only target audit found the final two migrations above unapplied. Recheck status at deployment time; do not assume this remains current.

#### Rollback Procedure
- Do not roll the application back to `main` against the migrated workstation schema. The old destructive materializer can cascade-delete review/chart data.
- Before migration, stop import/Flex/cron writes, retain a provider-native snapshot/PITR point, record the application commit, and retain the verified JSON export separately.
- If migration or smoke verification fails, stop traffic, preserve failure logs, restore the provider snapshot into a new database/branch, repoint both database URLs, and deploy the application commit that matches that restored schema.
- Verify authentication, trade counts, closed-trade reconciliation, journal links, chart layouts/annotations, import status, and backup freshness before reopening traffic.
- The JSON backup validator builds a restore plan but there is no transactional restore executor. Treat JSON as a secondary recovery artifact, not the primary rollback mechanism.

#### Known Limitations And Deferred Blockers
- Sensitive brokerage data remains in Git history until an approved rewrite and ref scan are complete.
- Canonical UTC dashboard and calendar boundaries are verified in Phase 13; deployment must preserve the UTC contract and its timezone regressions.
- Global execution-analytics materialization is not serialized; an older concurrent refresh can overwrite a newer result and watermark.
- Flex final status-update failure handling can leave batches in `ROWS_APPLIED` where multipart imports record `MATERIALIZATION_FAILED`.
- Backup freshness has count-neutral blind spots for tables/relations without update timestamps, and external R2 objects are referenced rather than embedded.
- Demo-only write mode does not cover every authenticated journal/playbook/day-note or cron mutation path.
- Authentication is single-user static credentials without roles, MFA, or application rate limiting.
- Restore execution is operational/provider-based rather than implemented in the application.
- Historical imports without raw archives cannot be made complete retroactively.

### Archived Phase 13 Verification
- Phase 13 canonical UTC metrics and calendar boundary correctness pass.
- Three focused read-only audits identified host-local dashboard cards/chart buckets/presets, calendar queries/navigation, and test oracles that reproduced the defect. The bounded package replaced those paths with one shared UTC contract.
- `ClosedTrade.tradeDate` now drives closed-trade filtering, grouping, and period cards; dashboard presets and execution buckets are UTC; calendar queries and navigation use inclusive UTC month/year boundaries with a prior UTC-day MTM baseline.
- Verification run: focused UTC tests passed 7 files and 39 tests; `npm run test` passed 60 files and 426 tests; `npm run lint`, `npm run build`, and `git diff --check` passed; all 58 Chromium tests passed after isolated reset and deterministic reseed.
- Fresh desktop/mobile screenshots show reconciled dashboard, trades, and calendar data with no horizontal overflow. The verified production build is running at `http://localhost:3000` against `trade_journal_phase13_test`.
- At its review checkpoint, the package introduced no migration or dependency and remained unstaged at packaged Phase 12 commit `b80f71da681521ba143e00bab885a535889ec448`.
- Release status remains HOLD for sensitive Git history, production migration/backup/pooler gates, incomplete restore execution, and the remaining operational findings above.

### Archived Phase 12 Verification
- Phase 12 final acceptance audit and bounded chart-context integrity pass.
- Pending pan/zoom writes are discarded before chart context changes; unfinished trends cannot cross panel/symbol/timeframe/range contexts; and invalid primary symbols are rejected before candle/layout work.
- Verification run: focused regression passed; `npm run test` passed 58 files and 407 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. After resetting only the disposable Phase 12 schema, all 24 migrations and the deterministic demo seed passed, followed by all 58 Chromium tests.
- Fresh 1440x1000 and 390x844 screenshots for `/trades`, `/journal`, `/dashboard`, `/calendar`, `/import`, and `/settings` were inspected. The desktop trade viewport showed all three painted panels; route containment checks passed at both sizes.
- The package used only `trade_journal_phase12_test`; no normal/public schema was mutated. Phase 12 was packaged as `b80f71da681521ba143e00bab885a535889ec448`.

### Previous Verified Iteration
- Phase 11 release-candidate integration hardening and UX acceptance pass.
- Four focused read-only audits selected a bounded package covering responsive containment, review/journal navigation safety, UTC metric reconciliation, stale chart comparison state, execution-label clipping, and accessibility gaps. No schema migration or dependency was introduced.
- Trades and Journal filter grids now adapt across desktop widths; mobile calendar cells use compact signed totals; backup warnings wrap behind an expandable disclosure; import/journal status surfaces use live semantics; destructive journal controls are named; and the active mobile route scrolls into view.
- A shared workstation navigation guard now protects dirty or in-flight work across sidebar links, filters, sign-out, and browser navigation. Closed-trade group-key deep links remain authoritative across mismatched filters and reload, Save & Next keeps the URL synchronized, and missing exact trades show an explicit unavailable state rather than opening the wrong trade.
- Closed-trade journal creation now rechecks the link under the locked closed-trade row, preventing duplicate or stale bridges under concurrent requests. Source links carry only the immutable group key. UTC date-only boundaries now align dashboard, trades, and calendar results; demo metrics reconcile to 3 trades, `$591.40` net, `66.67%` win rate, `$197.13` expectancy, and `5.8436` profit factor.
- Chart comparison paint is published only for the current fresh primary/comparison request pair. Dense execution labels are packed inside plot bounds, daily/weekly coverage retains known US-equity profile metadata, and the journal chart range selector supports keyboard movement and boundary adjustment.
- Verification run: `npm run test` passed 58 files and 407 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. The final freshly seeded production-backed Playwright run passed all 57 Chromium tests in 4.7 minutes. A stricter settled-panel responsive recapture then passed separately and produced 12 desktop/mobile screenshots with all three trade panels painted and no horizontal page overflow.
- The package used only `trade_journal_phase11_test` with `ALLOW_TEST_DATABASE_MUTATIONS=1`; the normal/public schema was not seeded, migrated, imported into, or otherwise mutated. The working tree remains intentionally unstaged and uncommitted on `workstation-uplift` at packaged Phase 10 commit `5af943b`; no commit or push was performed.
- The verified production build is running at `http://localhost:3000` with demo-only writes against `trade_journal_phase11_test` for user review.

### Previous Verified Iteration
- Phase 10 market-session-aware candle coverage correctness pass.
- Focused server, data-model, browser, and verification audits found that wall-clock continuity treated weekends, holidays, early closes, overnight periods, and DST boundaries as missing market data. Cache/provider ranking could therefore prefer the wrong source, trigger needless fallbacks, or label valid closed-session gaps as incomplete. Sparse 5M recovery also stopped at the former 2x source window, and provider range clipping was inconsistent.
- A pure `America/New_York` US-equities calendar now computes expected core-session bars for 5M, 10M, 15M, and 1H. It covers standard holidays, Juneteenth, Good Friday, observed dates, known exceptional closures, early closes, and DST transitions. Coverage is reported structurally as `complete`, `partial`, `closed`, `limited`, or `unverified`, with expected/present/missing counts, sample missing timestamps, session policy, timezone, profile, and scan-exhaustion state. Extended-hours bars remain visible while core-session bars define required completeness.
- Instrument and Yahoo metadata resolve the maintained US stock/ETF profile conservatively. Unsupported or ambiguous instruments still display available candles but remain unverified and are not admitted to the short-lived client response cache. Verified closures can use cache data without provider fallback; genuine in-session gaps remain partial and trigger recovery. Native, derived, and provider candidates are now ranked by session-aware coverage across timeframes.
- Yahoo and Stooq candidates are clipped to the exact requested range, Yahoo's exclusive end boundary includes the aligned final interval, and 15M recovery scans up to six bounded attempts/8x source depth with cancellation checks while still requiring exact B/B+5m/B+10m constituents. Existing Phase 8 provenance and Phase 9 request cancellation/ownership rules are preserved.
- The candle API exposes the structured coverage object and derives readable warnings from it. The chart workspace separates displayability from cache reusability, so partial or unverified responses can remain painted without becoming reusable cache entries. Demo candles are now session-shaped and labeled `demo`; the Juneteenth closure has no intraday bars, DEMOC uses a reviewable extended-hours entry on June 18, and its 5M/1H/1D plus derived 15M panels retain all three execution overlays.
- Final browser verification exposed a separate data-safety defect in the shared closed-trade review lock: raw `FOR UPDATE` SQL used an unqualified `ClosedTrade` table, so a Prisma URL targeting a non-public schema could preflight the correct row and then lock `public`. The lock now safely qualifies the configured Prisma schema, protecting notes, chart layouts, and annotations; a regression covers explicit/default/escaped schemas and parameterized group keys.
- Verification run: focused lock routes passed 27 tests; `npm run test` passed 55 files and 394 tests; `npm run lint` and `npm run build` passed. The final freshly seeded production-backed Playwright run passed all 53 Chromium tests in 5.3 minutes, including session-complete derived 15M coverage, chart canvas pixels, cancellation, review save/navigation, stale-write guards, desktop/mobile route checks, imports, backup, and journaling. The in-app browser backend was unavailable for a second manual visual pass; automated Chromium verification completed successfully.
- The package used only `trade_journal_phase10_test`, introduced no migration or dependency, and did not seed, migrate, import into, or otherwise mutate the normal/public schema. Phase 9 is packaged in commit `b71d01b`; Phase 10 is packaged in commit `5af943b`. At that checkpoint, the verified build ran against the isolated Phase 10 schema.

### Previous Verified Iteration
- Phase 9 cancellation-safe shared candle request orchestration pass.
- Focused client, server, and delayed-browser audits found that Phase 8's exact-URL promise sharing prevented duplicate fetches but had no consumer ownership: obsolete chart effects only ignored late state updates, never aborted provider work, and a hung promise could occupy the global map indefinitely. The route also dropped `NextRequest.signal`, while catch-all provider fallbacks could misclassify cancellation as an outage and continue unnecessary work.
- A reusable request pool now gives each chart consumer an idempotent lease, reference-counts identical in-flight request keys, aborts exactly once after the final owner releases, evicts an abandoned request before abort so a new consumer can reattach safely, and enforces a 30-second client deadline. Its five-minute/48-entry cache admits only complete, finite, non-empty responses that settled while the request was still current; abandoned, aborted, empty, malformed, incomplete, and error payloads are never cached.
- Primary and comparison candles now use independent request lanes. Trade/layout owner gating prevents transient acquisitions against the previous workspace, request generations block late obsolete state, symbol/trade ownership prevents an old instrument from painting under a new symbol, and same-owner replacement failures retain the last nonblank chart while clearly marking it stale and showing provider diagnostics. Execution alignment, overlay rules, drawing freshness guards, saved ranges, and layout/annotation persistence contracts are unchanged.
- `NextRequest.signal` now flows through the route, cache reads/retries, 15M aggregation attempts, Alpaca pagination, Yahoo, and Stooq fetches. Cancellation escapes provider-warning recovery instead of triggering more fallbacks. Compare requests use `Promise.allSettled` so accepted sibling work drains before cancellation propagates. Once valid Alpaca bars cross the acceptance boundary, their durable cache write finishes without being interrupted by a later disconnect, then the cancellation propagates instead of producing a false successful response.
- Unit coverage proves shared ownership, idempotent release, final-owner abort exactly once, clean reattachment, no cache admission after an ignored late response, reusable-only cache admission, request deadlines, pre-abort no-work behavior, cache-read cancellation, provider signal forwarding/fallback stopping, post-acceptance write durability, exact route signal forwarding, cancellation propagation, and compare-sibling draining. Browser coverage observes the real underlying fetch signals across two shared panels, 5M -> 15M -> 1H -> 15M, comparison add/remove, and DEMOA -> DEMOC -> DEMOA; it also proves one shared 15M network request, stale-response isolation, nonblank failure fallback, derived provenance, and fresh recovery.
- Post-implementation client/server verifier loops found and closed two subtle deadline boundaries before handoff: an abort-insensitive client loader could outlive the timer, and cancellation during an accepted Alpaca write could be swallowed after persistence. The public lease now rejects at the deadline regardless of loader cooperation, late settlement remains quarantined, accepted writes drain before cancellation propagates, and non-OK provider responses check cancellation before fallback.
- Verification run: focused Phase 9 tests passed 54 tests; `npm run test` passed 53 files and 365 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. The final freshly seeded Playwright run passed all 53 Chromium tests in 4.2 minutes, including the full route, journal, chart, import, backup, mutation, 15M provenance, overlay, save-conflict, and viewport guard suites.
- The package used only `trade_journal_phase9_test`, introduced no migration or dependency, and did not seed, migrate, import into, or otherwise mutate the normal/public schema. Phase 8 is packaged in commit `64ce8de`; Phase 9 is packaged in commit `b71d01b`.

### Previous Verified Iteration
- Phase 8 trustworthy 15-minute candle derivation and cache coverage pass.
- Three focused read-only audits traced native 15M cache selection, complete 5M-derived fallback, provider fallback, limits, range clipping, OHLCV aggregation, diagnostics, source metadata, and seeded DEMOA/DEMOC browser behavior. Follow-up verifier loops challenged stale and gapped native candidates, discarded-bucket limit underfill, sparse provider displacement, pending provenance, and browser save teardown.
- Native and derived 15M candidates are now compared deterministically. A covering complete 5M-derived cache can outrank partial, stale, or timestamp-gapped native 15M data, while complete native data remains preferred when timestamps and quality match. Provider data must be more usable than the selected cache; a tiny or sparse provider response cannot displace a denser partial fallback.
- Derived 15M bars now require exactly the expected `B`, `B+5m`, and `B+10m` constituents. Inputs are finite, sorted, and deduplicated; incomplete first, middle, and terminal buckets are omitted; requested target starts are clipped exactly; zero volume is preserved; unknown constituent volume remains unknown; and adaptive bounded source overfetch preserves latest-bar limits and the route truncation sentinel after invalid buckets are discarded.
- The candle API keeps `source: cache` for compatibility and adds nullable `cacheKind` provenance. Derived panels display `5M-DERIVED`, pending requests clear stale provenance, partial-cache/provider decisions return explicit diagnostics, and complete derived coverage avoids provider calls even when Alpaca credentials are configured.
- Browser coverage now drives seeded DEMOA through 5M -> 15M -> 1H -> 15M, changes to 1M, verifies derived provenance and execution overlays through Focus/Show all and reload, then switches to DEMOC and proves its traded-symbol 15M panel remains nonblank with overlays. The browser mock waits for queued layout saves before teardown.
- Verification run: isolated-schema preflight and all 24 migrations passed; focused candle/alignment coverage passed 40 tests; `npm run test` passed 52 files and 352 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. The final freshly seeded Playwright run passed all 52 Chromium tests in 3.6 minutes.
- The package used only `trade_journal_phase8_test`, introduced no migration, and did not seed, migrate, import into, or otherwise mutate the normal/public schema. Deliberately deferred findings are exchange-calendar-aware cache continuity, extreme sparse-cache recovery beyond the bounded adaptive overfetch window, cancellation of obsolete shared candle requests, and the known 1440px trade-filter action overflow outside the chart region.
- Phase 7 is packaged in commit `bb9621f`. Phase 8 is packaged in commit `64ce8de`.

### Previous Verified Iteration
- Phase 7 closed-trade chart interaction smoothness and request/render convergence pass.
- Focused read-only audits traced chart render/effect lifecycles, time-scale subscriptions, ResizeObserver and restore work, pointer/wheel arming, execution and annotation overlays, candle request/cache behavior, stale response suppression, 15-minute derivation, and DEMOA/DEMOC browser interactions. The highest-impact issue was subscription teardown across ordinary panel/save-state changes: cleanup could prematurely commit a pending range before the 600ms coalescing window ended.
- Viewport subscriptions now remain mounted for each chart lifetime and read current panel, write, read-only, and save-activity callbacks through refs. Pending ranges use an explicit per-panel flusher for real layout transitions and unmounts, preserving the latest viewport without coupling persistence to effect churn. Focus/Show all remains responsive during range-only saves.
- Drag arming now happens once after crossing the movement threshold, wheel arming uses one capture path, execution overlay scheduling reads the latest geometry callback without recreating subscriptions, unrelated panel annotations retain stable identities, and deferred visible-range restore frames are cancelled before chart disposal.
- Primary and comparison series stay painted during same-trade replacement loads. Successful but empty, malformed, error-bearing, or incomplete requested-comparison candle payloads are no longer retained in the five-minute client cache, so a timeframe round trip can recover immediately when the provider or cache becomes healthy.
- Browser coverage now overlaps a drawing save with an active pan/zoom debounce, proves layout state stays clean until the range debounce expires, observes one trailing range PUT, reloads the latest saved range, and retains it through Focus/Show all and a real layout transition. A separate regression proves an empty 5M response is retried and recovers bars after 5M -> 1H -> 5M. Existing 15M, no-blank replacement, resize, stale-save, journal-wait, and trade-switch guards remain green.
- Verification run: isolated-schema preflight and all 24 migrations passed; focused chart/candle coverage passed 67 tests; `npm run test` passed 52 files and 338 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. The final freshly seeded Playwright run passed all 52 Chromium tests in 3.6 minutes.
- Live baseline before edits showed seeded DEMOA panels at 1,191 5M bars, 672 1H bars, and 93 1D bars; rapid 15M/1H/5M changes remained nonblank, Focus/Show all stayed enabled, and mobile had no page overflow. The known trade-filter action group still creates 261px of page-level overflow at 1440px; it is outside the chart region and was not mixed into this package.
- The package used only `trade_journal_phase7_test`, introduced no migration, and did not seed, migrate, import into, or otherwise mutate the normal/public schema. Deferred server-side findings were partial native 15M cache masking a more complete derived 5M cache, market-closure-aware cache coverage, incomplete terminal 15M buckets, and cancellation of obsolete shared candle requests; Phase 8 resolves the bounded 15M correctness findings.
- Phase 6 is packaged in commit `c1c4e59`. Phase 7 is packaged in commit `bb9621f`.

### Previous Verified Iteration
- Phase 6 durable import provenance and complete history pagination pass.
- Three focused read-only audits traced the `ImportBatch` schema and every multipart/Flex allocation path, backup/restore compatibility, both route loaders, cursor ordering, shared presentation, legacy-null behavior, and mobile overflow. They agreed that successful cohorts had no durable grouping, failure roles existed only in truncated notes, content-addressed artifacts could not identify an attempt, and the fixed newest-20-row query could split a cohort and made older history unreachable.
- A nullable migration adds `cohortId`, attempt-local `sourceId`, parent `sourceFilename`, parsed `sourceSection`, and `cohortRole` (`MEMBER`, `DIRECT_FAILURE`, or `ROLLED_BACK`) plus stable history indexes. No legacy provenance is inferred. Legacy null-cohort rows remain independent singleton cohorts.
- Manual multipart commits now allocate one cohort and one source identity per uploaded parent before parsing. Flex automation allocates its cohort and parent source before requesting/parsing the statement, records pull and whole-statement parse failures, and gives trade/position members the same parent source/artifact with distinct section identities. Successful, direct-failure, and rolled-back batches share one cohort timestamp and retain the Phase 4 notes markers for compatibility.
- A shared `getImportHistoryPage` contract selects deterministic cohort anchors by `importedAt` and `id`, returns every member of each selected cohort, and exposes an opaque cursor for older attempts. `/import` and `/settings` consume the same serialized cohort contract; the arbitrary 20-batch-row query and duplicated route adapters are removed.
- Shared history presentation now groups attempts, prefers persisted roles over legacy markers, shows source/section identity and explicit legacy/unknown metadata, distinguishes unavailable bytes from zero bytes, and wraps long filenames, parser versions, artifact keys, dispositions, and error messages. Desktop and 390px mobile checks prove both routes render identical batch IDs with no split/duplicate members or horizontal overflow.
- Backup export continues to include all Prisma scalar fields. Restore planning round-trips the new provenance fields, while validation accepts all-null legacy rows and rejects partial provenance, role/status conflicts, rolled-back cohorts without a direct failure, or one source identity drifting across cohorts/parent artifacts.
- Deterministic demo data now includes a successful two-section Flex cohort, a direct-failure plus rolled-back cohort, 21 older attempts, long audit values, and a legacy singleton so the pagination path is reviewable without real imports.
- Verification run: isolated-schema preflight and all 24 migrations passed; focused Phase 6 coverage passed 61 tests; `npm run test` passed 51 files and 329 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. The final freshly seeded Playwright run passed all 52 Chromium tests in 3.1 minutes, including route parity on desktop/mobile, complete cursor traversal, legacy rendering, no overflow, no framework overlays, no browser errors, and no import mutation during review.
- The package used only `trade_journal_phase6_test`; the normal/public schema was not migrated, seeded, imported into, or otherwise mutated. Deferred findings: row-error details retain the existing five-row preview, the upstream IBKR Flex reference code is not persisted because source attempts now use a durable local identity, and a dedicated cohort table/index can be considered only if personal history grows enough to make the current one-anchor-per-cohort scan material.
- Phase 5 was packaged in commit `0a5615a`. Phase 6 packaging was approved after localhost review and is included in this checkpoint commit.

### Previous Verified Iteration
- Phase 5 trustworthy execution reconciliation and import outcome pass.
- Three focused read-only audits traced execution identity, duplicate/correction behavior, row-count conservation, Flex commission matching, IDEALFX exclusions, and shared `/import` plus `/settings` wording. They agreed that parent order IDs could collapse distinct fills, absent charges were indistinguishable from zero, Flex parent-order commissions could be multiplied across fills, and successful history conflated all unapplied rows as skipped.
- Execution parsing now keeps strongest per-fill references (`IBExecID`, `TradeID`, and `TransactionID`) separately from parent order IDs. Canonical identity uses the per-fill ID when available, preserves compatibility with legacy fingerprints, rejects ambiguous same-file fallback collisions, and serializes reconciliation with transaction-scoped advisory locks.
- Exact archived-file retries preserve newer charges on existing executions while recreating genuinely missing executions. Matching execution corrections update only supplied commission/fee fields; absent charge columns cannot erase stored values. Same-file inserts, unchanged duplicates, and charge corrections are counted independently, and a matching source ID with different fill economics is rejected without changing the existing row.
- Flex commission details now match one fill by strong reference, use parent-order fallback only when exactly one execution is eligible, normalize signed IBKR costs, and record every detail as matched, excluded, unmatched, or ambiguous. IDEALFX execution rows are intentional exclusions rather than invisible drops, including exclusion-only files.
- Successful batches persist a versioned `[import-accounting:v1]` envelope in existing notes, so `rowsSeen = rowsImported + rowsSkipped` and every primary source row has one disposition: parser rejection, IDEALFX exclusion, unresolved reference, insert, charge correction, unchanged duplicate, position apply, or snapshot apply. No schema migration was needed.
- `/import` and `/settings` now use `applied` and `not applied`, show concise disposition badges, label successful materialized batches `Completed`, preserve accounting through materialization failures, and exclude failed/rolled-back cohorts from the settings count of imports with unapplied rows. The deterministic demo seed exposes the same ledger format.
- Focused coverage includes exact retries before and after corrections, missing-row recreation, distinct fills sharing parent/economic fields, same-file duplicates, supplied-field-only correction, mixed count conservation, Flex commission and IDEALFX outcomes, and multipart rollback after duplicate/correction work. Execution analytics refresh now locks parent execution rows before writing child analytics, closing a concurrent-delete foreign-key race exposed by the full suite.
- Verification run: isolated database preflight passed; `npm run test` passed 50 files and 321 tests; `npm run lint`, `npm run build`, and `git diff --check` passed. Final isolated-schema Playwright passed all 51 Chromium tests, including identical reconciliation text on `/import` and `/settings`, desktop/mobile overflow checks, no framework overlays, no browser errors, and no import mutation during review. One repeated browser run encountered a transient database `P1017` connection closure; the clean rerun with the separate review server stopped passed all 51 tests.
- The package used only `trade_journal_phase5_test`, introduced no migration, and did not seed or import into the normal/public schema. Deferred findings remain bounded to whole-statement Flex parent artifact identity and the 20-row history window for unusually large cohorts.
- Phase 5 was packaged in commit `0a5615a` after review. Phase 6 builds from that clean checkpoint.

### Previous Verified Iteration
- Phase 4 cohort-complete failure ledger and rollback-history pass.
- Three focused read-only audits traced multipart/Flex failure paths, transaction and raw-artifact durability, row-error/count truth, and shared `/import` plus `/settings` presentation. They agreed that fail-fast parse/preflight exits omitted valid siblings, runtime rollback copied the causal error onto every member, and separate audit writes could leave a partial ledger.
- Multipart parsing now settles every selected source before rejecting the cohort. Parse, preflight, and runtime failures send every member through one versioned failure-ledger path; valid siblings receive the exact `[import-history:v1:rolled-back]` marker while direct causes receive `[import-history:v1:failed]`.
- Failed-cohort artifacts, batches, counts, and each member's own row errors are persisted together in one transaction. Business rows still use the existing all-or-nothing transaction, failed or rolled-back rows always report zero imported, and malformed/circular audit payloads use valid sentinel JSON instead of controlling business-row success or erasing audit evidence.
- The shared history component now derives state only from exact markers: direct causes show `Failed`, siblings show `Rolled back`, marker envelopes stay hidden, rollback rows do not claim parser or duplicate skips, truncated row-error counts are explicit, and long filenames/messages/archive keys wrap. Both history queries use deterministic tie-break ordering, and settings labels the aggregate `Failed / Rolled Back Imports`.
- Focused tests cover valid executions rolled back by stale full snapshots, multipart parse and preflight rejection with valid siblings, Flex section rollback, exact counts/roles/artifact sharing, malformed audit payloads, and pure presentation behavior. The deterministic browser fixture proves `/import` and `/settings` render identical cohort text with no import mutation, horizontal overflow, framework overlay, or browser error.
- Verification run: focused Phase 4 tests passed with 25 tests; `npm run test` passed with 305 tests; `npm run lint`, `npm run build`, and isolated-schema database preflight passed. The first full Playwright run passed the new Phase 4 case and 48 others but sampled one unrelated chart geometry assertion while its workspace was still loading; that scenario passed alone from a clean seed, then the final complete run passed all 50 Chromium tests in 5.0 minutes.
- The package used only `trade_journal_phase4_test`, introduced no migration, and made no normal/public-schema seed or import. Deferred findings: a whole-statement Flex parse failure still has only a parent artifact identity, the 20-row history window can split a very large cohort without a schema-level cohort key, materialization-failure marking remains a separate lifecycle concern, and duplicate/FX/corrected-execution semantics remain outside Phase 4.
- `localhost:3000` was restarted on the verified production build without reseeding normal data. Signed-in read-only checks passed for `/import` and `/settings` at 1440x1000 with no horizontal overflow, framework overlay, browser console error, or page error.
- Phase 4 remains unstaged and uncommitted. Review `/import` and `/settings` on `localhost:3000`; approve packaging only after both surfaces read clearly.

### Previous Verified Iteration
- Phase 3 position-snapshot canonicalization and pruning-guard pass.
- Three focused read-only audits covered import transaction/lifecycle truth, partial/full reconciliation, and `/import` plus `/settings` review clarity. The selected correctness-first package addressed two destructive-boundary risks: impossible dates such as `2026-02-31` normalizing into later valid dates, and IBKR `STK` rows resolving to `OTHER` rather than the existing `STOCK` instrument identity.
- The IBKR parser now accepts supported date formats as deterministic UTC values, validates every calendar/time component by round trip, rejects ambiguous free-form dates, records supplied-but-invalid position dates as row errors, and recognizes positions, executions, and snapshots from discriminating headers instead of treating any `Quantity` file as executions.
- Broker asset aliases now canonicalize `STK`, `OPT`, `FUT`, `CASH`, and `FX` before instrument lookup. A DB-backed full-snapshot regression proves an incoming `STK` row updates the existing `STOCK` position, does not create an `OTHER` instrument, and prunes only the genuinely absent position.
- `/import` now explains invalid position rows before a full snapshot can be confirmed or committed. Deterministic browser coverage proves `2026-02-31` keeps `Validate & Import` disabled and sends no commit request.
- Verification run: focused parser/Flex/import/route tests passed with 29 tests; `npm run test` passed with 298 tests; `npm run lint`, `npm run build`, focused Playwright, and `git diff --check` passed; final isolated-schema Playwright passed all 49 Chromium tests.
- Desktop Chromium review at 1440x1000 passed for `/import` and `/settings` with no horizontal overflow, framework overlays, or browser errors. Evidence: `test-results/phase3-import-review.png` and `test-results/phase3-settings-review.png`.
- The complete package was tested only against `trade_journal_phase3_test`; no schema migration or production/demo seed change was made, and no files were staged, committed, or pushed. `localhost:3000` was restored on the verified production build without seeding normal data, and read-only signed-in checks passed for `/import` and `/settings`. Deferred audit findings include cohort-complete failed-import ledgers, explicit rollback/duplicate history states, FX-exclusion count reconciliation, and broader corrected-execution semantics. Next action is localhost review before selecting that next bounded package.

### Previous Verified Iteration
- 15M cached-candle reliability pass from localhost review feedback.
- Reproduced the reported failure against the real isolated API: switching seeded DEMOA to 15M returned HTTP 200 with zero candles, no source, and a visible `No candles returned` warning because demo data had cached 5M/1H/1D bars but no exact 15M rows, and mock symbols cannot be filled by Yahoo.
- The candle service still prefers exact-timeframe cache and native provider data. When exact 10M/15M cache is absent, it can now read the existing cached 5M bars, align the source range to the target bucket, aggregate deterministic OHLCV bars, and use those bars as the normal cache result or provider-failure fallback.
- Added unit coverage for exact 15-minute OHLCV aggregation and partial-cache provider failure, plus a browser regression that uses the real seeded candle API, changes an actual chart from 5M to 15M, and proves nonzero bars, a 900-second interval, fresh state, and painted output without persisting the test layout.
- Verification run: focused candle/route tests passed with 18 tests; `npm run test` passed with 294 tests; `npm run lint`, `npm run build`, and `git diff --check` passed; final isolated-schema Playwright passed all 48 Chromium tests.
- Before/after browser evidence: the baseline returned 0 bars; the fixed DEMOA request returned 500 cached 15M bars, `barIntervalSeconds: 900`, 4,008 painted pixel samples, and no browser errors. Screenshot: `test-results/timeframe15-after.png`.
- No schema, migration, seed, layout, annotation, import, metrics, backup, auth, or journal-model changes were made. `localhost:3000` was restored on the verified production build without reseeding normal data. Next action is user review before packaging or selecting another package.

### Previous Verified Iteration
- Phase 2 chart save-queue convergence pass.
- Three focused read-only audits independently confirmed the same correctness gap in layout and annotation persistence: when saved state `S0` changed to in-flight `S1` and the user reverted to `S0`, the queue compared the desired state only with the last saved signature and discarded the reversion. Annotation saves also retained a stale pre-debounce `S1` job after an immediate reversion.
- Layout and annotation queues now reconcile desired state against saved, queued, and in-flight state. `S0 -> S1 -> S0` now sends `PUT S1/version 10`, queues `S0`, then sends `PUT S0/version 11` from the first response and finishes at server version 12. `S0 -> S1 -> S2` still coalesces to the latest desired state.
- Annotation reversion before the debounce now cancels the stale pending job and sends zero PUTs. Successful saves remove only duplicate trailing jobs; differing latest intent remains queued. Failed saves retain the latest desired job for Retry, while existing `409` conflict and stale-write handling is unchanged.
- Added a small shared save-queue reconciliation helper with 6 focused unit tests and deterministic browser coverage for layout reversion, annotation preflight/in-flight reversion, failed-save retry, server-returned layout/drawing versions, exact final server payloads, reload durability, save indicators, navigation guards, and no extra trailing PUTs.
- Verification run: focused race pack passed; the annotation race passed 3 consecutive repeat runs after synchronizing the selected trade; `npm run test` passed with 292 tests; `npm run lint`, `npm run build`, and `git diff --check` passed; final isolated-schema Playwright passed all 47 Chromium tests.
- Desktop Playwright review passed for DEMOA and DEMOC at 1440x1000 with no browser errors. DEMOA rendered 1 fresh panel with 1,191 bars; DEMOC rendered 3 fresh panels with 2,014/672/93 bars. Every canvas was nonblank and every chart panel remained inside the viewport. Evidence: `test-results/phase2-demoa-desktop.png` and `test-results/phase2-democ-desktop.png`.
- The complete package was tested only against `trade_journal_phase2_test`. There were no schema, migration, import, metrics, backup, auth, or journal-model changes, and no files were staged, committed, or pushed. `localhost:3000` was restored on the current production build without reseeding normal data.
- Known limitations outside this package remain unchanged: avoidable chart subscription callback churn and the trade-filter action group's page-level horizontal overflow at 1440px are deferred. Next action is user review on localhost before selecting another bounded package.

### Previous Verified Iteration
- Phase 1 Focus/Show all chart lifecycle stability pass.
- Focused read-only audits identified chart reconstruction as the highest-impact smoothness issue: focusing a secondary panel and returning to all panels destroyed and recreated four chart instances, rebuilt 28 base series, repeated candle preparation, and transiently returned panels to loading state even though no new candle requests were needed.
- `ClosedTradeChartWorkspace` now keeps every keyed chart panel mounted in stable slots. `display: contents` preserves the established flat and nested `1+2` geometry, while Focus hides non-active slots without moving or unmounting their chart components.
- Browser lifecycle coverage now proves all original canvas nodes remain connected and identical through Focus/Show all, observes zero canvas-node mutations, preserves panel order and painted output, and emits no extra candle request or chart-layout PUT.
- The shared pan helper now waits for a published visible range and proves the gesture changed it before testing save behavior. This removes order-sensitive false passes/failures without weakening range persistence, save blocking, or stale-write assertions.
- The backup failure-path browser test now uses the same 30-second verification allowance as the successful real-backup path; the populated isolated schema consistently needs 16-18 seconds to generate the backup before the mocked verification response is reached. No backup product behavior changed.
- Verification run: focused chart unit tests passed with 15 tests; focused chart lifecycle/pan/save browser packs passed; `npm run test` passed with 286 tests; `npm run lint`, `npm run build`, and `git diff --check` passed; final isolated-schema `npm run test:e2e` passed with all 44 Chromium tests.
- Desktop and mobile Playwright review passed for DEMOA and DEMOC at 1440x1000 and 390x844. All `5m`/`1h`/`1d` panels reported fresh candles, non-zero bars, painted canvases, and no chart-panel clipping or overlap. Evidence: `test-results/phase1-demoa-desktop.png`, `phase1-democ-desktop.png`, `phase1-demoa-mobile.png`, and `phase1-democ-mobile.png`.
- Known limitations outside this package: the trade filter action group creates page-level horizontal overflow at 1440px even though the chart region stays contained; the mobile execution table remains horizontally scrollable. Deferred audit findings remain for an S0 -> S1 -> S0 queued-layout reversion edge case and avoidable subscription callback churn.

### Previous Verified Iteration
- Phase 0 safety preparation pass.
- Vitest and Playwright now fail closed unless both PostgreSQL URLs resolve to the same explicitly test-only host, database, and schema and `ALLOW_TEST_DATABASE_MUTATIONS=1` is set; Playwright also requires a loopback base URL.
- Deterministic demo seeding now requires an isolated test target or the exact shared-demo confirmation, removes generated closed-trade journal links on reset, prunes only unreferenced demo tags, and never clears backup audits on a shared database.
- Added a forward-only Prisma correction for import status defaults, stale-trade indexing, `updatedAt` defaults, and closed-trade execution uniqueness. The 13 previously applied workstation migrations remain byte-for-byte unchanged, and the correction was applied only to `trade_journal_phase0_test`, not `public`.
- Journal interactive transactions now use a 10-second acquisition wait and 30-second transaction timeout, resolving the four prior database timeout failures without changing stale-write behavior.
- Generated test reports, local editor settings, local database files, and exported backups are ignored; `.env.example` is visible to Git and contains sanitized PostgreSQL/test-safety guidance. Approved packaging removes `prisma/dev.db` from branch tracking while preserving the ignored local file. The tracked brokerage fixture remains unchanged pending a separate sanitization decision because an existing parser test depends on it.
- Verification run: fail-closed preflight and Vitest refusal passed; all 23 migrations deployed to the isolated test schema; deterministic seed reset passed after injecting a generated journal link; `npm run test` passed with 286 tests; `npm run lint`, `npm run build`, Prisma validation, and `git diff --check` passed; full `npm run test:e2e` passed with 44 Chromium tests.
- Packaging was approved on 2026-07-15 for a local `workstation-uplift` snapshot. Pushing the branch remains a separate approval gate.

### Previous Verified Iteration
- Candle cache read hardening and seeded context-panel coverage pass.
- Focused read-only audits found the DEMOA `DATA 0 bars`/loading concern was not a seed coverage or range-preset issue. Seeded DEMOA 5m/1h/1d candles exist for the review ranges; the weaker path was transient cache-read failure and quiet empty-payload handling.
- `loadCandlesForSymbol()` now retries a failed cached-candle read once before falling through to live providers, so a momentary Prisma/connection hiccup is less likely to strand demo or cached review charts in a no-data state.
- Chart panels now surface a visible `No candles returned for the requested range.` warning when an API payload succeeds but contains no usable primary candles, and compare panels get a clear empty-compare warning as well.
- Chart panel source and bar count now have stable test hooks, allowing route review to assert candle readiness without scraping display text.
- Browser coverage now proves the seeded DEMOA `/trades?account=DEMO-WORKSTATION&symbol=DEMOA` review panels finish fresh with non-zero candles on 5m, 1h, and 1d, and still requests all three timeframes.
- Verification run: focused lint passed, focused candle route/unit tests passed with 16 tests, focused route-review browser test passed, `npm run test` passed with 258 tests after rerunning one transient Flex timeout, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the current branch dev server with `NEXTAUTH_URL=http://localhost:3000`, demo data was reseeded, and browser verification passed on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`; DEMOA panels loaded `CACHE` data with 1191 5m bars, 672 1h bars, and 93 1d bars, the first chart canvas painted with 4005 sampled pixels, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-candle-read-hardening.png`.
- Next parked candidate: continue chart-workstation smoothness review from localhost feedback, likely around provider timeout budgets/status copy and any remaining roughness in pan/zoom or Focus/Show all transitions.

### Previous Verified Iteration
- Focus/Show all during range-only layout saves pass.
- Focused read-only audits found that the previous pending-range flush was not enough by itself: an earlier chart-panel cleanup could clear range drafts before the time-scale cleanup flushed them, and the Focus button still treated all layout saves as blocking even when the save only persisted `visibleFrom`/`visibleTo`.
- The earlier panel cleanup now leaves visible-range drafts intact for the time-scale cleanup, so pan/zoom drafts can be flushed before Focus/Show all or layout remounts.
- `ClosedTradeChartWorkspace` now tracks a structural layout signature that ignores saved visible ranges. Focus/Show all remains blocked for read-only states, drawing saves, and real structural layout edits, but it stays available while a range-only chart-layout save is pending or in flight.
- Browser coverage now proves a user can pan/zoom, immediately Focus the active chart, and still have the numeric visible range saved while trade switching remains blocked until the save settles.
- Verification run: focused lint passed, focused chart range browser tests passed with 4 tests, `npm run test` passed with 257 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the current branch dev server with `NEXTAUTH_URL=http://localhost:3000`, demo data was reseeded, and browser verification passed on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`; three chart panels rendered, Focus was enabled, the first chart canvas painted with 4005 sampled pixels, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-focus-range-save-smoke.png`.
- Next parked candidate: continue chart-workstation smoothness review from localhost feedback, likely around range-save status copy, context-panel no-data warnings, and any remaining roughness in pan/zoom or Focus/Show all transitions.

### Previous Verified Iteration
- Pending visible-range flush before chart remount pass.
- Focused read-only chart audits found a durability gap in `ClosedTradeChartWorkspace`: a pan/zoom range was only committed after a 600ms debounce. If the chart panel remounted before that debounce fired, for example from an immediate layout change after panning, cleanup cleared the pending range and the saved chart layout could lose the user's latest viewport.
- Chart panels now commit any pending visible range during subscription cleanup before clearing timers. The helper validates that the workspace is writable and that the range differs from the last committed range, then routes through the same `updatePanel(..., { userEdit: true })` path used by normal debounced range saves.
- Existing simple-click behavior remains unchanged: clicks that do not create a pending visible range still clear the interaction window without saving a layout.
- Browser coverage now extends the real pan/zoom range-persistence test: after a saved custom viewport survives reload and Focus/Show all, the test pans again, immediately switches to the single-panel layout before the debounce would normally fire, and proves the outgoing chart-layout PUT still carries numeric `visibleFrom`/`visibleTo` for panel 1.
- Verification run: focused lint passed, focused chart range browser tests passed with 4 tests, `npm run test` passed with 257 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the current branch dev server with `NEXTAUTH_URL=http://localhost:3000`, demo data was reseeded, and browser verification passed on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`; the structured review editor and three chart panels rendered, Focus was enabled, the first chart canvas painted with 4011 sampled pixels, no framework overlay or browser errors were detected, and screenshot saved at `test-results/localhost-3000-visible-range-flush.png`.
- Next parked candidate: continue chart-workstation UX refinement, likely range-save feedback copy/status specificity and whether local review controls can safely stay available after pending ranges are flushed.

### Previous Verified Iteration
- Deferred review editing lock pass.
- Focused read-only audit agents confirmed a data-safety gap in `ClosedTradesPanel`: deferred `Save & Next` and `Open/Create Journal` flows passed a pending state into the editor, but review text fields and tags still only honored read-only/conflict state. That meant late edits could be typed while the app was waiting for chart saves, then stranded as local dirty drafts right before auto-navigation.
- `StructuredReviewEditor` now disables all structured review fields and the tag input whenever the review surface is pending or read-only, while preserving existing button locks and read-only/conflict behavior.
- `Save & Next` now records the active structured-review field and restores focus to the same field after the destination trade opens, so the safety lock does not break the Ctrl/Cmd+Enter review rhythm.
- Browser coverage now proves deferred Save & Next behind a layout save locks Lesson, Tags, Save, Save & Next, and journal actions while waiting, unlocks after a canceled chart-save error, and preserves the keyboard Save & Next focus workflow.
- Browser coverage also proves deferred Open/Create Journal behind layout and annotation saves locks Thesis, Tags, Save, Save & Next, and the journal action until the chart save resolves.
- Verification run: focused lint passed, focused browser tests passed with 4 tests, `npm run test` passed with 257 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the current branch dev server and browser-verified on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`; the structured review editor and chart panels rendered, the first chart canvas painted with 4011 sampled pixels, no framework overlay or browser errors were detected, and screenshot saved at `test-results/localhost-3000-review-lock-iteration.png`.
- Next parked candidate: use localhost review feedback to choose the next chart-workstation refinement, with likely focus on pan/zoom smoothness, range-save feedback, and any remaining rough edges in the three-panel closed-trade review flow.

### Previous Verified Iteration
- All-fill marker safety and quiet demo coverage pass.
- Focused chart audit found a persistence safety gap: `Markers` could be enabled when only some trade executions had candle anchors. That allowed mixed saved annotations: reliable execution-lines for matched fills plus raw timestamp markers for fills the chart had already diagnosed as missing.
- `ClosedTradeChartWorkspace` now requires the active panel's execution anchor snapshot to cover every execution before enabling `Markers` or accepting a marker-storage click. The disabled title now explains that matching candles are needed for every fill.
- Marker storage no longer falls back to raw execution timestamps after the guard; saved marker and execution-line annotations are created only from aligned candle anchors.
- The partial-candle diagnostic browser test now proves the warning state disables `Markers`, while full-coverage marker tests still prove all three execution-line annotations are saved.
- Demo seed candles now span the actual default 5m trade and 1h context review ranges for DEMOA, DEMOB, and DEMOC, so seeded localhost review starts without spurious range-coverage/provider fallback warnings.
- Verification run: focused chart/candle tests passed with 24 tests, focused lint passed, affected browser tests passed, `npm run test` passed with 257 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA` plus DEMOC; all expected execution overlays rendered, `Markers` was enabled only in full-anchor states, no seeded range-coverage warnings appeared, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-marker-safety-demo-coverage.png`.
- Next parked workflow candidate: disable structured review fields and tags while deferred `Save & Next` or `Open/Create Journal` intents are waiting behind chart saves, so late edits cannot be stranded as local dirty drafts right before auto-navigation.

### Previous Verified Iteration
- Range-aware candle cache and demo execution coverage pass.
- Focused read-only chart audits confirmed that explicit closed-trade review ranges could be served from a count-only partial candle cache. If the cached slice missed execution bars, the chart considered the response fresh and execution overlays/Markers could disappear even though provider refill data might be available.
- `loadCandlesForSymbol()` now treats cached candles as immediately usable for explicit ranges only when the cached first/last bars cover the requested window within roughly one timeframe bar. Partial explicit-range cache now falls through to live providers first, then remains available as a warning-bearing fallback if providers fail.
- Provider warnings now correctly say cached candles are being shown when partial cached fallback rows exist after a provider failure.
- `/api/market/candles` route coverage now locks the explicit `from`/`to` plus `limit + 1` loader contract used by chart review ranges.
- Demo seeding now creates deterministic candle coverage across 5m/1h/1d demo trade windows and overrides execution bars so localhost review does not depend on network providers for seeded fills.
- Browser coverage for execution marker storage now also proves an explicit range request occurred, all three DEMOA fills render as overlays from a provider-style full response, Markers is enabled, and the first execution panel has no missing-candle warning.
- Verification run: focused candle/API tests passed with 15 tests, focused lint passed, focused marker browser test passed, `npm run test` passed with 257 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`; all three DEMOA execution overlays rendered, Store execution markers was enabled, no first-panel missing-candle warning appeared, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-candle-cache-range-refill.png`.
- Next parked candidate: audit chart/context warnings after the deterministic candle expansion and continue smoothing real-user review flow based on localhost feedback.

### Previous Verified Iteration
- Snapshot-consistent backup source metadata pass.
- Focused read-only audit found a backup trust gap: `GET /api/admin/backup` exported table rows inside a transaction, but calculated `manifest.source.latestDataChangeAt` afterward from a fresh database read. That could produce a backup whose rows and source signature represented different database moments.
- Backup export now reads all backup rows and the latest backup-relevant update timestamp through the same interactive `RepeatableRead` transaction, so table row counts and source freshness are generated from one consistent snapshot.
- `getLatestBackupRelevantUpdateAt()` now accepts a Prisma transaction client, allowing backup freshness checks to use the same transaction snapshot while preserving the default global-client behavior for settings health/readiness callers.
- The backup export transaction now declares an explicit timeout and max-wait budget. The first full e2e rerun exposed Prisma's default 5s interactive transaction timeout on the heavier backup path; the fix keeps snapshot consistency without making large local exports fail spuriously.
- Added route coverage proving the backup export uses `RepeatableRead`, passes the transaction client into the freshness helper, and keeps the extended transaction budget.
- Verification run: focused backup tests passed with 20 tests, focused lint passed, the three previously failing backup/browser cases passed, `npm run test` passed with 253 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/settings`; Download & Verify completed, backup freshness showed Current, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-backup-snapshot-consistency.png`.
- Next parked chart candidate: if a partial candle cache does not cover the explicit closed-trade review range, the candle API should fall through to live providers instead of returning a too-small cached payload that can hide execution markers.

### Previous Verified Iteration
- Deferred chart-save intent cancellation pass.
- Focused read-only audit agents confirmed the risky path: deferred `Open/Create Journal` and `Save & Next` trade-switch intents could survive a chart layout/drawing save error or conflict, then fire later after retry/reload even though the original intent was stale.
- `ClosedTradesPanel` now treats layout/drawing `error` and `conflict` save states as attention-required terminal states for deferred intents. It cancels pending journal opens and pending review switches, clears the Save & Next lock when appropriate, and shows `Chart save needs attention. Resolve it, then retry the action.` Queued/saving success paths still wait and replay normally.
- The chart workspace now emits terminal layout/drawing save states immediately when PUTs fail or conflict, and it uses refs for cross-save-state reads so those notifications do not retrigger workspace initialization or reset in-flight saves.
- Added stable chart workspace data attributes for layout/drawing save state, plus browser coverage proving drawing conflicts cancel deferred journal opens through Reload latest, layout errors cancel deferred Save & Next through Retry layout save, and the existing pending layout/annotation journal waits still work.
- Verification run: focused lint passed, focused deferred-intent browser tests passed with 4 tests, `npm run test` passed with 253 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 44 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION`; DEMOC chart panels rendered, chart save states were clean, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-deferred-intents-safety.png`.
- Next review target: on `/trades?account=DEMO-WORKSTATION`, try rapid chart edits, Open/Create Journal while saves are pending, and Save & Next around a chart save; confirm the new attention notice feels clear and retrying/reloading does not auto-navigate.

### Previous Verified Iteration
- Chart smoothness and stale-candle safety pass.
- Focused read-only chart audit identified delayed visible-range restores as a likely source of rough charting: resize/rAF/timer restore callbacks could snap the chart back while the user was already panning or zooming after load or Focus/Show all.
- Deferred/resize visible-range restores now skip while a visible-range interaction, pending range, or range-save timer is active, while still updating live range attributes and execution overlay positions.
- Candle reloads no longer blank the chart for same-trade timeframe/range changes. The previous chart stays painted while the new candle request is loading, but the panel is marked with `data-candle-fresh="false"` and direct drawing clicks are guarded until the current candle request is fresh.
- Added browser coverage proving charts stay painted and no drawing save lands during delayed timeframe reloads, plus coverage proving active panning during focused resize restore does not snap back before the visible-range save settles.
- Verification run: focused lint passed, focused chart-smoothness browser tests passed with 2 tests, `npm run test` passed with 253 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 42 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION`; DEMOC chart panels rendered, Focus/Show all toggled, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-chart-smoothness-iteration.png`.
- Next parked safety candidate from workflow audit: cancel deferred trade-switch/journal-open intents if a chart save enters `error` or `conflict`, so an old “open when save finishes” intent cannot fire after the user resolves/discards a failed chart save.

### Previous Verified Iteration
- Queued chart save self-conflict fix.
- Focused read-only audit agents confirmed that layout/drawing save B could be queued behind in-flight save A with an older version, then falsely 409 as a cross-tab conflict after save A advanced the server version.
- Chart layout and annotation PUTs now read the current version ref at flush time instead of carrying a snapshotted version inside queued jobs. The now-misleading `version` fields were removed from queued save job objects.
- When save A succeeds while save B is still queued, the workspace now keeps the relevant save state as `queued` rather than briefly reporting `clean`, preserving parent navigation/journal blocking until the queued save really flushes.
- Added two deterministic Playwright regressions proving queued layout saves send version `11` after a delayed version `10 -> 11` save, and queued direct drawing saves send version `21` after a delayed version `20 -> 21` save. The drawing test uses direct `Horizontal` annotations rather than marker generation so it isolates annotation-save queuing.
- Verification run: focused lint passed, focused queued-save browser tests passed with 2 tests, `npm run test` passed with 253 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 40 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION`; the DEMOC three-panel chart workstation rendered with a painted chart canvas, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-queued-chart-save-review.png`.

### Previous Verified Iteration
- Import HTTP-boundary rollback and history parity pass.
- Focused read-only audit agents compared the import HTTP boundary against the chart workstation. This iteration chose the import boundary because service-level atomic rollback was already implemented, but the actual multipart `/api/import` route still needed direct proof that it built one atomic pending batch across files.
- Added a DB-backed route regression at `src/app/api/import/route.test.ts` that posts two real multipart CSV uploads to `POST /api/import`: a valid execution file followed by a stale explicit full-position snapshot. The test proves the route returns `400`, no execution or new instrument from the first file lands, protected positions remain unchanged, both attempted batches are `FAILED`, raw artifacts remain archived, and materializers are not called.
- Added an unauthenticated commit route check proving auth rejects before demo-write checks, parsing, or materialization work.
- Fixed a small import-history parity gap: `/settings` now passes `positionSnapshotMode` into the shared `ImportHistoryList`, matching `/import`, so full/partial position badges stay visible in both review surfaces.
- The chart audit found the next likely safety package: queued chart layout/annotation saves can self-conflict if a second local save is queued behind an in-flight save with an older version. That is parked as the next high-impact chart reliability candidate.
- Verification run: focused route/import/Flex tests passed with 16 tests, focused lint passed, `npm run test` passed with 253 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 38 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/import` plus `/settings`; upload/history surfaces rendered, settings import history showed position-mode badges, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-import-route-boundary-settings.png`.

### Previous Verified Iteration
- Atomic multi-file import row-apply safety pass.
- Focused read-only audit agents selected the import durability gap: `/api/import` and Flex had been applying files/sections sequentially, so a later rejected item could leave earlier rows committed and mislabeled as materialization failures.
- Added `importParsedFilesAtomic()` in the shared import service. Raw artifacts are archived before the transaction, all row writes and `ROWS_APPLIED` batch updates for a commit happen inside one Prisma transaction, and materialization refresh still remains outside the row transaction.
- Failed atomic commits now create `FAILED` audit batches after rollback for every attempted file/section, preserving raw archive metadata, parser row errors, explicit position snapshot mode, rows seen/skipped, and the original rejection message.
- `/api/import` commit and `runFlexImport()` now use the atomic helper, so valid earlier files/sections roll back when a later full-position snapshot or invalid Flex section is rejected. `MATERIALIZATION_FAILED` remains reserved for rows that were actually written but post-row materialization failed.
- Regression coverage now proves a valid execution file is rolled back when a later stale full-position snapshot rejects, protected positions remain unchanged, attempted batches are all `FAILED`, raw artifacts remain archived, and Flex trades do not land when the later positions section fails.
- Verification run: focused lint passed, focused import/Flex tests passed with 14 tests, `npm run test` passed with 251 tests, `npm run lint` passed, `npm run build` passed, and direct full Playwright `npx playwright test --reporter=line` passed with 38 browser tests. The wrapper `npm run test:e2e` was clipped by the outer command timeout, then the same built/reseeded Playwright suite passed directly.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/import` plus `/trades?account=DEMO-WORKSTATION`; upload controls, durable import history, demo data, and the protected trades deep link rendered with no browser errors. Screenshot saved at `test-results/localhost-3000-import-atomic-iteration.png`.

### Previous Verified Iteration
- Journal outcome calculation dirty-state guard pass.
- Focused audit agents compared two safety targets: atomic multi-file imports and a journal outcome calculation data-loss path. This iteration chose the journal guard because it was a direct, bounded way the current editor could be force-replaced while unsaved work existed; the import atomicity package is queued as the likely next safety iteration.
- `Calculate` now refuses to run while the currently selected journal entry has unsaved form changes or pending charts, and shows a save-first message instead of calling the outcome calculation API.
- The guard also blocks calculation during an in-flight journal save, while leaving inbox calculations for other entries available because they do not force-replace the open dirty editor.
- The entry header `Calculate` button now respects broader journal busy state and carries a title explaining the save-first rule when the editor is dirty.
- Browser coverage now proves editing a journal, attaching a pending chart, and clicking `Calculate` sends zero `/outcome/calculate` requests, preserves draft text and pending chart state, then allows calculation with `expectedUpdatedAt` after an explicit Save Entry.
- Verification run: focused lint passed, focused journal safety E2E passed with 3 tests, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 38 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/journal?entryId=demo-journal-a`: dirty Calculate showed `Save Entry before calculating outcome.`, sent zero outcome requests, preserved the draft thesis, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-journal-outcome-guard.png`.

### Previous Verified Iteration
- Closed-trade review queue command bar pass.
- Focused audit agents selected a client-only review worklist because review completion existed per-row, but there was no fast way to act on incomplete, unsaved, no-journal, or completed review groups.
- Added a Review Queue bar above the closed-trade list with live Total, Needs Review, Unsaved, No Journal, and Complete counts derived from current drafts, saved drafts, and journal links.
- Queue jumps use the existing guarded trade-selection path, so dirty-review confirmations, review-save locks, chart-save blockers, and URL behavior are preserved; no storage schema or review-note API contract changed.
- During verification, a real chart data-safety race surfaced: quick trade switches could let old chart panels/drawings queue saves against the newly selected trade. Chart layout and annotation save jobs now carry their owning closed-trade group key and version, and save effects refuse to queue when loaded state belongs to a previous trade.
- Browser coverage now proves live queue counts update while editing structured review fields, dirty queue jumps prompt without saving, accepted jumps change selection, explicit Save is the only review-note POST, DEMOA chart panels remain DEMOA after queue jumps, and demo chart-layout PUT payloads are not cross-symbol contaminated.
- Verification run: focused lint passed, focused queue-plus-chart E2E passed with 2 tests, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 37 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION`: Review Queue showed 3 total / 3 complete, DEMOA opened with all three chart panels on DEMOA, review completion showed `Review 7/7`, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-review-queue-command-bar.png`.

### Previous Verified Iteration
- Dashboard cumulative P&L trust pass.
- Focused audit agents compared the next workflow package against remaining correctness risk; the selected package was dashboard cumulative chart semantics because correctness outranks review-queue polish.
- Gross Cumulative P&L now carries its own prior gross closed-trade baseline into filtered ranges, matching the baseline-carrying behavior already used by Cumulative Net P&L.
- Dashboard chart cards now expose stable non-visual summary attributes for point count, first value, and last value, giving browser tests deterministic evidence without relying on Recharts SVG labels.
- Unit coverage now proves a filtered range with prior trades carries the gross baseline into the first gross cumulative point while preserving net equity/drawdown behavior.
- Browser coverage now checks the custom-range dashboard card values plus Gross Cumulative P&L and Cumulative Net P&L first/last chart values derived from the backup payload.
- Verification run: focused dashboard unit tests passed with 7 tests, focused lint passed, focused rebuilt dashboard smoke E2E passed, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 36 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/dashboard?preset=custom&from=2026-06-17&to=2026-06-22`: Gross Cumulative P&L reported first `4459.76`, last `3949.78`, 3 points; Cumulative Net P&L reported first `2977.94`, last `2867.75`, 9 points; no browser errors were detected. Screenshot saved at `test-results/localhost-3000-dashboard-cumulative-trust.png`.

### Previous Verified Iteration
- Chart visible-range smoothness and restore pass.
- Focused audit agents identified two low-risk chart hot paths: live visible-range DOM writes during pan/zoom and repeated candle interval inference during execution alignment.
- Chart panels now RAF-coalesce live visible-range test/diagnostic attributes while leaving durable layout save debounce and trade-switch blocking unchanged.
- Saved viewport restore now tries the exact saved range first, falls back to clamped range only if needed, and reapplies after real ResizeObserver size changes so Focus/Show all preserves the saved viewport after geometry settles.
- Execution marker alignment now parses execution timestamps once and reuses a precomputed candle interval across offset candidates; chart overlays and candle diagnostics pass the prepared interval instead of rescanning candles.
- Browser coverage now proves a DEMOA pan/wheel gesture produces a single visible-range layout PUT, saves the final live range, reloads it, and keeps it through Focus/Show all; the existing visible-range save guard still blocks trade switches while pending.
- Verification run: focused helper unit tests passed with 11 tests, focused lint passed, focused chart E2E passed with 2 tests, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 36 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`: first-panel visible range changed after pan/zoom, the layout save settled, no browser errors were detected, and screenshot saved at `test-results/localhost-3000-chart-coalesced-range.png`.

### Previous Verified Iteration
- Closed-trade review completion progress pass.
- Focused audit agents identified the next bounded journaling workflow gap: the workstation showed save/read-only status, but not whether a closed trade's structured review sections were complete.
- Added a shared completion helper for the seven structured review sections: setup, thesis, entry, exit, mistake, lesson, and follow-up.
- The closed-trade list and structured review header now show advisory `Review X/7` badges, with missing-field titles; chart-focus review dock also carries the completion count.
- Completion updates from the live draft state, so clearing a field drops DEMOA from `Review 7/7` to `Review 6/7` before saving, then returns to `Review 7/7` when restored.
- No storage, API, chart-save, journal-link, or blocking semantics changed in this pass.
- Added browser coverage to the DEMOA workstation flow proving completion badges render in the list/header/dock and update live while editing `Follow Up`.
- Verification run: focused lint passed, focused DEMOA workstation E2E passed after rebuilding/reseeding, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 36 browser tests.
- Localhost `3000` was restarted on the rebuilt production server and browser-verified on `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`: DEMOA showed `Review 7/7` in both the row badge and structured review header, the chart region rendered, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-review-completion.png`.

### Previous Verified Iteration
- Closed-trade review keyboard navigation pass.
- Focused audit agents identified the least risky workflow improvement: add faster review navigation only inside the structured review editor, route it through existing Previous/Next callbacks, and keep global/chart keyboard handling untouched.
- The structured review header now shows a progress affordance such as `Trade 1 of 3`, so users can see where they are in the filtered review queue.
- Added scoped shortcuts: `Alt+ArrowUp` for Previous trade and `Alt+ArrowDown` for Next trade. They do not fire while focus is inside editable fields, and the buttons expose `aria-keyshortcuts` plus titles for discoverability.
- The shortcut path uses the same guarded callbacks as the buttons, preserving dirty-review confirmation prompts, review-save in-flight blocking, and chart layout/annotation save blockers.
- While stabilizing the full suite, Focus/Show all visible-range restore was also hardened to reapply the committed chart range across resize-settle frames instead of relying on a single animation frame.
- Added browser coverage proving shortcut dirty-draft prompts preserve local edits, `Alt+Up` resumes the previous trade after reload, shortcut navigation cannot bypass a review save in flight, and shortcut navigation cannot bypass pending chart layout saves.
- Verification run: focused shortcut/chart guard E2E passed, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 36 browser tests.
- Localhost `3000` was restarted on the patched dev server and browser-verified on `/trades?account=DEMO-WORKSTATION`: the review position moved from `Trade 1 of 3` to `Trade 2 of 3` with `Alt+ArrowDown`, the active URL updated, the shortcut metadata was present, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-review-shortcuts.png`.

### Previous Verified Iteration
- Chart viewport round-trip confidence pass.
- Focused audit agents confirmed the least intrusive path for reliable viewport verification: mirror lightweight-charts' live visible range onto the existing chart plot element without adding React hot-path state.
- Chart panels now expose observational `data-visible-time-range-*` attributes on `closed-trade-chart-plot`, including a ready flag and panel id, while keeping actual visible-range saves in the existing debounced layout persistence path.
- Visible-range attributes are updated from both time-range and logical-range chart callbacks, after saved-range restores, after reset, and cleared when candle data is empty, giving tests and diagnostics the live chart viewport rather than just saved panel JSON.
- Focus/Show all now reapplies the committed visible range after the layout resize so a saved review viewport survives focused-panel transitions.
- Added browser coverage that resets a DEMOA layout through the real chart-layout API, stubs deterministic candles, pans/zooms the 5M panel, proves the real API stores numeric `visibleFrom/visibleTo`, reloads the trade, and verifies the live chart viewport still matches through Focus and Show all.
- Verification run: focused viewport E2E passed, adjacent chart regression E2E passed, execution-label diagnostics E2E passed, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 36 browser tests.
- Localhost `3000` was restarted on the patched dev server and browser-verified on `/trades?account=DEMO-WORKSTATION`: the DEMOA chart opened, panel 1 reported a live visible range, execution labels rendered, no framework overlay appeared, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-viewport-roundtrip-review.png`.

### Previous Verified Iteration
- Chart Markers candle-freshness guard pass.
- Focused audit agents found a correctness risk in the chart workstation: changing timeframe/range could leave stale candle-derived execution anchors alive while the new candle request was still loading, allowing `Markers` to persist old 5M anchors as if they belonged to the current 1H/range view.
- Chart panels now track the exact candle request path that produced their loaded candles. Candle-dependent execution anchors are published only when that request matches the current panel symbol, timeframe, range, and compare settings.
- Parent-level execution-anchor snapshots are pruned when the matching panel changes, and stale execution overlay labels are explicitly cleared while candle data is not fresh.
- The global `Markers` command now disables/early-returns unless the active traded-symbol panel has fresh execution anchors for its current timeframe/range, with a clear wait title while candles load.
- Generated marker/line dedupe is now panel/symbol/timeframe-aware, so saving 1H execution markers is not blocked by existing 5M generated markers for the same executions.
- Added browser coverage delaying the 1H candle response, switching from 5M to 1H, proving no annotation save occurs while candles are loading, then proving `Markers` saves 1H-aligned execution lines after fresh candles arrive.
- Verification run: focused lint passed, marker freshness and adjacent chart regression E2E passed, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 35 browser tests.
- Localhost `3000` was restarted on the current production build and browser-verified on `/trades?account=DEMO-WORKSTATION`: the 5M/1H/1D chart panels rendered, the `Markers` command was available after fresh candles, and no browser errors were detected. Screenshot saved at `test-results/localhost-3000-marker-freshness-guard.png`.

### Previous Verified Iteration
- Settings backup freshness browser-confidence pass.
- Focused audit agents found the highest remaining settings confidence gap: route coverage allowed `Current|Needs Backup|No Verified Backup`, and the broad smoke clicked Download & Verify without first forcing a deterministic stale source state.
- Added a reversible E2E freshness sentinel that creates a temporary journal entry after recording a fresh backup audit, making `/settings` reliably show `Needs Backup` without damaging closed-trade demo data.
- Added route-browser coverage proving the real `Download & Verify` button downloads a backup, records verification, refreshes `/settings`, and moves the server-rendered freshness card to `Current` with latest verified timestamp, SHA, size, and covers-through values.
- The sentinel is deleted in test cleanup so demo review data remains clean; no production code was changed in this pass.
- Verification run: focused spec lint passed, focused settings route E2E passed with 3 tests, full route-review E2E passed with 14 tests, broad workstation smoke check passed, `npm run test` passed with 250 tests, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 34 browser tests.
- Localhost `3000` was restarted on the current production build and browser-verified on `/settings`: the settings page rendered with no framework overlay or console/page errors and currently shows `Needs Backup` before verification. Screenshot saved at `test-results/localhost-3000-settings-freshness-ready.png`.

### Previous Verified Iteration
- Backup source metadata verification hardening pass.
- Focused audit agents found the highest backup-trust risk: `/api/admin/backup/verify` could record a `BackupAudit` even when `manifest.source` was missing or self-inconsistent, leaving `/settings` able to rely on a legacy timestamp fallback for new weak audits.
- Backup verification now requires source metadata before writing an audit row. It rejects missing/tampered `manifest.source`, source row counts that differ from the backup table manifest excluding `backupAudits`, and `latestDataChangeAt` values after `exportedAt`.
- Newly verified current-format backups now record non-null `BackupAudit.sourceSignature`, full source row counts, and source latest-change timestamps.
- Added route tests for missing source metadata, tampered source signatures, source/table row-count mismatch, and source latest-change-after-export rejection; all prove no audit row is created and `/settings` is not revalidated on failure.
- Verification run: focused verify-route test passed with 9 tests, focused backup server pack passed with 50 tests, `npm run build` passed, focused settings route E2E passed with 2 tests, real Download & Verify smoke path passed, `npm run test` passed with 250 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 33 browser tests.
- Localhost `3000` was restarted on the current production build and browser-verified on `/settings`: the settings page rendered with no framework overlay or console/page errors and currently shows `Needs Backup` before verification. Screenshot saved at `test-results/localhost-3000-settings-source-metadata.png`.

### Previous Verified Iteration
- Journal entry save-in-flight lock pass.
- Focused audit agents found a concrete journaling data-safety risk: `saveEntry()` snapshotted pending charts and later replaced the full pending list, while stage-mode `Attach Chart` and entry/navigation controls could still be used during a slow entry save.
- Added an explicit `entrySaveInFlight` lock in `JournalWorkspace`, with a visible test hook, semantic busy state, and targeted disabled states for Save Entry, Delete, New Idea, entry tabs, pending-chart caption/removal, and stage-mode `Attach Chart`.
- `stageChart()` now refuses late chart staging while the entry save lock is active, and pending chart cleanup removes only charts attempted by that save, preserving any unattempted pending charts defensively instead of replacing the entire list.
- `JournalChartEditor` now accepts a `disabled` prop and prevents stage/persist saves when the parent journal save lock is active.
- Added a Playwright regression that holds `PATCH /api/journal/demo-journal-a` open, proves navigation/chart staging controls are locked while the save is in flight, releases the save, and proves the workspace unlocks.
- Verification run: focused lint passed, focused journal route/stale-save unit pack passed with 14 tests, focused in-flight lock E2E passed, broader journal workspace E2E pack passed with 5 tests, `npm run test` passed with 246 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 33 browser tests after rebuild and demo reseed.
- Localhost `3000` was restarted on the current production build and browser-verified on `/journal?entryId=demo-journal-a`: the journal workspace rendered, no framework overlay appeared, no console/page errors were detected, and the save lock state was idle. Screenshot saved at `test-results/localhost-3000-journal-save-lock.png`.

### Earlier Verified Iteration
- Markers-to-Journal annotation-save guard coverage pass.
- Focused read-only audit agents confirmed the production flow is intentionally wired through the existing chart save activity channel: `Markers` updates annotations, the chart workspace emits `annotationSaveState: "queued"` as blocking, and `Open/Create Journal` waits until chart save activity is clean before POSTing the journal bridge.
- Added a Playwright regression proving the exact intersection: click `Markers`, hold the non-empty `PUT /api/closed-trades/:groupKey/annotations` open, click `Open/Create Journal`, assert no journal bridge request while drawings are saving, release the annotation save, then assert exactly one journal bridge POST and navigation to `/journal?entryId=demo-journal-a`.
- The test also tolerates and drains any prior empty/no-op annotation PUT before holding the real marker payload, which matches the observed browser timing during the first focused run.
- Verification run: focused lint passed, focused annotation-save journal wait E2E passed, adjacent chart/journal E2E pack passed with 4 tests, `npm run test` passed with 246 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 32 browser tests after rebuild and demo reseed.

### Earlier Verified Iteration
- Chart Focus/Show all identity and stable candle-range pass.
- Focused audit agents found a concrete smoothness issue: focusing a secondary panel could briefly reuse panel 1's local chart state, and Focus/Show all could ask for duplicate candle URLs because some range presets used render-time `Date.now()`.
- Chart panels now carry explicit stable keys across the focused and `1+2` render branches, preventing React from reusing the wrong panel instance during Focus/Show all transitions.
- Lightweight chart instances no longer tear down just because the panel size mode changes; the chart is created once per panel instance and resized through the existing resize observer.
- Closed-trade candle range presets `1M`, `3M`, `1Y`, and `YTD` are anchored to the trade close instead of the current clock, so the same closed-trade review produces stable candle request keys and cache hits.
- Browser coverage now proves Focus/Show all of the secondary 1h panel preserves 5m/1h/1d order, causes no layout save, and does not create duplicate candle network requests after the charts have settled.
- The layout-save guard test now chooses a different timeframe from the current panel state before asserting a pending layout save, avoiding order-dependent false failures in the full suite.
- Verification run: focused lint passed, focused chart route E2E passed, adjacent chart E2E pack passed with 4 tests, focused chart unit pack passed with 9 tests, `npm run test` passed with 246 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 31 browser tests after rebuild and demo reseed.
- Live localhost verification passed on `/trades?account=DEMO-WORKSTATION`: selected DEMOA, settled all three charts, focused the 1h panel, showed all panels again, confirmed exactly 3 candle request keys with no Focus/Show all refetch, no console/page errors, and panel order `panel-1:5m`, `panel-2:1h`, `panel-3:1d`. Screenshot saved at `test-results/localhost-3000-chart-identity.png`.

### Earlier Verified Iteration
- Journal hydration and Bias-label polish pass.
- Focused audit agents confirmed the observed hydration warning was an external/browser `caret-color` mutation on journal inputs/textareas rather than app-authored style, and that no chart-workstation correctness blocker outranked this pass.
- `/journal` now passes a stable server-generated `initialNowIso` into `JournalWorkspace`; blank journal entry and review forms use that stable value for initial hydration instead of render-time `new Date()`.
- The persisted Notion relation key remains `BAIS`, but the visible label and label map now display `Bias`.
- Added targeted `suppressHydrationWarning` to journal-owned input/textarea controls affected by the external caret-style mutation, without applying suppression app-wide.
- Added schema coverage proving the legacy `BAIS` key displays as `Bias`, and route-browser coverage proving `/journal?entryId=demo-journal-a` hydrates with no caret-color style artifacts and no visible `Bais` label.
- Verification run: focused journal schema test passed with 11 tests, focused edited-file lint passed, focused journal route E2E passed, adjacent journal workflow E2E passed with 3 tests, `npm run test` passed with 246 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 31 browser tests.
- Live localhost verification passed on `/journal?entryId=demo-journal-a` after reseeding demo data: Thesis hydrated, Notion shows Bias, there were zero caret-color artifacts, no console/page errors, and no failed requests. Screenshot saved at `test-results/localhost-3000-journal-hydration-polish.png`.

### Earlier Verified Iteration
- Backup freshness trust pass.
- Focused audit agents confirmed `/settings` had real storage health/backup coverage but backup freshness could be too optimistic because several timestamped backup-relevant tables were omitted from `getLatestBackupRelevantUpdateAt()`.
- Backup freshness now uses a shared timestamp-source contract covering timestamped backup tables while still excluding `BackupAudit`, so verifying a backup does not stale itself.
- Added a schema-backed unit test that fails if a contracted timestamped backup table is exported without contributing to freshness.
- `/api/admin/backup/verify` now revalidates `/settings` after recording a successful audit.
- `/settings` is explicitly dynamic and now shows persistent Latest Verified SHA and Latest Backup Size tiles.
- `Download & Verify` now preserves the verified action result in session storage and automatically refreshes `/settings`, so the freshness panel moves from Needs Backup to Current without a manual reload.
- Verification run: focused backup route/freshness tests passed with 12 tests, focused lint passed, focused settings route E2E passed with 2 tests, focused full smoke backup path passed, `npm run test` passed with 245 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 31 browser tests.
- Live localhost verification passed on `/settings`: before verification it showed Needs Backup; after Download & Verify it downloaded, auto-refreshed, showed Current, and displayed a recorded SHA. Screenshot saved at `test-results/localhost-3000-settings-backup-freshness.png`.

### Earlier Verified Iteration
- Chart overlay pan/zoom smoothness pass.
- Focused audit agents confirmed the execution-overlay hot path was still pushing coordinate-only visible-range changes through React state and that browser coverage proved label survival but not geometry movement.
- Execution overlay identity/text still belongs to React, but coordinate-only changes now update SVG leader lines and label transforms imperatively through refs inside the existing requestAnimationFrame path.
- Overlay labels now use `translate3d(...)` with `will-change: transform`, while React state updates only when overlay identity/text/side/price changes.
- Added `execution-overlay-line` test hooks and E2E geometry snapshots proving overlay IDs/text remain visible and at least one label or leader-line coordinate changes after pan/zoom.
- Verification run: focused component/E2E lint passed, fresh-build focused execution-label E2E passed, adjacent pan/range E2E pack passed with 2 tests, `npm run test` passed with 244 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 31 browser tests.
- Live localhost verification passed on `/trades?account=DEMO-WORKSTATION`: selected the DEMOA closed trade, panned/zoomed the first chart, confirmed execution overlay geometry moved with no browser console errors or failed requests. Screenshot saved at `test-results/localhost-3000-chart-overlay-smoothness.png`.

### Earlier Verified Iteration
- Closed-trade journal save-guard pass.
- Focused audit agents found two high-value issues: execution overlay movement still has a React-state hot path during pan/zoom, and Open/Create Journal could navigate away while chart layout/drawing/range saves were pending. The safety issue was chosen first.
- `Open/Create Journal` now queues behind pending chart workspace saves, shows a clear workspace notice, sends no journal bridge request while chart saves are blocking, and opens the journal automatically after the save state is clean.
- Chart workspace save activity is now reported to the parent immediately when layout or drawing saves are queued, closing a one-render race in guard behavior.
- Added browser coverage proving a delayed chart layout save blocks journal bridge POST/navigation until the layout save resolves.
- Verification run: focused component/E2E lint passed, focused journal-save-guard E2E passed, adjacent chart-save regression pack passed with 4 tests, `npm run test` passed with 244 tests, `npm run lint` passed, and full `npm run test:e2e` passed with 31 browser tests.
- Live localhost verification passed on `/trades?account=DEMO-WORKSTATION`: a delayed chart layout save kept the page on `/trades`, showed "Chart workspace is still saving. Opening journal when chart save finishes.", sent zero journal bridge requests until release, then navigated to `/journal?entryId=demo-journal-a`. Screenshot saved at `test-results/localhost-3000-journal-waits-for-chart-save.png`.
- Residual observation: the live `/journal` page emitted an unrelated hydration warning about server/client attributes on an input/textarea style. It did not fail the browser checks, but should be reviewed during a future polish pass.

### Earlier Verified Iteration
- Chart candle provider resilience pass.
- Focused audit agents confirmed the core route/UI shape now contains provider failures as warning payloads and flagged two gaps: empty-candle warning coverage and silent configured-Alpaca failures.
- `loadCandlesForSymbol` now treats cache-read failures as non-fatal, falls through to live providers, and returns explicit cache warnings instead of raw route failures.
- Configured Alpaca non-OK or empty-bar responses now produce provider warnings while unconfigured Alpaca remains silent. Alpaca live bars still render if cache persistence fails, with a cache-update warning.
- `/api/market/candles` now catches unexpected loader rejections, including compare-symbol loader failures, and returns a stable `200` candle payload with metadata warnings rather than rejecting the whole chart request.
- `/trades` E2E coverage now includes the exact `200` + empty candles + provider warning contract, proving the chart footer shows the warning without a fatal candle-load message.
- Verification run: focused candle service/route tests passed with 11 tests, focused lint passed, focused chart E2E passed with 2 tests, `npm run test` passed with 244 tests after rerunning one contention timeout cleanly, `npm run lint` passed, `npm run build` passed, and full `npm run test:e2e` passed with 30 browser tests.
- Live localhost verification passed on `/trades?account=DEMO-WORKSTATION`: after selecting a demo trade, 3 chart panels rendered with chart warning surfaces and no console, page, or 500-response errors. Screenshot saved at `test-results/localhost-3000-chart-reliability-check.png`.

### Earlier Verified Iteration
- Durable backup audit and freshness pass.
- Read-only audit agents confirmed `/settings` had readiness and transient browser verification state, but no persistent record that a backup had been verified after the latest data change.
- Added `BackupAudit` with a migration, plus backup source metadata that excludes audit rows from freshness so a successful audit does not make itself stale.
- Backup exports now include a source signature in the manifest; successful authenticated `/api/admin/backup/verify` writes an audit row with SHA-256, export/verify times, payload bytes, table/row counts, warning/error counts, and source signature metadata.
- `/settings` now shows Backup Freshness, Latest Verified Backup, and Backup Covers Through. It compares the current source signature to the latest verified audit, falling back to export-time coverage for legacy audits without a source signature.
- `Download & Verify` now reports “Verified and recorded” and uses the server-recorded audit timestamp/counts.
- Verification run: Prisma client generated, migration applied locally, focused backup tests passed with 34 tests, focused lint passed, `npm run test` passed with 237 tests, `npm run lint` passed, `npm run build` passed, focused settings E2E passed, and the main smoke backup path passed.
- Full `npm run test:e2e` passed 28/29, with one chart test failing on an external Yahoo candle-fetch `ECONNRESET`; the failing chart test passed on immediate isolated rerun. The following chart provider resilience iteration addressed this failure mode.
- Live localhost verification passed on `/settings`: before verify it showed “Needs Backup”; after Download & Verify and reload it showed “Current”, with a recorded SHA and no browser errors.

### Earlier Verified Iteration
- Login/deep-link 404 guard pass.
- Investigated the reported post-login 404 and reproduced the likely failure mode: encoded protected URLs like `/trades%3Faccount%3DDEMO-WORKSTATION` produced a double-encoded login callback that could land on a literal encoded path after sign-in.
- Added proxy canonicalization so encoded query paths repair to the normal route before auth: `/trades%3Faccount%3DDEMO-WORKSTATION` now redirects to `/trades?account=DEMO-WORKSTATION`.
- Hardened the login callback sanitizer to decode stale encoded local callback values while still rejecting external, auth, login, protocol-relative, and backslash-containing callbacks.
- Added Playwright regression coverage for encoded protected review links and stale double-encoded login callbacks.
- Verification run: focused lint passed, `npm run build` passed, focused Playwright regressions passed with 2 tests, and direct localhost browser verification passed for normal, encoded, and stale encoded `/trades?account=DEMO-WORKSTATION` login flows with no console errors or failed requests.

### Earlier Verified Iteration
- Chart execution-line marker polish pass.
- Read-only audit agents reviewed the marker/annotation implementation and the least brittle verification strategy. The chosen package was persisted execution-line drawings because it makes the chart workstation more useful for closed-trade execution review without changing storage schema.
- The `Markers` action still stores BUY/SELL point markers, but now also stores one `execution-line` annotation per fill when that fill can be aligned to a candle on the active traded-symbol panel.
- Execution-line annotations use the same candle-alignment path as floating execution labels, include stable `sourceExecutionId` metadata for dedupe, and draw as short forward partial line segments instead of becoming extra square markers.
- Existing annotations are preserved when markers are added; unmatched fills keep the existing marker behavior but skip unreliable line creation.
- Added Playwright coverage proving the annotation save payload contains three aligned DEMOA `execution-line` annotations, preserves an existing drawing, and stores side-colored forward line points without relying on canvas pixels.
- Verification run: focused lint passed, `npm run build` passed, focused marker E2E passed, `npm run test` passed with 233 tests, `npm run lint` passed, and `npm run test:e2e` passed with 27 browser tests after demo reseeding.
- Live localhost verification passed for `/trades?account=DEMO-WORKSTATION&symbol=DEMOA`: clicking `Markers` generated 3 non-destructive `execution-line` annotations in the intercepted save payload, with no browser console errors or failed requests.
- Live localhost screenshot saved at `test-results/local-execution-lines-markers.png`.

### Suggested Remaining Iterations
1. User localhost review of `http://localhost:3000/trades?account=DEMO-WORKSTATION`: confirm 5M/1H/1D remain painted, rapid timeframe and symbol changes settle cleanly, dense execution labels stay inside the charts, comparison add/remove never shows stale data, and pan/zoom plus Focus/Show all remain smooth.
2. On `/trades`, make a structured review field dirty and try a sidebar link, Apply filter, browser Back, Next, and Save & Next. Confirm canceled navigation preserves the draft, accepted navigation proceeds, and Save & Next leaves the selected trade in the URL after reload.
3. Review `/dashboard?preset=custom&from=2026-06-17&to=2026-06-22`, `/trades?account=DEMO-WORKSTATION&from=2026-06-18&to=2026-06-18`, and `/calendar?view=month&date=2026-06-18` for the reconciled demo totals and loss day.
4. Review `/journal?entryId=demo-journal-a`: open Capture, load the chart, focus the range selector, use Arrow/Shift+Arrow/Ctrl+Arrow, then verify source-trade navigation and the existing save/delete/chart conflict states.
5. Review `/import` and `/settings` on desktop/mobile, including history parity, backup freshness, expandable warnings, and storage health.
6. Select the next bounded package only after localhost feedback, then prepare final branch handoff notes when the review backlog is accepted.

## Original Backlog Notes
## Dashboard
- Done in workstation uplift: reworked Gross Cumulative P&L and Cumulative Net P&L chart baselines for filtered dashboard ranges.

## Trades
> Make buy/sell bubbles slanted up instead of horizontal. do not use horizontal line, but partial line from when the entry was made. remove left side line
> Instead of having to change timeframes on a single chart, display 3 charts for 5 minutes, 1 hour and 1 day timeframes
> Format standard sub-categories for Notes section
- Check SMAs, only have 3 instead of 4 requested (10,20,50,200)
> Increase number of lookback days for static fallback, but allow for 
- Increase date size for each day on closed trades
- Remove execution prices (intra-day) graph
- Change how charts of 'closed trades' are displayed:
> Add green/red horizontal lines on chart for executions
- Change note-taking feature to a template format, remove 'List' option
- Add feature to tag 'closed trades'
- Add feature to collapse or open all of the charts of the current 'Closed Trades' (limit to 20 (?)) on the page

## Positions

## Calendar

## Import

## Settings

## General
> Have a database storage check, as putting in more notes overtime might afect storage requirements
> Have downloadable backup for Closed Trades section
- Dark mode toggle
