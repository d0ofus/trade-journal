# Phase 18 Cutover Readiness Evidence

Status: **PHASE 17 CANDIDATE VERIFIED - PHASE 18 PACKAGING APPROVAL REQUIRED - PHASE 19 HOLD**

Date: 2026-07-22
Source checkpoint: packaged and unpushed Phase 17 commit `4b1fef7c3b260798262e24037859a1663e7b6ea0`

This report contains redacted counts, policies, and SHA-256 evidence digests. It excludes private ref names, object IDs other than the approved source checkpoint, identities, database URLs, credentials, and private evidence paths.

## Safety Boundary

- The source branch, `HEAD`, index, 7-ref inventory, 193-entry reflog inventory, and 3,059-object inventory remained at the packaged Phase 17 checkpoint. The worktree contains only the 7 intentional unstaged Phase 18 paths.
- The live remote advertisement was queried read-only with `ls-remote --symref`; no fetch, push, force-push, merge, branch-protection change, or remote mutation occurred.
- Filtering, ref mapping, reflog expiry, and object pruning occurred only in a new external no-hardlink candidate mirror.
- Only `trade_journal_phase18_test` was created, reset, migrated, seeded, or used by tests. Both database URLs resolved to that same direct isolated target with `ALLOW_TEST_DATABASE_MUTATIONS=1`.
- `localhost:3000/login` continued to return HTTP 200. The complete browser suite used a separate loopback port and shut down afterward.

## Audit Decisions

Four focused read-only audits agreed that the rewrite mechanics are reproducible but the production operation is not yet authorized. They required an explicit branch map, complete rollback bundles, time-bounded owner acknowledgements, a real freeze runbook, branch-protection and CI coordination, collaborator and old-clone handling, and ordered post-update acceptance and rollback criteria.

The candidate-only mapping promotes the rewritten and restored product tip to candidate `main`, retains one workstation alias for verification, points candidate `HEAD` to `main`, excludes the former rewritten `main` from candidate refs, and excludes remote-tracking and the exact current platform capture ref from outbound refs. This mapping is not approved for the real remote.

## Cutover Preflight

The dependency-free preflight accepts only a private approval-ledger path, an independently supplied SHA-256, and optional JSON output. Its Git adapter permits only `rev-parse`, `status`, cached `diff`, `for-each-ref`, `ls-remote`, `cat-file`, `ls-tree`, and bundle `verify`/`list-heads`. It never grants push authorization.

It validates two separate attestations: the clean packaged source baseline before Phase 18 edits and the clean final external candidate. It also repeats candidate, remote, tool, restoration, bundle, and scanner observations to detect changes during the check.

- Focused preflight tests: 19 passed.
- Covered refusals: checkpoint/state/ref changes, stale remote advertisement, restoration byte or mode drift, incomplete or wildcard mapping, missing/substituted tools, bundle prerequisites or wrong heads, missing/expired/duplicate approvals, unsafe case-variant Git environment, observation drift, digest mismatch, and redacted failures.
- Live technical result: every artifact and policy check passed; final status is `HOLD` only because all 9 production responsibility acknowledgements remain absent.
- Approval-ledger SHA-256: `be2c92d4a36e86753d9edbb0ca16ec9b72d51b30a5647f44405f12d6504f509d`
- Preflight-result SHA-256: `0e840f8c49a951bc668cccba725bb68b8289a9c10f2e0fd56367e08ee7b5801d`
- Repeated-observation SHA-256: `305de233233dd2507c6e4fbdf0b30035f13c62059b0c909e6a38d27c3c45c6cb`

## Candidate Construction

- Tool: pinned `git-filter-repo` 2.47.0; wheel and executable digests matched Phase 17 evidence.
- Mirror bootstrap: 2,682 comparable object-store files, zero shared identities, zero multi-link object files, zero alternates, zero remotes, isolated empty hooks, and no linked worktree retained.
- Filter scope: 15 exact paths across 4 approved namespace refs; 98 commits parsed; identities preserved and invalidated rewritten signatures stripped.
- Source inventory: 7 effective refs, comprising 2 root refs, 4 ordinary namespace refs, and 1 platform capture ref.
- Mapping ledger: 7 exact records; no wildcard, implicit, duplicate-destination, or uncovered source ref.
- Candidate inventory: 3 effective refs comprising root `HEAD` and 2 branch refs; the 2 branch refs resolve to the same restored candidate tip.
- Restoration: 13 raw Git blobs and modes verified from packaged Phase 17; all modes are `100644`.
- Path outcomes: 12 paths exist only in the neutral restoration commit; 3 paths remain absent; the synthetic full-statement fixture is verification-only and was not re-added.
- Pre-prune scan: 308 dangling-only findings and zero reachable findings.
- Final candidate: 1,573 reachable objects, zero reflogs, zero unreachable objects, zero findings, zero unapproved refs, zero signatures, and `rewriteAllowed=true`.
- Eight packaged Phase 17 scanner/tooling/documentation files matched byte-for-byte in the fresh clone.

## Bundles And Clone

Both access-controlled bundles are regular files, complete, prerequisite-free, and advertise exactly 2 branch heads. Each passed `git bundle verify`; each was rehashed and restated after verification.

- Original bundle: 949,981 bytes; SHA-256 `bee7baad65501a06fc0614565157081fa65fa61c79c4b314da8e3c92279d55df`.
- Rewritten bundle: 906,274 bytes; SHA-256 `f61e88b5ecc44f896487adace75916e7e1e67c71a98dd0d683fae01a97505c5f`.
- Fresh clone: zero alternates, shared object identities, multi-link files, reflogs, findings, unapproved refs, or signatures; `rewriteAllowed=true`.

The original bundle can restore the former branch topology, but doing so would deliberately republish contaminated history. Its custody and use therefore require explicit rollback authority.

## Evidence Digests

- Source baseline record: `3c3e44b796bb47bfe3c6c056ff3754edd3833bca9b854a4f422129d42989efca`.
- Final source audit file: `9243723d1a534c9d018e7d39e1e175098f74ed9e9971755f80ac8585faa59167`.
- Current remote advertisement: `fabc1a73e987a1f55c084a8df7e286610411a0e31ae0b87d0e0b3fe2c2077de6` across 3 advertisement rows, one branch, and no tags; default branch `main`.
- Filter command record: `9900d351ac7fd2d94fde49a594f83b3e35eab7b80b1c6b28232ba02eb68b5e00`.
- Candidate scan file: `c742ad313c0b0d56292dae126a88689f16b96b5c52e98ea5d23598dc8d6c774e`; scanner evidence `35b32b2ee681b501fd59c5dcdbefd79a50f7eaeb6979405e7bc97e50dd5cac48`.
- Fresh-clone scan file: `00159603067d27054004d5b8ee1bc4206d82896eec20445b75178d24ece3b294`; scanner evidence `e0c1319c40d81b5e37eefce9e05ef2e597b55f0b21f435cc91b6c4b8828cc894`.

## Verification

- History scanner: 35 tests passed.
- Current-tree scanner: 20 tests passed; final fresh-clone scan covered 273 candidate versions with zero findings.
- Application: 67 Vitest files passed with 469 tests passing and 5 intentional skips in both the fresh candidate and Phase 18 source package.
- Lint and production build passed in both the fresh candidate and Phase 18 source package.
- Playwright: all 59 Chromium tests passed in 10.3 minutes on a dedicated loopback port.
- Browser coverage confirmed `/trades`, `/journal`, `/dashboard`, `/import`, and `/settings`, including chart persistence/conflicts, 15-minute derivation, journaling guards, import durability, reconciled metrics, backup health, auth redirects, and responsive containment.
- Final isolated demo state: 8 executions, 8 analytics rows, 3 non-stale closed trades, 1 demo account, 0 non-demo accounts, and 1 current materialization watermark.

The first history-scanner test invocation reached a three-minute harness timeout before results; the unchanged suite passed all 35 tests under the corrected wider limit. The browser server emitted response-aborted shutdown messages only after all 59 tests passed. `npm ci` reported 7 current dependency audit findings (3 moderate and 4 high); no dependency upgrade was attempted in this history-readiness phase.

## Phase 19 Responsibilities

| Responsibility | Required evidence | Status |
| --- | --- | --- |
| Repository owner | Approve promotion of the workstation changes, final default branch, public branch set, and exact outbound refspec | HOLD |
| Cutover coordinator | Freeze start/end, quiescence checks, timeout, abort criteria, and final release | HOLD |
| Remote administrator | Fresh advertised/hidden ref inventory, exact old-object leases, and branch-protection procedure | HOLD |
| CI/deployment owner | Suspend/restart jobs and deployments; invalidate caches and mirrors; restore protections | HOLD |
| Backup custodian | Bundle custody, retention, digest recheck, restore procedure, and rollback drill | HOLD |
| Communications owner | Collaborator, fork, backup, and old-clone notice with mandatory reclone protocol | HOLD |
| Verification owner | Ordered remote, clone, scanner, build, browser, protection, CI, and application acceptance | HOLD |
| Rollback owner | Explicit rollback triggers, decision authority, observation window, and bundle-use approval | HOLD |

## Remaining Holds

1. Decide whether rewritten `workstation-uplift` replaces remote `main`, whether any public alias remains, and approve exact non-mirror outbound refspecs with freeze-time old-object leases.
2. Inventory hidden/server refs, caches, deployment mirrors, artifacts, forks, backups, old clones, and server-side unreachable retention with an accountable owner for each class.
3. Approve the freeze runbook, branch-protection changes, CI/deployment suspension, collaborator communication, post-update acceptance order, rollback thresholds, and named decision-makers.
4. Assign access-controlled custody and retention for both bundles and prove a restore drill. A rollback to the original bundle restores contaminated history and must not be automatic.
5. Decide whether the eventual cutover tree must include Phase 18 readiness tooling and documentation. This candidate intentionally preserves packaged Phase 17; if Phase 18 files are required in final history, rebuild and reverify the real candidate from the packaged Phase 18 commit.
6. Privately resolve the historical database/data and credential-rotation review already identified by the manifest.
7. Address release-security dependency findings separately from the history rewrite.

## Approval Boundary

`Approve Phase 18 packaging` authorizes staging and committing only the reviewed preflight tooling and redacted documentation. It does not authorize a source or remote history rewrite, source ref/reflog deletion, source garbage collection, push, force-push, merge, deployment, branch-protection change, credential rotation, production/normal-database mutation, or Phase 19 cutover.
