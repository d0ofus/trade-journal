# Phase 17 History Purge Rehearsal Evidence

Status: **REHEARSAL COMPLETE - PHASE 17 PACKAGING APPROVAL REQUIRED**

Date: 2026-07-21
Source checkpoint: packaged Phase 16 commit `346a62587c37def252c143de380edba6ed4580ec`

This report contains only aggregate counts, rule names, reachability classes, and evidence digests. It contains no matched values, old/new object IDs, private ref names, identity values, database URLs, credentials, or private evidence paths.

## Safety Boundary

- The rewrite ran only in a disposable no-hardlink mirror outside the source repository.
- The source `HEAD`, branch, index, namespace refs, reflogs, object inventory, and remotes matched the pre-rehearsal fingerprints after every destructive mirror step.
- No source ref/reflog rewrite, source garbage collection, remote fetch/push, force-push, merge, deployment, credential rotation, or production/normal-database mutation occurred.
- The one platform capture ref was deleted by exact private name only in the disposable mirror. It remains unchanged in the source.
- Commit identities were preserved. Rewritten signatures were stripped only in the disposable candidate.
- `localhost:3000` remained on the Phase 16 demo build and returned HTTP 200 after the rehearsal.

## Source Evidence

The final source scan explicitly approved all 7 effective local refs for audit: 2 root refs, 4 pre-existing namespace refs, and 1 platform capture ref. The contaminated source correctly remained in review status.

- Scanner: `phase17-v3`
- Scanner source digest: `37046cd6edf17fc0bbb2a689f4403ef1261fbdafa5dadc5ed302eb0e2350904a`
- Rule/engine digest: `cb6ba0bfbb3974367f2e9478a672b1ff6c96902ae7ae0bd47e3fc95581c0d81f`
- Allowlist: 11 entries; digest `3d99bc463645764243c27c0e892e75c69591046b0c60b9b1133defa02dad81bb`
- Reflogs: 191 physical entries
- Objects: 3,044
- Findings: 423 occurrences
- Reachability: 89 ref-reachable, 57 reflog-only, 277 dangling-tree, 0 otherwise object-only
- Rules: 137 brokerage-account, 6 database-artifact, 16 database-URL, 1 editor-state, 15 financial-export, 101 generated-output, 50 opaque-binary, 14 personal-path, and 83 private-document occurrences
- Signatures: 1 signed commit and 0 signed tags
- Redacted evidence digest: `6385e53f39917eaa4e84bcdb6edc9b5fc176f1990e6bfb8d589f4c1c7bd0b7cb`

The three-occurrence reduction from the earlier v2 baseline is the reviewed application favicon. Version 3 permits that binary only when every alias in a reachability class has the exact Git path, raw SHA-256, and mode `100644`. Wrong-case paths, normalized paths, changed bytes, mixed aliases, magic files, pathless objects, and duplicate/invalid exceptions still fail closed.

## Tooling And Export

- `git-filter-repo` 2.47.0 was downloaded as a pinned wheel and installed in an isolated external virtual environment. No project or global Python dependency changed.
- Wheel SHA-256: `2cd04929b9024e83e65db571cbe36aec65ead0cb5f9ec5abe42158654af5ad83`
- The exact command record covered 15 removal paths, 4 approved namespace refs, explicit partial mode, disabled automatic GC, identity preservation, and signature stripping.
- Command-record SHA-256: `9342de17e41b572531a066033c75d9cc052646ab45dad40c28e77efb2fd9d649`
- All 13 restoration files were exported directly from Git blob objects at the packaged checkpoint. Their manifest SHA-256 values and modes matched.
- A Windows `git archive` plus system-`tar` probe converted LF bytes to CRLF. The procedure now requires direct Git-blob export and byte verification instead of trusting archive extraction.

## Mirror Rewrite

- The independent mirror contained all 3,044 source objects before filtering.
- All 2,667 comparable object-store files had distinct operating-system file identities; no hardlinks, alternates, remotes, partial/promisor state, or extra worktrees remained.
- The exact platform capture ref was removed only in the mirror. Four approved namespace refs entered the filter.
- Explicit `--refs` scope was required because `git-filter-repo` 2.47.0 otherwise migrates and deletes `refs/remotes/origin/*`. Partial mode kept the approved ref names stable while cleanup remained manual.
- Filtering exited 0 and produced 97 old-to-new commit-map rows.
- Commit-map SHA-256: `01093b96d79f149ecfc83ac43963714daf56ba413f8168d934052c4916977330`
- One neutral unsigned restoration commit was added only to `workstation-uplift`. It changed 12 files; all 13 restoration files, including the already-present full-statement fixture, matched their packaged blobs and mode `100644`.
- The final three main-derived old tips were pruned as empty commits and each ref resolved to its nearest surviving mapped ancestor. The restored branch parent matched its mapped Phase 16 tip.

Before pruning, scanner v3 reported 308 findings and every one was `dangling-tree`; no ref-reachable, unapproved-ref, or reflog-only finding remained. Mirror-only cleanup then:

- expired 2 mirror-generated reflog entries;
- pruned 1,898 unreachable objects;
- retained 1,561 reachable objects in one pack;
- left 0 unreachable objects and 0 reflog entries.

The final mirror scan exited 0 with 5 approved effective refs, 0 unapproved refs, 0 findings, 0 signed commits/tags, and `rewriteAllowed=true`.

- Final mirror evidence digest: `ad2f7899b4db1dc238a46b71382bb17b17082e80347f30fbf542249390d996ed`
- All 15 removal paths were verified.
- Twelve sanitized paths appear only in the restoration commit.
- Three paths are absent from every rewritten ref.

## Fresh Clone Verification

An ordinary fresh clone was created from the rewritten mirror with no alternates, shared file identities, or multi-link object files. Its clone-generated reflog messages contained three local-path findings; the local mirror remote was neutralized and only those fresh-clone reflogs were expired. The resulting all-ref scan exited 0 with 0 findings and `rewriteAllowed=true`.

- Fresh-clone evidence digest: `b89b804c29b83e11cb2d7085e3adaf0f3a017053490555395105e6f36ae3b2df`
- Restoration blobs verified: 13
- History-scanner tests: 35 passed
- Current-tree scanner tests: 20 passed
- Current-tree scan: 272 candidate versions, 0 findings
- Full Vitest suite: 67 files; 469 passed, 5 intentionally skipped
- Lint: passed
- Production build: passed
- Playwright: 59 Chromium tests passed in 4.7 minutes

Playwright verified `/trades`, `/journal`, `/dashboard`, `/import`, and `/settings`, including chart persistence/conflicts, 15-minute candle derivation, journaling guards, import durability, reconciled metrics, backup health, auth redirects, and responsive containment.

Only `trade_journal_phase17_test` was created, reset, migrated, seeded, and used for database-backed tests. Both URLs resolved to the same direct isolated target and `ALLOW_TEST_DATABASE_MUTATIONS=1` was set. The final deterministic state contains 8 executions, 8 analytics rows, 3 non-stale closed trades, 1 demo account, 0 non-demo accounts, and 1 current materialization watermark.

## Remaining Limits

- This is rehearsal evidence, not a rewrite of the source repository or any remote.
- The disposable external evidence includes sensitive ref/object maps and must remain access-controlled.
- Hidden server refs, server-side unreachable objects, caches, artifacts, forks, old clones, and backups were not changed or proven clean.
- The later real rewrite still requires a freeze window, fresh remote inventory, owner-side backups, branch-protection coordination, collaborator communication, remote update, independent post-push clone verification, and rollback readiness.
- npm reported 6 existing dependency audit findings (4 moderate, 2 high). No dependency upgrade was attempted in this history-only phase.

## Approval Boundary

`Approve Phase 17 packaging` authorizes staging and committing only the reviewed Phase 17 tooling and redacted documentation. It does not authorize a real history rewrite, source ref/reflog deletion, source garbage collection, push, force-push, merge, deployment, credential rotation, or production/normal-database mutation.
