import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CUTOVER_PREFLIGHT_READ_ONLY_GIT_COMMANDS,
  PHASE_17_CHECKPOINT,
  PINNED_FILTER_REPO,
  REMOVAL_PATHS,
  REQUIRED_APPROVAL_ROLES,
  RESTORATION_RECORDS,
  evaluateCutoverEvidence,
  sha256,
} from "./cutover-preflight.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const E = "e".repeat(40);
const HASH = "1".repeat(64);
const NOW = Date.parse("2026-07-22T06:00:00.000Z");

function validLedger() {
  return {
    schemaVersion: 1,
    purpose: "phase18-cutover-readiness",
    createdAt: "2026-07-22T05:00:00.000Z",
    expiresAt: "2026-07-23T05:00:00.000Z",
    checkpoint: PHASE_17_CHECKPOINT,
    sourceBaseline: [
      PHASE_17_CHECKPOINT,
      true,
      true,
      "2".repeat(64),
      "3".repeat(64),
      "4".repeat(64),
      "2026-07-22T05:10:00.000Z",
    ],
    sourceRefs: [
      ["HEAD", C, "root"],
      ["refs/heads/main", A, "branch"],
      ["refs/heads/workstation-uplift", C, "branch"],
      ["refs/remotes/origin/HEAD", A, "remote-tracking"],
      ["refs/remotes/origin/main", A, "remote-tracking"],
      ["refs/platform/capture/private", D, "capture"],
    ],
    candidateRepository: [path.resolve("candidate"), PHASE_17_CHECKPOINT, "5".repeat(64), 3, "refs/heads/main", E],
    remote: ["https://example.invalid/repository.git", "6".repeat(64), 3, "refs/heads/main"],
    tools: [
      ["git", path.resolve("tools/git.exe"), "7".repeat(64), "git version 2.50.0"],
      ["node", path.resolve("tools/node.exe"), "8".repeat(64), "v24.0.0"],
      [
        "filter-repo",
        path.resolve("tools/git-filter-repo.exe"),
        PINNED_FILTER_REPO.executableSha256,
        PINNED_FILTER_REPO.version,
      ],
      ["wheel", path.resolve("tools/git-filter-repo.whl"), PINNED_FILTER_REPO.wheelSha256, PINNED_FILTER_REPO.version],
    ],
    removalPaths: [...REMOVAL_PATHS],
    restoration: RESTORATION_RECORDS.map((record) => [...record]),
    branchMapping: [
      ["refs/heads/main", null, "exclude", A, null, "rewritten"],
      ["refs/heads/workstation-uplift", "refs/heads/main", "update", A, E, "restored"],
      ["refs/heads/workstation-uplift", "refs/heads/workstation-uplift", "create", null, E, "restored"],
      ["refs/remotes/origin/HEAD", null, "exclude", null, null, "excluded"],
      ["refs/remotes/origin/main", null, "exclude", A, null, "excluded"],
      ["refs/platform/capture/private", null, "exclude", null, null, "excluded"],
    ],
    captureRefs: [["refs/platform/capture/private", "exclude"]],
    bundles: [
      ["original", path.resolve("bundles/original.bundle"), "9".repeat(64), 1000, [["refs/heads/main", A], ["refs/heads/workstation-uplift", C]]],
      ["rewritten", path.resolve("bundles/rewritten.bundle"), "a".repeat(64), 900, [["refs/heads/main", E], ["refs/heads/workstation-uplift", E]]],
    ],
    candidateScan: [path.resolve("evidence/candidate-scan.json"), "b".repeat(64), 0, 0, 0, true],
    identitySignaturePolicy: ["preserve", "strip"],
    freeze: [
      "2026-07-22T07:00:00.000Z",
      "2026-07-22T09:00:00.000Z",
      "c".repeat(64),
      "d".repeat(64),
      "e".repeat(64),
    ],
    approvals: REQUIRED_APPROVAL_ROLES.map((role, index) => [
      role,
      String((index % 9) + 1).repeat(64),
      "2026-07-22T05:30:00.000Z",
      "2026-07-23T05:30:00.000Z",
      String(((index + 1) % 9) + 1).repeat(64),
    ]),
  };
}

function validObservation(ledger) {
  return {
    candidate: {
      clean: true,
      indexEmpty: true,
      refsSha256: ledger.candidateRepository[2],
      refCount: ledger.candidateRepository[3],
      headRef: ledger.candidateRepository[4],
      headOid: ledger.candidateRepository[5],
    },
    remote: {
      sha256: ledger.remote[1],
      rowCount: ledger.remote[2],
      defaultBranch: ledger.remote[3],
    },
    tools: ledger.tools
      .map(([role, , digest, version]) => ({ role, regularFile: true, sha256: digest, size: 100, version }))
      .sort((left, right) => left.role.localeCompare(right.role)),
    restoration: ledger.restoration.map((record) => [...record]),
    bundles: ledger.bundles
      .map(([role, , digest, size, heads]) => ({
        role,
        regularFile: true,
        verified: true,
        prerequisiteCount: 0,
        sha256: digest,
        size,
        heads: heads.map((head) => [...head]),
      }))
      .sort((left, right) => left.role.localeCompare(right.role)),
    candidateScan: {
      sha256: ledger.candidateScan[1],
      findingCount: 0,
      unresolvedRefCount: 0,
      signatureCount: 0,
      rewriteAllowed: true,
    },
  };
}

function evaluate(mutateLedger, mutateObservations, environment = {}) {
  const ledger = validLedger();
  mutateLedger?.(ledger);
  const start = validObservation(ledger);
  const end = structuredClone(start);
  const observations = { start, end };
  mutateObservations?.(observations, ledger);
  const bytes = Buffer.from(JSON.stringify(ledger));
  const digest = sha256(bytes);
  return evaluateCutoverEvidence({
    ledger,
    ledgerSha256: digest,
    expectedLedgerSha256: digest,
    observations,
    environment,
    now: NOW,
  });
}

test("a complete stable ledger is readiness-valid but never grants push authorization", () => {
  const result = evaluate();
  assert.equal(result.status, "READY");
  assert.equal(result.pushAuthorized, false);
  assert.deepEqual(result.holds, []);
});

test("missing owner acknowledgements fail closed", () => {
  const result = evaluate((ledger) => ledger.approvals.pop());
  assert.equal(result.status, "HOLD");
  assert.ok(result.holds.includes("APPROVALS_MISSING"));
});

test("checkpoint changes fail closed", () => {
  const result = evaluate((ledger) => {
    ledger.checkpoint = B;
  });
  assert.ok(result.holds.includes("CHECKPOINT_MISMATCH"));
});

test("staged, unstaged, or untracked candidate changes fail the state check", () => {
  for (const field of ["clean", "indexEmpty"]) {
    const result = evaluate(null, ({ start, end }) => {
      start.candidate[field] = false;
      end.candidate[field] = false;
    });
    assert.ok(result.holds.includes("CANDIDATE_CHECKPOINT_OR_STATE_MISMATCH"));
  }
});

test("changed or added refs fail the exact candidate inventory", () => {
  const result = evaluate(null, ({ start, end }) => {
    start.candidate.refsSha256 = HASH;
    end.candidate.refsSha256 = HASH;
    start.candidate.refCount += 1;
    end.candidate.refCount += 1;
  });
  assert.ok(result.holds.includes("CANDIDATE_CHECKPOINT_OR_STATE_MISMATCH"));
});

test("a stale remote advertisement fails closed", () => {
  const result = evaluate(null, ({ start, end }) => {
    start.remote.sha256 = HASH;
    end.remote.sha256 = HASH;
  });
  assert.ok(result.holds.includes("REMOTE_ADVERTISEMENT_STALE"));
});

test("wrong restoration bytes or modes fail closed", () => {
  const result = evaluate(null, ({ start, end }) => {
    start.restoration[11][1] = HASH;
    end.restoration[11][1] = HASH;
  });
  assert.ok(result.holds.includes("RESTORATION_BYTES_OR_MODES_MISMATCH"));
});

test("an implicit or incorrect branch mapping is rejected", () => {
  const result = evaluate((ledger) => {
    ledger.branchMapping = ledger.branchMapping.filter(([, destination]) => destination !== "refs/heads/main");
  });
  assert.ok(result.holds.includes("BRANCH_MAPPING_INCOMPLETE"));
});

test("duplicate destinations and wildcard refs are rejected", () => {
  const duplicate = evaluate((ledger) => {
    ledger.branchMapping[2][1] = "refs/heads/main";
  });
  assert.ok(duplicate.holds.includes("BRANCH_MAPPING_INVALID"));

  const wildcard = evaluate((ledger) => {
    ledger.sourceRefs[1][0] = "refs/heads/*";
  });
  assert.ok(wildcard.holds.includes("SOURCE_REFS_INVALID"));
});

test("missing or substituted pinned tooling fails closed", () => {
  const result = evaluate(null, ({ start, end }) => {
    const tool = start.tools.find(({ role }) => role === "filter-repo");
    const endTool = end.tools.find(({ role }) => role === "filter-repo");
    tool.regularFile = false;
    endTool.regularFile = false;
  });
  assert.ok(result.holds.includes("TOOLCHAIN_MISMATCH"));
});

test("bundle prerequisites or wrong heads fail closed", () => {
  const prerequisite = evaluate(null, ({ start, end }) => {
    start.bundles[0].prerequisiteCount = 1;
    end.bundles[0].prerequisiteCount = 1;
  });
  assert.ok(prerequisite.holds.includes("BUNDLE_VERIFICATION_FAILED"));

  const wrongHead = evaluate(null, ({ start, end }) => {
    start.bundles[1].heads[0][1] = B;
    end.bundles[1].heads[0][1] = B;
  });
  assert.ok(wrongHead.holds.includes("BUNDLE_VERIFICATION_FAILED"));
});

test("expired acknowledgements fail closed", () => {
  const result = evaluate((ledger) => {
    ledger.approvals[0][3] = "2026-07-22T05:59:59.000Z";
  });
  assert.ok(result.holds.includes("APPROVALS_INVALID"));
});

test("case-variant Git environment overrides fail closed", () => {
  const result = evaluate(null, null, { Git_Work_Tree: "canary-private-path" });
  assert.ok(result.holds.includes("UNSAFE_GIT_ENVIRONMENT"));
});

test("start/end changes are detected", () => {
  const result = evaluate(null, ({ end }) => {
    end.remote.rowCount += 1;
  });
  assert.ok(result.holds.includes("OBSERVATION_CHANGED_DURING_PREFLIGHT"));
});

test("duplicate approval records are rejected", () => {
  const result = evaluate((ledger) => {
    ledger.approvals[1][0] = ledger.approvals[0][0];
  });
  assert.ok(result.holds.includes("APPROVALS_INVALID"));
  assert.ok(result.holds.includes("APPROVALS_MISSING"));
});

test("ledger digest binding rejects independently changed bytes", () => {
  const ledger = validLedger();
  const observation = validObservation(ledger);
  const result = evaluateCutoverEvidence({
    ledger,
    ledgerSha256: "2".repeat(64),
    expectedLedgerSha256: "3".repeat(64),
    observations: { start: observation, end: structuredClone(observation) },
    now: NOW,
  });
  assert.ok(result.holds.includes("LEDGER_DIGEST_MISMATCH"));
});

test("failure output is redacted", () => {
  const canary = "CANARY-PRIVATE-OWNER-REMOTE-PATH";
  const ledger = validLedger();
  ledger.remote[0] = `https://example.invalid/${canary}.git`;
  ledger.candidateRepository[0] = path.resolve(canary);
  const observation = validObservation(ledger);
  observation.remote.sha256 = HASH;
  const bytes = Buffer.from(JSON.stringify(ledger));
  const digest = sha256(bytes);
  const result = evaluateCutoverEvidence({
    ledger,
    ledgerSha256: digest,
    expectedLedgerSha256: digest,
    observations: { start: observation, end: structuredClone(observation) },
    now: NOW,
  });
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test("the command adapter exposes only inspection operations", () => {
  assert.deepEqual(Object.keys(CUTOVER_PREFLIGHT_READ_ONLY_GIT_COMMANDS).sort(), [
    "bundle",
    "cat-file",
    "diff",
    "for-each-ref",
    "ls-remote",
    "ls-tree",
    "rev-parse",
    "status",
  ]);
  assert.deepEqual(CUTOVER_PREFLIGHT_READ_ONLY_GIT_COMMANDS.bundle, ["verify", "list-heads"]);
});

test("the CLI defaults to a redacted refusal without a private ledger", () => {
  const result = spawnSync(process.execPath, [path.join(HERE, "cutover-preflight-cli.mjs")], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PREFLIGHT_BOOTSTRAP_FAILED/);
  assert.equal(result.stderr.includes(process.cwd()), false);
});
