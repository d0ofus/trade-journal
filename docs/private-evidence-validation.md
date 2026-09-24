# Private evidence and peer comparison validation

## Status — 24 September 2026

Implemented locally in `D:\Python\trade-journal` and validated in an isolated Vercel Preview. The user authorized committing and pushing the release to `main` on 24 September; its automatic production build applies the additive migration. The initial release retains disabled R2 writes and maintenance pending explicit cutover approval. The private **non-production** R2 bucket and dedicated Neon test database are provisioned and tested. The pre-existing drawing-visibility work remains intact. This record describes pre-release validation, not confirmation of production deployment.

R2 writes and maintenance default to disabled. This is not approval to enable production writes.

## Remaining-gates pass — completed

- Next.js **16.3.6**, NextAuth **4.24.15**, Vitest/coverage **4.1.11**, CSV Parse **7.0.2**, and vulnerable transitive dependencies updated. Full and production-only `npm audit`: **zero vulnerabilities**. Prisma remains 6.19.3 with a scoped `@prisma/config` override to DeepmergeTS 8.0.0; its Map/type changes do not affect this repository's plain configuration. Generation, migrations and regressions passed; no forced Prisma downgrade or authentication major-version migration.
- Full Vitest: **893 passed in 124 files**. Five opt-in analytics cases were initially skipped, then passed when that seven-case suite was rerun with its database flag. The separate clean-database asset suite passed nine tests (part of the repeated 34-case storage run); all 69 workstation node tests passed. Combined unique coverage: **976 passing tests**.
- That broad run initially exposed five backup failures: missing classification of temporary `EvidenceBackupSession`, undocumented operational timestamp exclusions, and backup API mocks missing the new models. Fixed and reran the entire run successfully.
- Latest focused TypeScript, changed-file ESLint (zero warnings), diff checks and optimized production compilation passed with the updated dependencies. Browser results in the earlier table below **predate these upgrades** and are not claimed as rerun results.
- Latest focused TypeScript and changed-script/browser-test ESLint passed again after live validation. Current-file repository safety: **620 candidate versions, zero findings**; all **22 scanner tests** passed. The manual launcher's passwordless loopback test URL has an exact-file-hash allowance; secret detection rules were not weakened. No history remediation was performed.
- CLI deployment archives do not include Git metadata. The initial Preview build exposed the scanner's Git-only discovery assumption. Vercel builds now explicitly scan unpacked source with the same rules and exact-hash allowances; uploaded secrets cannot escape by appearing in `.gitignore`. Normal local/index scanning still fails closed on Git errors. `.vercelignore` excludes local secrets, backups, generated files and private financial exports. The corrected Preview build passed compilation, full TypeScript and optimized output.
- Vercel and Cloudflare login verified. Created only `trade-journal-evidence-nonproduction`, Standard/Oceania hint. Public managed domain disabled; no custom domains. CORS allows exactly `http://127.0.0.1:3101` and the tested Preview origin below. No original/thumbnail lifecycle deletion. Global Preview writes/maintenance remain disabled; only the isolated deployment enables writes. No other bucket policies were changed.
- Real R2 metrics passed the application parser: **7,166,679,120 Standard bytes**, zero Infrequent Access, measured **2026-09-24 03:46:38 UTC**. This initial probe used the existing local management token read-only. The separately supplied deployment metrics token was subsequently verified as recorded below.
- Notion identity and the target data source returned HTTP 200 (45 properties). Actual workspace allowance: **5,242,880 bytes per file**. Publishing must clearly block larger app-accepted originals rather than reduce quality.
- Transaction-consistent production backup at **2026-09-24 03:44:37 UTC**: **15 workstation reviews, 45 images / 11,368,107 original bytes, 42 assignments and 3 unassigned images**. No invalid images, dangling assignments or externally stored standalone screenshots. Assignments were read from linked journal template data as well as workstation JSON.
- Restored the **35,214,624-byte** dump into a new local `trade_evidence_production_20260924_restore_test` database. All 57 table counts, complete note/scalar rows, legacy drawings, standalone journals, assignments and image checksums matched. Rehearsed the additive migration **only on that local copy**: exactly five empty tables and one migration record added; original preservation checks still matched.
- Verified backup: `backups/pre-r2-TdTb1y/postgres.dump` and `preservation.json`, both ignored by Git. Keep both securely. This snapshot includes images while they remain inline; after R2 cutover a database-only dump is incomplete. Repeat the audit/backup before rollout: journal edits continued between read-only snapshots.

Upgrade references: [Next.js fix](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [NextAuth patch](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh), [CSV Parse changelog](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md), [DeepmergeTS compatibility/security notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).

## Passed local checks

| Check | Result and scope |
| --- | --- |
| Workstation node suites | 69 tests: visibility snapshots, existing drawing geometry, history/navigation, document validation, demo persistence and exports |
| Provider regressions | 122 tests in 12 files: includes peer batching/cache/cancellation/provider behavior, ticker-specific background split metadata, and promotion when a workspace request joins shared metadata work |
| Image storage suites | 34 tests in 5 files: image quotas, schema-1 compatibility, arrangements, IndexedDB/recovery, signed requests/isolation, account metrics and isolated PostgreSQL asset lifecycle |
| Persistence/Notion/backup/storage/export regression run | 56 tests passed before the two additional private-asset Notion cases; those new cases and existing publisher tests subsequently passed (23 total publisher tests) |
| Final publisher/API/restore-plan run | 32 tests in 3 files: exact original PNG bytes sent to mocked Notion, one upload reused across sections, frozen asset references, allowance failures, API authentication/origin checks and backup restore plans |
| Evidence browser workflows | 7 scenarios passed: every section, reload, replay, PNG/JPEG/WebP, clipboard versus text paste, invalid uploads, recovery and trade-navigation cancellation |
| Drawing/fullscreen/peer browser workflows | 19 scenarios passed: all peer drawing tools, ray dragging, locks, Escape cancellation, local undo/redo, retained temporary hiding, 50-peer virtualization, arrangements, combined capture, normal/fullscreen restoration, mobile controls and capture DPR 1/1.25/2/3 |
| PostgreSQL migration | All 32 migrations applied only to newly created local disposable databases; no production migration |
| Complete restore | A consistent backup was restored into a second empty local `trade_evidence_restore_test` database. Original checksums and all restored table row counts matched. A second restore correctly refused the populated target. Object transport was mocked; no live R2 bucket was used. |
| Static validation | Focused TypeScript validation, changed-file ESLint, whitespace/diff checks and current-file repository-safety scan passed |
| Production compilation | Local optimized Next.js production build passed; this does not constitute a deployed-preview check |

Browser failures found during development were fixed and rerun: lazy thumbnails needed viewport-aware assertions; mobile floating controls required an explicit stacking level. No chart dimensions were increased or reduced to fix these issues.

After the user's manual authenticated-server launch, the two private-evidence browser scenarios also passed three consecutive repetitions (six executions, 39.6 seconds). Focused TypeScript, the changed browser test's ESLint check, diff checks and the 617-candidate current-file safety scan passed again. No application-source changes or production deployment were needed for the autosave-polling test correction.

The 34-test storage run was repeated with the patched direct Sharp dependency. A generated PNG above 4,500,000 bytes survived upload finalization and metadata-only database save/reload. Mock-object retrieval, portable export and mocked Notion upload checksum checks preserve original bytes; no original-quality reduction was introduced.

## Live release gates — passed

- **Authenticated application browser — passed after manual launch:** the user started the isolated server using Node 22.23.2. Both `tests/workstation-auth/private-evidence.spec.ts` scenarios passed (12.4 seconds): authentication/origin enforcement, original above 4.5 MB, editing during upload, metadata-only save/reload, shared section assignments, SHA-256-identical ZIP export and old-tab rejection. The first run exposed an assertion that dereferenced an assignment before autosave completed; optional chaining now lets polling await the saved assignment. Real auth/review APIs and PostgreSQL were used; object transport remains mocked. No launch-policy bypass was attempted.
- **Live private R2:** the actual bucket-scoped credentials passed browser preflight and direct transfer of a **4,688,806-byte** PNG. Signed Content-Length rejected a wrong-size body (403); repeating an immutable PUT returned 412. Unsigned access was denied (400, R2's missing-auth response), expired signatures returned 403, and untrusted origins received no CORS authorization. Final original and thumbnail retrieval passed; original SHA-256/bytes were identical. Only this probe's generated object keys were removed.
- **Live persistence/recovery/retention:** actual R2 upload-status recovery, reuse of client keys, idempotent finalization, wrong-owner denial and same-trade hash deduplication passed. A review above 4 MB saved only metadata. Seven-day unreferenced retention, backup pins, abandoned/redundant uploads and cleanup passed on synthetic records. Real R2 originals survived complete backup and restore into an empty local `trade_journal_evidence_live_restore_test`: **42 rows and three original checksums** verified. Repeating restoration correctly refused the populated target. A failing initial backup identified an invalid synthetic import-artifact key; the fixture now uses the existing archive identity helper. No production records were repaired or modified.
- **Deployed Preview:** [validated deployment](https://trade-journal-4ecmaaqi9-cryptonerdo123-2385s-projects.vercel.app), `dpl_HSGoRNTTCcCNkU2FAghBf2Yj1DbM`, Ready. Verified the user's test Neon destination was empty before applying all 32 migrations and seeding one `PREVIEWTEST` trade. The hosted app used a distinct Preview login. An actual **5,368,352-byte** normalized PNG went from browser to private R2; Linux finalization, thumbnail generation, editing during upload, **3,309-byte** metadata review, autosave/reload, multi-section assignment, Fit/100% viewing, direct download and portable ZIP all passed. Both downloads exactly matched the uploaded original. Old-browser writes were rejected (409), unauthenticated image access and cross-origin writes were rejected, and finalization retry/cancellation passed. The hosted complete-backup endpoint returned three verified files with a valid 18-row restore plan and original checksum. Market candles were fixtures, not live Alpaca validation; Preview Notion publishing was disabled because the separately approved test below used an isolated local database.
- **Approved synthetic Notion publication:** created only `R2NOTIONTEST`, then updated that same page. The private page link is provided in the user handoff, not committed. Saved revisions **7 and 8** both completed; the update adds `UPDATE VERIFIED` to Takeaways. Verified 32 properties, 13 section containers, 14 image placements, only two unique uploads reused across assignments, and both downloaded PNGs byte-identical to the original R2 assets. The unassigned image and legacy notes remained local. The test used explicit synthetic relation selections, not default initialization. Existing real journals and publication jobs were untouched. The target workspace's 5 MiB file allowance remains lower than the app's 20 MB individual limit; larger originals must be blocked clearly when publishing to this workspace.

## Production configuration and fresh backup — 24 September 2026

The user provisioned production storage and explicitly authorized configuration verification plus a fresh backup, while holding commit, push and production migration.

- `trade-journal-evidence-production` verified as Standard, Oceania (`OC`), default jurisdiction, empty and private. Managed public access is disabled; there are no custom domains or bucket locks. The only lifecycle rule aborts unfinished multipart uploads; there is no original deletion or storage-class transition rule.
- CORS allows only the stable production application origin, GET/HEAD/PUT, `content-type`/`if-none-match`, and the intended exposed headers. A real OPTIONS preflight returned 204 with the correct origin. No production object was uploaded, overwritten or deleted.
- The local production key pair successfully listed the production bucket and received 403 when listing each of the non-production and screener buckets. This verifies credential validity and denial on those two named buckets, not an exhaustive audit of every possible bucket or an actual production PUT.
- All seven Vercel Production variables exist with Production-only scope. Account/bucket/config values match the local configuration; writes and maintenance are both `0`. Access keys and metrics token are Secrets, whose saved values cannot be read back for comparison. Preview bucket configuration remains unchanged and the existing production cron secret is present. Actual execution using those Vercel Secret values remains a controlled deployment check.
- The first dedicated metrics token returned **403 / code 10000**. The user replaced it with an account-scoped token granting Workers R2 Storage Read and updated both Vercel and the ignored local credential file. The replacement successfully read account-level `/r2/metrics` at **2026-09-24 06:48:43 UTC**, returning **7,166,679,120 Standard bytes** and **zero Infrequent Access bytes**, accepted by the application parser. This request explicitly used the replacement metrics token, not the existing management token. Vercel confirms the variable is a Production-only Secret; its write-only value cannot be read back for comparison. Its execution from a deployed Vercel runtime remains a rollout check.
- A new transaction-consistent backup completed **2026-09-24 06:32:11 UTC**: **57 tables, 15 reviews, 52 images / 13,476,284 original bytes, 49 section assignments and three unassigned images**. No invalid image, dangling assignment or external standalone screenshot was found. All originals remain inline in the source, so this dump is complete for the audited images. Production has 31 completed migrations and no new asset table; no production migration ran.
- Backup: `backups/pre-r2-DzoqzL/postgres.dump`, **39,667,108 bytes**; SHA-256 `725adcf2678bb33636114e74220c65c61fd071d90182125380574d2d89d2371f`. Keep `preservation.json` and `restore-verification.json` beside it. These private artifacts and production credentials are excluded from Git and deployment archives.
- Restore verification completed **2026-09-24 06:33:26 UTC** into the newly created local `trade_evidence_release_20260924063320_restore_test`. All 57 table counts, review/scalar content, legacy drawing and journal hashes, section assignments and original image checksums matched. The restore did not overwrite any existing database. No additive migration was run on production or this newly restored copy.

The new snapshot contains seven more images than the earlier backup. Preserve both backups. If more journal edits/imports occur before cutover, refresh the backup again. The actual production app, bucket configuration, database rows/schema, Vercel configuration and Worker deployments were not changed by this verification pass.

## Release preparation and remaining cutover prerequisites

Commit/push and the associated compatible production deployment are now authorized. R2 activation and migration of existing image bytes remain separate from deploying the additive schema.

Immediately before staging, a new transaction-consistent production backup was taken at **2026-09-24 06:52:09 UTC** and restored successfully at **06:55:22 UTC**. `backups/pre-r2-x5gIzX/postgres.dump` is **39,739,771 bytes**, SHA-256 `e23d2c29359a38db95cd5e398893a5acbb384b23ef1dae2e9eba54ea16aa2db1`. All **57 tables, 15 reviews, 52 images / 13,476,284 original bytes, 49 assignments and 3 unassigned images** matched in a new isolated local restore database, including scalar/legacy content and image checksums. There were no invalid images or dangling assignments. The backup and verification reports remain private and ignored. Focused TypeScript, all **122 provider tests**, **69 workstation node tests**, and the production dependency audit (zero vulnerabilities) passed again.

1. Review the approved synthetic Notion output. Production bucket setup and read-only configuration checks now passed as recorded above; validate actual Vercel-held credentials and a controlled upload during the authorized rollout. Keep writes disabled until the additive migration and access checks pass.
2. Use the newly verified snapshot above, or repeat it if any journal/import changes occur before rollout.
3. Apply the additive schema via the authorized production build step. Confirm separate R2 cutover authorization before enabling writes or migrating legacy images; then run the authorized resumable image migration and repeat checksum/assignment audits. Maintain reference-aware readers on rollback. No separate Worker migration or redeployment is required.
4. The dedicated metrics token's 403 issue is resolved by the successful replacement-token check above. Verify account readings from the deployed runtime after the authorized rollout and maintenance activation; do not substitute the broader management token.

### Environment and local server notes

Keep the Vercel environment variables. The Git-ignored `.env.preview-validation.local` is an additional local copy for validation, not a replacement for deployed configuration. It contains only the isolated Neon test URLs and non-production bucket credentials. Neither it nor `.vercel` validation helpers are committed or included in deployment archives.

The isolated Preview uses `trade-journal-preview-test` / `trade_journal_preview_test`, initially empty, now containing only synthetic validation data. Preview-specific credentials are different from production. Its deployment overrides enable private R2 writes, disable automatic maintenance and live Notion publication, and restrict mutations to the synthetic account. The only permitted browser origins on the non-production bucket are the exact deployed Preview and local test origin.

Local browser validation is complete; the user can stop the manually launched server with Ctrl+C. For a later rerun, use Node 22 or later:

```powershell
Set-Location D:\Python\trade-journal
node scripts\start-isolated-evidence-browser-server.mjs
```

The server is loopback-only, with a synthetic login and fixed local `trades_workstation_auth_test` database on port 55439. Live Notion/provider credentials are disabled. The local test PostgreSQL cluster is left running for this step. Stop the terminal with Ctrl+C after testing; stop only that test cluster when finished.

The synthetic Preview trade and approved Notion page are retained for inspection. Generated temporary upload/protocol objects were removed by their guarded tests; original evidence from other applications and production remains untouched.

Detailed infrastructure configuration, retention rules, backup verification/restoration commands and rollback requirements are in [private R2 implementation notes](private-evidence-r2.md).

## Reproduction notes

Use a supported Node 22 runtime. The machine's default Node 20.14 produces engine warnings for existing lint/test tooling.

Database suites require matching local `DATABASE_URL`/`DIRECT_URL` and `ALLOW_TEST_DATABASE_MUTATIONS=1`. Keep full-backup asset tests on a clean dedicated database; some older fixtures in other suites can leave orphan synthetic review rows and invalidate a complete-account restore audit.

For the optional actual restore transaction, set `TEST_EVIDENCE_RESTORE_DATABASE_URL` to a second, empty, migrated local `*_restore_test` database. The test deliberately does not erase a populated restore target. Object operations remain mocked in that test.

Additional guarded live scripts:

- `scripts/verify-evidence-r2-live.ts`: requires `ALLOW_LIVE_R2_TEST=1` and only the non-production bucket. Tests actual browser PUT/CORS and exact-byte object retrieval; removes only its generated probe keys.
- `scripts/verify-evidence-live-persistence.ts`: requires the separately prepared synthetic fixture, `ALLOW_TEST_DATABASE_MUTATIONS=1`, `ALLOW_LIVE_R2_TEST=1`, enabled writes, and fixed local `trade_journal_evidence_notion_live_test` on port 55439. Its optional restore must target a new empty local restore-test database; the successful restore database is now populated and must not be erased to rerun.
- `scripts/verify-notion-live.ts --r2`: prepare/step/verify/update stages use the isolated fixture and require separate approval before live publishing. The approved page has already been created and updated; do not create another page or update it unnecessarily.
- The deployed authenticated browser check used an ignored, exact-origin/Neon-database guarded harness in `.vercel/check-preview-browser.ts`; actual auth/review/image/backup transport was not mocked. Only market/context providers were replaced with fixtures. Vercel's authenticated CLI supplied deployment-protection access; protection was not disabled.

No credentials belong in these files, test output, commits or browser preferences. No separate Worker migration or deployment is required.
