# Git History Purge Manifest

Status: **REAL REWRITE PLAN ONLY - PHASE 17 EXTERNAL REHEARSAL COMPLETE**

This document prepares a separately approved real rewrite. Phase 16 sanitizes the current tree, and Phase 17 proves the procedure in an external disposable mirror only. Neither phase rewrites source/remote refs, deletes source capture refs, expires source reflogs, prunes source objects, force-pushes, rotates credentials, invalidates old clones, or mutates any remote.

## Evidence Boundary

The read-only audit covered the current Git candidate tree, existing local branch/tag/remote-tracking/Codex refs, ref-reachable commits and blobs, reflog-only commits, and object-only artifacts discoverable in the local object database. Reports recorded only opaque finding IDs, paths, categories, counts, and reachability classes. Candidate values were not copied into this repository.

The bounded scan found no recognized private-key blocks, common provider-token shapes, JWTs, bearer credentials, webhook secret URLs, or hard-coded secret assignments under the rules used at audit time. This is not proof that no secret exists. Historical database URLs, binary screenshots, commit identity metadata, remote-only hidden refs, caches, forks, and backups require separate owner review.

## Redacted Findings

| Finding | Scope | Classification | Rewrite treatment |
| --- | --- | --- | --- |
| `H16-001` | `prisma/dev.db` | Critical historical SQLite database artifact retained by reachable commits | Remove the path from every rewritten ref; do not re-add it |
| `H16-002` | `fixtures/OpenClaw_-_Trades___Positions.csv` | Critical correlated brokerage statement export | Remove the path from every rewritten ref; do not re-add it |
| `H16-003` | Four historical `fixtures/sample-ibkr-*.csv` files | High brokerage-shaped fixture history | Remove their old history, then re-add only reviewed Phase 16 synthetic versions |
| `H16-004` | `src/app/(app)/positions/page.tsx` | High copied account default | Remove old path history, then re-add the sanitized Phase 16 version |
| `H16-005` | `src/lib/stats/closed-trades.test.ts` | High copied account and correlated trade scenario | Remove old path history, then re-add the sanitized Phase 16 version |
| `H16-006` | `prisma/seed.js` and `src/lib/server/sample-data.ts` | High historical account-shaped demo/default material | Remove both histories, re-add only the reviewed current `prisma/seed.js`, and keep the absent legacy sample-data path removed |
| `H16-007` | `src/lib/import/ibkr-flex.test.ts` and `src/lib/import/ibkr-parser.test.ts` | Medium historical private fixture-name and correlated parser expectations | Remove old path history, then re-add the sanitized Phase 16 versions |
| `H16-008` | `README.md` and `TODO.md` | Medium historical personal path and private-document reference | Remove old path history, then re-add the sanitized Phase 16 versions |
| `H16-009` | Unreachable generated output plus database-artifact, opaque-binary, editor-state, brokerage-account, personal-path, and private-document categories | High dangling-tree/object-store residue; binary images were not OCR-verified | Preserve only redacted aggregate evidence, then expire approved mirror-only reflogs and repack/prune only after verification |
| `H16-010` | Conditional tool/capture-ref retention | The initial Phase 17 checkpoint contained no tool/capture ref, but one platform-managed capture ref appeared during tooling work; it has no reflog and the scanner reports zero orphan reflogs | The rehearsal deleted its exact private ref only inside the mirror; re-inventory and approve the exact current ref again before a real rewrite |
| `H16-011` | Commit author/committer metadata and one signed commit | Privacy and signature-disposition review involving redacted identities | Preserve identities and strip invalidated signatures, as approved and verified in the rehearsal; re-confirm before real execution |
| `H16-012` | `.env.example` | High historical database URL content; the packaged Phase 16 version contains only empty placeholders | Remove old path history, then re-add the reviewed Phase 16 version |

## Rewrite Path Set

The reviewed path-removal command must include exactly these historical paths:

```text
.env.example
prisma/dev.db
fixtures/OpenClaw_-_Trades___Positions.csv
fixtures/sample-ibkr-executions.csv
fixtures/sample-ibkr-flex.csv
fixtures/sample-ibkr-positions.csv
fixtures/sample-ibkr-snapshots.csv
src/app/(app)/positions/page.tsx
src/lib/stats/closed-trades.test.ts
prisma/seed.js
src/lib/server/sample-data.ts
src/lib/import/ibkr-flex.test.ts
src/lib/import/ibkr-parser.test.ts
README.md
TODO.md
```

The command blueprint for a disposable fresh mirror is:

```bash
git filter-repo --force --partial --no-gc --invert-paths \
  --path .env.example \
  --path prisma/dev.db \
  --path fixtures/OpenClaw_-_Trades___Positions.csv \
  --path fixtures/sample-ibkr-executions.csv \
  --path fixtures/sample-ibkr-flex.csv \
  --path fixtures/sample-ibkr-positions.csv \
  --path fixtures/sample-ibkr-snapshots.csv \
  --path 'src/app/(app)/positions/page.tsx' \
  --path src/lib/stats/closed-trades.test.ts \
  --path prisma/seed.js \
  --path src/lib/server/sample-data.ts \
  --path src/lib/import/ibkr-flex.test.ts \
  --path src/lib/import/ibkr-parser.test.ts \
  --path README.md \
  --path TODO.md \
  --refs "${APPROVED_REFS[@]}"
```

This blueprint is not authorization to run it. Immediately before execution, inventory every advertised and locally retained ref with `git for-each-ref --include-root-refs`; record the exact approved refspec set in an access-controlled evidence log; and pass every approved namespace ref through the `APPROVED_REFS` array. Root `HEAD` must resolve through an approved namespace ref. Explicit `--refs` is required with `git-filter-repo` 2.47.0 because its default full rewrite migrates and deletes `refs/remotes/origin/*`. Partial mode intentionally disables automatic reflog expiry and garbage collection; the reviewed procedure performs those steps manually after the pre-prune scan. Do not use broad deletion wildcards for Codex or tool-owned namespaces.

## Guarded Disposable-Mirror Procedure

Use new external directories that are neither descendants nor siblings managed by the source repository. Record their resolved paths only in the private execution log. With shell variables pointing to those reviewed paths, the mirror bootstrap is:

```bash
git -c protocol.file.allow=always -c safe.directory="$SOURCE_GIT_DIR" clone --local --mirror --no-hardlinks "$SOURCE" "$MIRROR"
git -C "$MIRROR" config --remove-section remote.origin
git -C "$MIRROR" config core.hooksPath "$EMPTY_HOOKS"
```

`$SOURCE_GIT_DIR` must be the exact resolved source Git directory and the safe-directory exception must remain command-scoped; never write it to global configuration. `$EMPTY_HOOKS` must be a newly created empty external directory. Stop if the clone reports alternates, a shallow/partial/promisor state, linked worktrees, view-changing inherited Git environment, any configured remote, any nonempty hook directory, or any object/pack file with the same operating-system file identity as its source counterpart. The Phase 17 history scanner must complete against both source and mirror with replacement-object substitution disabled; its built-in checks do not replace the separate same-file-identity check.

Before cloning, record digests for the source root-ref/ref inventory, both reflog endpoints, object inventory, remote configuration, `HEAD`, and index state. Repeat those measurements immediately after clone creation, remote neutralization, every filter/restoration step, and final verification. Any source-side delta stops the rehearsal. Do not fetch from, push to, repack, expire reflogs in, or otherwise address the source repository from a mirror command.

The mirror does not inherit source reflog files. Preserve the source reflog inventory and roots in the private evidence set before cloning. Confirm every reflog-root object is present in the independent mirror before filtering; after the approved ref rewrite and mirror-only reflog expiry/pruning, the all-object scan must report no prohibited finding in any remaining reachability class.

Materialize the exact approved ref list as repeated `--ref` arguments to the history scanner. A scan without explicit refs is audit-only and cannot authorize rewriting. Stop when any discovered root ref, branch, tag, remote-tracking ref, pull-request ref, tool ref, or capture ref is absent from the approved list. In the Phase 17 rehearsal, the one observed capture ref was deleted by exact private name only inside the mirror; it remained untouched in the source. Re-inventory it before any later real rewrite because platform refs can change independently.

## Clean Restoration Set

Export these files directly from Git blob objects at the packaged checkpoint and verify the raw bytes after writing. Do not rely on `git archive` plus the Windows system `tar`: the Phase 17 probe converted LF blob bytes to CRLF during extraction. Canonical and raw SHA-256 values must both match, and every restored entry must retain mode `100644`.

Before filtering, export these sanitized files from the approved Phase 16 tree into encrypted access-controlled storage outside contaminated Git history:

```text
.env.example
fixtures/sample-ibkr-executions.csv
fixtures/sample-ibkr-flex.csv
fixtures/sample-ibkr-full-statement.csv
fixtures/sample-ibkr-positions.csv
fixtures/sample-ibkr-snapshots.csv
src/app/(app)/positions/page.tsx
src/lib/stats/closed-trades.test.ts
prisma/seed.js
src/lib/import/ibkr-flex.test.ts
src/lib/import/ibkr-parser.test.ts
README.md
TODO.md
```

`src/lib/server/sample-data.ts` remains in the rewrite path set because it exists in contaminated history, but it is intentionally absent from the clean restoration set.

The canonical Phase 16 restoration digests are:

| Clean path | Canonical SHA-256 |
| --- | --- |
| `.env.example` | `1cd6879ee84b613411c789cb6fe2fcd25e3745095a07c20114aea0a53f858c68` |
| `fixtures/sample-ibkr-executions.csv` | `f26371f050a43399c74e4175aface42e93cc1da010a74e04964db8ba749e8ded` |
| `fixtures/sample-ibkr-flex.csv` | `584536724de696122e86a1258dff2d4c8a5e9aebbe8f2f2af6f33134fc987b9e` |
| `fixtures/sample-ibkr-full-statement.csv` | `b51347df6aec1879daecd9ffb283e3e08dbf7a8fedbce0e72de6d554935664a5` |
| `fixtures/sample-ibkr-positions.csv` | `0878db421da53485fd6e27218a7b7b17632252b2bda07b11f4af21563295c849` |
| `fixtures/sample-ibkr-snapshots.csv` | `1dddb57a64129ff50d6a7478b7c4a7b561bd11e3a0341a2a52e8fd936c75e5ba` |
| `src/app/(app)/positions/page.tsx` | `0a392e63ef214185ebc7de11d25170c1c2a19f850580a33cccf6475615dbf5fe` |
| `src/lib/stats/closed-trades.test.ts` | `dac2abe63038515e40d0b698c6432496d4e90f5843a2d307c445daf4e7469731` |
| `prisma/seed.js` | `36db340cae99ecafd5b0b0b4956e22f958c1e49e13e8b7213364bf4a14ec20e6` |
| `src/lib/import/ibkr-flex.test.ts` | `639211ae7ee6e42b8ea20755bb3c753b5043b9e09bfe48fdaf33e2e37459d2c3` |
| `src/lib/import/ibkr-parser.test.ts` | `50faaffd81080df1369d035c3c01fc2e7ea99721673ce375adc54b96b10ee666` |
| `README.md` | `ff2b1cbc507f2f81199bfaeb9922c39d998ad5e6b20e0872fc76ca930b86d47b` |
| `TODO.md` | `71a26ed441abca99bf09d987b8ffb6c4b6e79faf3716409ae7de45474be567da` |

Export all 13 files from the packaged Git tree, not from newline-converted worktree files. Record each raw SHA-256 and mode in the private evidence log; all Phase 16 modes are `100644`, and each packaged raw digest currently equals its canonical digest above. Verify them again immediately before execution. The five financial-fixture hashes must also match `scripts/repository-safety/allowlist.mjs`. After filtering, restore the files only onto the explicitly approved restoration branch, verify every digest and mode, run both repository safety gates, and create one clearly labeled post-rewrite restoration commit. Never retain a contaminated backup branch or tag in the rewritten repository.

## Approval Checklist

### Phase 17 Rehearsal Decisions

- [x] Pinned isolated `git-filter-repo` 2.47.0 provisioning.
- [x] Restore only `workstation-uplift`; rewrite other approved tips without restoration.
- [x] Preserve identity metadata and strip signatures invalidated by rewritten commits.
- [x] Delete the current capture ref by exact name only in the disposable mirror.
- [x] Record the repository owner for remote, cache, fork, backup, rollback, communication, and later force-push responsibilities.
- [x] Complete the external mirror rewrite, restoration, prune, clean scan, fresh clone, isolated database, build, and Playwright rehearsal.

### Real Rewrite Preconditions

- [ ] Identify the remote owner and enumerate branches, tags, pull-request refs, hidden/tool refs, forks, deployment mirrors, CI caches, artifact stores, and backups.
- [ ] Freeze pushes, merges, imports, Flex/cron jobs, and deployments for the rewrite window.
- [ ] Create the clean restoration set and private digest ledger outside contaminated history.
- [ ] Privately determine whether the historical SQLite database or any database URL held live credentials or user data; decide notification and rotation requirements without adding values to logs or tickets.
- [ ] Approve the exact path command, exact refspec inventory, restoration branch, conditional capture-ref treatment, reflog expiry, object repack/pruning, remote force-push plan, branch-protection changes, and collaborator communication.
- [x] Rehearse the operation in a disposable mirror and retain the old-to-new commit map in the access-controlled evidence log.
- [x] Decide whether commit identity metadata is in scope and whether rewritten signed commits may have their invalidated signatures stripped.

## Evidence Procedure

Record exit code, UTC timestamp, tool version, redacted counts, and evidence-file digest for each step below:

| Step | Command class | Required evidence |
| --- | --- | --- |
| 1 | `git for-each-ref`, reflog inventory, and advertised remote-ref inventory | Exact private refspec list and redacted ref counts |
| 2 | `git rev-list --objects --all`, `git fsck --full --unreachable`, and object type/size inventory | Separate ref-reachable, reflog-only, dangling-tree, and otherwise object-only reports |
| 3 | Current-tree and all-object sensitive-pattern scans | Rule/version list, scope, redacted finding counts, and report digest |
| 4 | Reviewed `git filter-repo` path removal in disposable mirror | Tool version, exact command digest, old-to-new commit map, and exit code |
| 5 | Clean-file restoration | Per-file raw/canonical digest comparison, Git mode, and restoration commit ID |
| 6 | Ref/path/blob rescan before pruning | Proof that every listed path and private finding value is absent from every approved ref and reflog |
| 7 | Conditional capture-ref deletion plus mirror-only reflog expiry, repack, and unreachable-object pruning | Exact reviewed ref when one exists, commands, exit codes, and post-prune object counts |
| 8 | Unit, lint, build, seed, Playwright, and repository-safety gates | Complete verification transcript against an isolated release-candidate database |
| 9 | Mirror/refspec audit of rewritten remote | Proof for every advertised/approved ref; this is the remote reachability proof |
| 10 | Ordinary fresh clone | Independent application/scanner/build verification for advertised fetched refs only |

An ordinary fresh clone cannot prove absence from server-side unreachable objects, hidden refs, caches, forks, or backups. Those require owner-specific evidence in steps 1, 2, and 9.

## Stop Conditions

Stop without filtering if `git-filter-repo` is unavailable or unpinned, the approved ref list or restoration branch is undefined, identity/signature treatment is unresolved, a current capture ref appears without an exact private disposition, the clean restoration digests or modes do not match, the independent mirror shares objects/alternates with the source, linked worktrees or Git view overrides are present, or beginning/end evidence inventories differ. Stop without pushing if any listed path or private finding remains reachable, an approved ref cannot be rewritten, a hidden namespace is unresolved, scanner output has an unreviewed finding, remote/cache/fork/backup ownership is unknown, or rollback and communication responsibilities are not assigned.
