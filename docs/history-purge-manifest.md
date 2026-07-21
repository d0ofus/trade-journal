# Git History Purge Manifest

Status: **PLAN ONLY - NOT APPROVED FOR EXECUTION**

This document prepares a separately approved rewrite. Phase 16 sanitizes the current tree only. It does not rewrite refs, delete capture refs, expire reflogs, prune objects, force-push, rotate credentials, invalidate old clones, or mutate any remote.

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
| `H16-006` | `prisma/seed.js` and `src/lib/server/sample-data.ts` | High historical account-shaped demo/default material | Remove old path history, then re-add the reviewed current versions |
| `H16-007` | `src/lib/import/ibkr-flex.test.ts` and `src/lib/import/ibkr-parser.test.ts` | Medium historical private fixture-name and correlated parser expectations | Remove old path history, then re-add the sanitized Phase 16 versions |
| `H16-008` | `README.md` and `TODO.md` | Medium historical personal path and private-document reference | Remove old path history, then re-add the sanitized Phase 16 versions |
| `H16-009` | Object-only `test-results/**` screenshots, logs, JSON, and error context | High local object-store residue, including an account-shaped candidate; images were not OCR-verified | Enumerate before rewrite, then expire approved reflogs and prune unreachable objects only after verification |
| `H16-010` | One local Codex capture ref with two opaque path components | Ref-retention risk; it retains the contaminated packaged Phase 15 tree, not the unstaged Phase 16 tree | Record the exact ref privately and delete only that reviewed ref during the approved window |
| `H16-011` | Commit author/committer metadata | Privacy review involving multiple redacted identities | Rewrite only if the repository owner explicitly adds identity metadata to scope |

## Rewrite Path Set

The reviewed path-removal command must include exactly these historical paths:

```text
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
git filter-repo --force --invert-paths \
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
  --path TODO.md
```

This blueprint is not authorization to run it. Immediately before execution, inventory every advertised and locally retained ref with `git for-each-ref`; record the exact approved refspec set in an access-controlled evidence log; and confirm `git filter-repo` will rewrite each intended local branch, tag, remote-tracking ref, and pull-request ref. Do not use broad deletion wildcards for Codex or tool-owned namespaces.

## Clean Restoration Set

Before filtering, export these sanitized files from the approved Phase 16 tree into encrypted access-controlled storage outside contaminated Git history:

```text
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

Copy these values into the private rewrite evidence log and verify them again immediately before execution. The five financial-fixture hashes must also match `scripts/repository-safety/allowlist.mjs`. After filtering, restore the files, verify every digest, run the repository safety gate, and create one clearly labeled post-rewrite restoration commit. Never retain a contaminated backup branch or tag in the rewritten repository.

## Approval Checklist

- [ ] Identify the remote owner and enumerate branches, tags, pull-request refs, hidden/tool refs, forks, deployment mirrors, CI caches, artifact stores, and backups.
- [ ] Freeze pushes, merges, imports, Flex/cron jobs, and deployments for the rewrite window.
- [ ] Create the clean restoration set and private digest ledger outside contaminated history.
- [ ] Privately determine whether the historical SQLite database or any database URL held live credentials or user data; decide notification and rotation requirements without adding values to logs or tickets.
- [ ] Approve the exact path command, exact refspec inventory, Codex capture-ref deletion, reflog expiry, object pruning, remote force-push plan, branch-protection changes, and collaborator communication.
- [ ] Rehearse the operation in a disposable mirror and retain the old-to-new commit map in the access-controlled evidence log.
- [ ] Decide whether commit identity metadata is in scope.

## Evidence Procedure

Record exit code, UTC timestamp, tool version, redacted counts, and evidence-file digest for each step below:

| Step | Command class | Required evidence |
| --- | --- | --- |
| 1 | `git for-each-ref`, reflog inventory, and advertised remote-ref inventory | Exact private refspec list and redacted ref counts |
| 2 | `git rev-list --objects --all`, `git fsck --full --unreachable`, and object type/size inventory | Separate ref-reachable, reflog-only, dangling-tree, and otherwise object-only reports |
| 3 | Current-tree and all-object sensitive-pattern scans | Rule/version list, scope, redacted finding counts, and report digest |
| 4 | Reviewed `git filter-repo` path removal in disposable mirror | Tool version, exact command digest, old-to-new commit map, and exit code |
| 5 | Clean-file restoration | Per-file canonical digest comparison and restoration commit ID |
| 6 | Ref/path/blob rescan before pruning | Proof that every listed path and private finding value is absent from every approved ref and reflog |
| 7 | Approved capture-ref deletion, reflog expiry, and unreachable-object pruning | Exact reviewed ref, commands, exit codes, and post-prune object counts |
| 8 | Unit, lint, build, seed, Playwright, and repository-safety gates | Complete verification transcript against an isolated release-candidate database |
| 9 | Mirror/refspec audit of rewritten remote | Proof for every advertised/approved ref; this is the remote reachability proof |
| 10 | Ordinary fresh clone | Independent application/scanner/build verification for advertised fetched refs only |

An ordinary fresh clone cannot prove absence from server-side unreachable objects, hidden refs, caches, forks, or backups. Those require owner-specific evidence in steps 1, 2, and 9.

## Stop Conditions

Stop without pushing if any listed path or private finding remains reachable, the clean restoration digests do not match, an approved ref cannot be rewritten, a hidden namespace is unresolved, scanner output has an unreviewed finding, remote/cache/backup ownership is unknown, or rollback and communication responsibilities are not assigned.
