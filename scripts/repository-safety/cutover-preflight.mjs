import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PREFLIGHT_SCHEMA_VERSION = 1;
export const PHASE_17_CHECKPOINT = "4b1fef7c3b260798262e24037859a1663e7b6ea0";

export const REMOVAL_PATHS = Object.freeze([
  ".env.example",
  "prisma/dev.db",
  "fixtures/OpenClaw_-_Trades___Positions.csv",
  "fixtures/sample-ibkr-executions.csv",
  "fixtures/sample-ibkr-flex.csv",
  "fixtures/sample-ibkr-positions.csv",
  "fixtures/sample-ibkr-snapshots.csv",
  "src/app/(app)/positions/page.tsx",
  "src/lib/stats/closed-trades.test.ts",
  "prisma/seed.js",
  "src/lib/server/sample-data.ts",
  "src/lib/import/ibkr-flex.test.ts",
  "src/lib/import/ibkr-parser.test.ts",
  "README.md",
  "TODO.md",
]);

export const RESTORATION_RECORDS = Object.freeze([
  [".env.example", "1cd6879ee84b613411c789cb6fe2fcd25e3745095a07c20114aea0a53f858c68", "100644"],
  ["fixtures/sample-ibkr-executions.csv", "f26371f050a43399c74e4175aface42e93cc1da010a74e04964db8ba749e8ded", "100644"],
  ["fixtures/sample-ibkr-flex.csv", "584536724de696122e86a1258dff2d4c8a5e9aebbe8f2f2af6f33134fc987b9e", "100644"],
  ["fixtures/sample-ibkr-full-statement.csv", "b51347df6aec1879daecd9ffb283e3e08dbf7a8fedbce0e72de6d554935664a5", "100644"],
  ["fixtures/sample-ibkr-positions.csv", "0878db421da53485fd6e27218a7b7b17632252b2bda07b11f4af21563295c849", "100644"],
  ["fixtures/sample-ibkr-snapshots.csv", "1dddb57a64129ff50d6a7478b7c4a7b561bd11e3a0341a2a52e8fd936c75e5ba", "100644"],
  ["src/app/(app)/positions/page.tsx", "0a392e63ef214185ebc7de11d25170c1c2a19f850580a33cccf6475615dbf5fe", "100644"],
  ["src/lib/stats/closed-trades.test.ts", "dac2abe63038515e40d0b698c6432496d4e90f5843a2d307c445daf4e7469731", "100644"],
  ["prisma/seed.js", "36db340cae99ecafd5b0b0b4956e22f958c1e49e13e8b7213364bf4a14ec20e6", "100644"],
  ["src/lib/import/ibkr-flex.test.ts", "639211ae7ee6e42b8ea20755bb3c753b5043b9e09bfe48fdaf33e2e37459d2c3", "100644"],
  ["src/lib/import/ibkr-parser.test.ts", "50faaffd81080df1369d035c3c01fc2e7ea99721673ce375adc54b96b10ee666", "100644"],
  ["README.md", "d3881a9232f0eac273dbbc2ba3efe82b85c60bb88845f128efc402908ec5be5a", "100644"],
  ["TODO.md", "212ac9505243fc9da6c31eb0f3d050cc0949a63edafad42c3fbbeb346f0f04d9", "100644"],
]);

export const REQUIRED_APPROVAL_ROLES = Object.freeze([
  "repository-owner",
  "cutover-coordinator",
  "remote-administrator",
  "branch-protection-owner",
  "ci-deployment-owner",
  "backup-custodian",
  "communications-owner",
  "verification-owner",
  "rollback-owner",
]);

export const PINNED_FILTER_REPO = Object.freeze({
  version: "2.47.0",
  executableSha256: "5191ceaa9cd55257a039d02f8bd46a877263ef54fc45ad5fc6d7d88403e45997",
  wheelSha256: "2cd04929b9024e83e65db571cbe36aec65ead0cb5f9ec5abe42158654af5ad83",
});

const LEDGER_KEYS = Object.freeze([
  "schemaVersion",
  "purpose",
  "createdAt",
  "expiresAt",
  "checkpoint",
  "sourceBaseline",
  "sourceRefs",
  "candidateRepository",
  "remote",
  "tools",
  "removalPaths",
  "restoration",
  "branchMapping",
  "captureRefs",
  "bundles",
  "candidateScan",
  "identitySignaturePolicy",
  "freeze",
  "approvals",
]);

const UNSAFE_GIT_ENVIRONMENT_KEYS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);

const ALLOWED_GIT_COMMANDS = Object.freeze({
  "rev-parse": true,
  status: true,
  diff: true,
  "for-each-ref": true,
  "ls-remote": true,
  "cat-file": true,
  "ls-tree": true,
  bundle: new Set(["verify", "list-heads"]),
});

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_PATTERN = /^(?:HEAD|ORIG_HEAD|FETCH_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|BISECT_HEAD|AUTO_MERGE|refs\/[A-Za-z0-9][A-Za-z0-9._\/-]*)$/;
const TOOL_ROLES = Object.freeze(["git", "node", "filter-repo", "wheel"]);
const MAPPING_OPERATIONS = new Set(["create", "update", "delete", "exclude"]);
const RESTORATION_DISPOSITIONS = new Set(["restored", "rewritten", "excluded"]);

export class CutoverPreflightOperationalError extends Error {
  constructor(code) {
    super(code);
    this.name = "CutoverPreflightOperationalError";
    this.code = code;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  throw new CutoverPreflightOperationalError(code);
}

function normalizedLines(value) {
  return String(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(Boolean)
    .sort()
    .join("\n");
}

function evidenceDigest(value) {
  return sha256(JSON.stringify(value));
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isTuple(value, length) {
  return Array.isArray(value) && value.length === length;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value) && !/[?*\[\]\\:\s]/.test(value);
}

function unsafeEnvironmentKeys(environment) {
  const exact = new Set(UNSAFE_GIT_ENVIRONMENT_KEYS);
  return Object.keys(environment ?? {}).filter((key) => {
    const normalized = key.toUpperCase();
    return (
      exact.has(normalized) ||
      normalized.startsWith("GIT_CONFIG_KEY_") ||
      normalized.startsWith("GIT_CONFIG_VALUE_")
    );
  });
}

function addHold(holds, code) {
  if (!holds.includes(code)) holds.push(code);
}

function validateStaticLedger(ledger, now) {
  const holds = [];
  if (!hasExactKeys(ledger, LEDGER_KEYS)) return ["LEDGER_SCHEMA_INVALID"];
  if (ledger.schemaVersion !== PREFLIGHT_SCHEMA_VERSION) addHold(holds, "LEDGER_SCHEMA_INVALID");
  if (ledger.purpose !== "phase18-cutover-readiness") addHold(holds, "LEDGER_PURPOSE_INVALID");
  if (!validDate(ledger.createdAt) || !validDate(ledger.expiresAt)) addHold(holds, "LEDGER_TIME_INVALID");
  if (validDate(ledger.createdAt) && validDate(ledger.expiresAt)) {
    const created = Date.parse(ledger.createdAt);
    const expires = Date.parse(ledger.expiresAt);
    if (created >= expires || now < created || now > expires) addHold(holds, "LEDGER_EXPIRED");
  }
  if (ledger.checkpoint !== PHASE_17_CHECKPOINT) addHold(holds, "CHECKPOINT_MISMATCH");

  if (
    !isTuple(ledger.sourceBaseline, 7) ||
    ledger.sourceBaseline[0] !== PHASE_17_CHECKPOINT ||
    ledger.sourceBaseline[1] !== true ||
    ledger.sourceBaseline[2] !== true ||
    !HASH_PATTERN.test(ledger.sourceBaseline[3] ?? "") ||
    !HASH_PATTERN.test(ledger.sourceBaseline[4] ?? "") ||
    !HASH_PATTERN.test(ledger.sourceBaseline[5] ?? "") ||
    !validDate(ledger.sourceBaseline[6])
  ) {
    addHold(holds, "SOURCE_BASELINE_INVALID");
  }

  if (!Array.isArray(ledger.sourceRefs) || ledger.sourceRefs.length === 0) {
    addHold(holds, "SOURCE_REFS_INVALID");
  } else {
    const names = new Set();
    for (const record of ledger.sourceRefs) {
      if (
        !isTuple(record, 3) ||
        !validRef(record[0]) ||
        !OID_PATTERN.test(record[1] ?? "") ||
        !["root", "branch", "remote-tracking", "capture", "other"].includes(record[2]) ||
        names.has(record[0])
      ) {
        addHold(holds, "SOURCE_REFS_INVALID");
        break;
      }
      names.add(record[0]);
    }
  }

  if (
    !isTuple(ledger.candidateRepository, 6) ||
    typeof ledger.candidateRepository[0] !== "string" ||
    !path.isAbsolute(ledger.candidateRepository[0]) ||
    ledger.candidateRepository[1] !== PHASE_17_CHECKPOINT ||
    !HASH_PATTERN.test(ledger.candidateRepository[2] ?? "") ||
    !Number.isSafeInteger(ledger.candidateRepository[3]) ||
    !validRef(ledger.candidateRepository[4]) ||
    !OID_PATTERN.test(ledger.candidateRepository[5] ?? "")
  ) {
    addHold(holds, "CANDIDATE_LEDGER_INVALID");
  }

  if (
    !isTuple(ledger.remote, 4) ||
    typeof ledger.remote[0] !== "string" ||
    !/^https:\/\//i.test(ledger.remote[0]) ||
    !HASH_PATTERN.test(ledger.remote[1] ?? "") ||
    !Number.isSafeInteger(ledger.remote[2]) ||
    !validRef(ledger.remote[3])
  ) {
    addHold(holds, "REMOTE_LEDGER_INVALID");
  }

  if (!Array.isArray(ledger.tools) || ledger.tools.length !== TOOL_ROLES.length) {
    addHold(holds, "TOOLCHAIN_LEDGER_INVALID");
  } else {
    const roles = new Set();
    for (const record of ledger.tools) {
      if (
        !isTuple(record, 4) ||
        !TOOL_ROLES.includes(record[0]) ||
        roles.has(record[0]) ||
        typeof record[1] !== "string" ||
        !path.isAbsolute(record[1]) ||
        !HASH_PATTERN.test(record[2] ?? "") ||
        typeof record[3] !== "string" ||
        record[3].length === 0
      ) {
        addHold(holds, "TOOLCHAIN_LEDGER_INVALID");
        break;
      }
      roles.add(record[0]);
    }
    const filter = ledger.tools.find(([role]) => role === "filter-repo");
    const wheel = ledger.tools.find(([role]) => role === "wheel");
    if (
      filter?.[2] !== PINNED_FILTER_REPO.executableSha256 ||
      filter?.[3] !== PINNED_FILTER_REPO.version ||
      wheel?.[2] !== PINNED_FILTER_REPO.wheelSha256 ||
      wheel?.[3] !== PINNED_FILTER_REPO.version
    ) {
      addHold(holds, "PINNED_TOOLCHAIN_MISMATCH");
    }
  }

  if (JSON.stringify(ledger.removalPaths) !== JSON.stringify(REMOVAL_PATHS)) {
    addHold(holds, "REMOVAL_PATH_SET_MISMATCH");
  }
  if (JSON.stringify(ledger.restoration) !== JSON.stringify(RESTORATION_RECORDS)) {
    addHold(holds, "RESTORATION_LEDGER_MISMATCH");
  }

  const sourceRefNames = new Set(Array.isArray(ledger.sourceRefs) ? ledger.sourceRefs.map(([ref]) => ref) : []);
  const mappedSourceRefs = new Set();
  const destinations = new Set();
  if (!Array.isArray(ledger.branchMapping) || ledger.branchMapping.length === 0) {
    addHold(holds, "BRANCH_MAPPING_INVALID");
  } else {
    for (const record of ledger.branchMapping) {
      const [sourceRef, destinationRef, operation, oldOid, candidateOid, restoration] = record ?? [];
      const destinationRequired = operation === "create" || operation === "update";
      const oidRequired = operation === "create" || operation === "update";
      if (
        !isTuple(record, 6) ||
        !validRef(sourceRef) ||
        !sourceRefNames.has(sourceRef) ||
        !MAPPING_OPERATIONS.has(operation) ||
        (destinationRequired ? !validRef(destinationRef) : destinationRef !== null) ||
        (oldOid !== null && !OID_PATTERN.test(oldOid ?? "")) ||
        (oidRequired ? !OID_PATTERN.test(candidateOid ?? "") : candidateOid !== null) ||
        !RESTORATION_DISPOSITIONS.has(restoration) ||
        (destinationRef !== null && destinations.has(destinationRef))
      ) {
        addHold(holds, "BRANCH_MAPPING_INVALID");
        break;
      }
      mappedSourceRefs.add(sourceRef);
      if (destinationRef !== null) destinations.add(destinationRef);
    }
    const uncovered = [...sourceRefNames].filter((ref) => ref !== "HEAD" && !mappedSourceRefs.has(ref));
    const mainMapping = ledger.branchMapping.find(
      ([sourceRef, destinationRef, operation]) =>
        sourceRef === "refs/heads/workstation-uplift" &&
        destinationRef === "refs/heads/main" &&
        operation === "update",
    );
    if (uncovered.length > 0 || !mainMapping) addHold(holds, "BRANCH_MAPPING_INCOMPLETE");
  }

  const sourceCaptureRefs = new Set(
    Array.isArray(ledger.sourceRefs)
      ? ledger.sourceRefs.filter(([, , kind]) => kind === "capture").map(([ref]) => ref)
      : [],
  );
  if (!Array.isArray(ledger.captureRefs) || ledger.captureRefs.length !== sourceCaptureRefs.size) {
    addHold(holds, "CAPTURE_REF_DISPOSITION_INVALID");
  } else {
    const seen = new Set();
    for (const record of ledger.captureRefs) {
      if (
        !isTuple(record, 2) ||
        !sourceCaptureRefs.has(record[0]) ||
        record[1] !== "exclude" ||
        seen.has(record[0])
      ) {
        addHold(holds, "CAPTURE_REF_DISPOSITION_INVALID");
        break;
      }
      seen.add(record[0]);
    }
  }

  if (!Array.isArray(ledger.bundles) || ledger.bundles.length !== 2) {
    addHold(holds, "BUNDLE_LEDGER_INVALID");
  } else {
    const roles = new Set();
    for (const record of ledger.bundles) {
      if (
        !isTuple(record, 5) ||
        !["original", "rewritten"].includes(record[0]) ||
        roles.has(record[0]) ||
        typeof record[1] !== "string" ||
        !path.isAbsolute(record[1]) ||
        !HASH_PATTERN.test(record[2] ?? "") ||
        !Number.isSafeInteger(record[3]) ||
        record[3] <= 0 ||
        !Array.isArray(record[4]) ||
        record[4].length === 0 ||
        record[4].some((head) => !isTuple(head, 2) || !validRef(head[0]) || !OID_PATTERN.test(head[1] ?? ""))
      ) {
        addHold(holds, "BUNDLE_LEDGER_INVALID");
        break;
      }
      roles.add(record[0]);
    }
  }

  if (
    !isTuple(ledger.candidateScan, 6) ||
    typeof ledger.candidateScan[0] !== "string" ||
    !path.isAbsolute(ledger.candidateScan[0]) ||
    !HASH_PATTERN.test(ledger.candidateScan[1] ?? "") ||
    ledger.candidateScan[2] !== 0 ||
    ledger.candidateScan[3] !== 0 ||
    ledger.candidateScan[4] !== 0 ||
    ledger.candidateScan[5] !== true
  ) {
    addHold(holds, "CANDIDATE_SCAN_LEDGER_INVALID");
  }

  if (
    !isTuple(ledger.identitySignaturePolicy, 2) ||
    ledger.identitySignaturePolicy[0] !== "preserve" ||
    ledger.identitySignaturePolicy[1] !== "strip"
  ) {
    addHold(holds, "IDENTITY_SIGNATURE_POLICY_INVALID");
  }

  if (!isTuple(ledger.freeze, 5)) {
    addHold(holds, "FREEZE_LEDGER_INVALID");
  } else {
    const [startsAt, endsAt, coordinatorHash, quiescenceHash, abortHash] = ledger.freeze;
    if (
      !validDate(startsAt) ||
      !validDate(endsAt) ||
      Date.parse(startsAt) >= Date.parse(endsAt) ||
      Date.parse(endsAt) - Date.parse(startsAt) > 8 * 60 * 60 * 1000 ||
      !HASH_PATTERN.test(coordinatorHash ?? "") ||
      !HASH_PATTERN.test(quiescenceHash ?? "") ||
      !HASH_PATTERN.test(abortHash ?? "")
    ) {
      addHold(holds, "FREEZE_LEDGER_INVALID");
    }
  }

  if (!Array.isArray(ledger.approvals)) {
    addHold(holds, "APPROVALS_MISSING");
  } else {
    const roles = new Set();
    for (const record of ledger.approvals) {
      if (
        !isTuple(record, 5) ||
        !REQUIRED_APPROVAL_ROLES.includes(record[0]) ||
        roles.has(record[0]) ||
        !HASH_PATTERN.test(record[1] ?? "") ||
        !validDate(record[2]) ||
        !validDate(record[3]) ||
        Date.parse(record[2]) > now ||
        Date.parse(record[3]) < now ||
        !HASH_PATTERN.test(record[4] ?? "")
      ) {
        addHold(holds, "APPROVALS_INVALID");
        break;
      }
      roles.add(record[0]);
    }
    if (REQUIRED_APPROVAL_ROLES.some((role) => !roles.has(role))) addHold(holds, "APPROVALS_MISSING");
  }
  return holds;
}

function sameRecords(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function evaluateCutoverEvidence({
  ledger,
  ledgerSha256,
  expectedLedgerSha256,
  observations,
  environment = {},
  now = Date.now(),
}) {
  const holds = validateStaticLedger(ledger, now);
  if (!HASH_PATTERN.test(expectedLedgerSha256 ?? "") || ledgerSha256 !== expectedLedgerSha256) {
    addHold(holds, "LEDGER_DIGEST_MISMATCH");
  }
  if (unsafeEnvironmentKeys(environment).length > 0) addHold(holds, "UNSAFE_GIT_ENVIRONMENT");

  const { start, end } = observations ?? {};
  if (!start || !end) {
    addHold(holds, "OBSERVATION_INCOMPLETE");
  } else {
    if (!sameRecords(start, end)) addHold(holds, "OBSERVATION_CHANGED_DURING_PREFLIGHT");

    const candidate = start.candidate;
    if (
      !candidate ||
      candidate.clean !== true ||
      candidate.indexEmpty !== true ||
      candidate.refsSha256 !== ledger.candidateRepository?.[2] ||
      candidate.refCount !== ledger.candidateRepository?.[3] ||
      candidate.headRef !== ledger.candidateRepository?.[4] ||
      candidate.headOid !== ledger.candidateRepository?.[5]
    ) {
      addHold(holds, "CANDIDATE_CHECKPOINT_OR_STATE_MISMATCH");
    }

    const remote = start.remote;
    if (
      !remote ||
      remote.sha256 !== ledger.remote?.[1] ||
      remote.rowCount !== ledger.remote?.[2] ||
      remote.defaultBranch !== ledger.remote?.[3]
    ) {
      addHold(holds, "REMOTE_ADVERTISEMENT_STALE");
    }

    const expectedTools = new Map((ledger.tools ?? []).map(([role, , digest, version]) => [role, { digest, version }]));
    if (
      !Array.isArray(start.tools) ||
      start.tools.length !== TOOL_ROLES.length ||
      start.tools.some((record) => {
        const expected = expectedTools.get(record.role);
        return !expected || !record.regularFile || record.sha256 !== expected.digest || record.version !== expected.version;
      })
    ) {
      addHold(holds, "TOOLCHAIN_MISMATCH");
    }

    if (!sameRecords(start.restoration, RESTORATION_RECORDS)) {
      addHold(holds, "RESTORATION_BYTES_OR_MODES_MISMATCH");
    }

    const expectedBundles = new Map(
      (ledger.bundles ?? []).map(([role, , digest, size, heads]) => [role, { digest, size, heads }]),
    );
    if (
      !Array.isArray(start.bundles) ||
      start.bundles.length !== 2 ||
      start.bundles.some((record) => {
        const expected = expectedBundles.get(record.role);
        return (
          !expected ||
          !record.regularFile ||
          !record.verified ||
          record.prerequisiteCount !== 0 ||
          record.sha256 !== expected.digest ||
          record.size !== expected.size ||
          !sameRecords(record.heads, expected.heads)
        );
      })
    ) {
      addHold(holds, "BUNDLE_VERIFICATION_FAILED");
    }

    const scan = start.candidateScan;
    if (
      !scan ||
      scan.sha256 !== ledger.candidateScan?.[1] ||
      scan.findingCount !== 0 ||
      scan.unresolvedRefCount !== 0 ||
      scan.signatureCount !== 0 ||
      scan.rewriteAllowed !== true
    ) {
      addHold(holds, "CANDIDATE_SCAN_FAILED");
    }
  }

  holds.sort();
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    status: holds.length === 0 ? "READY" : "HOLD",
    pushAuthorized: false,
    checkpointPolicy: "phase17-packaged",
    identityPolicy: "preserve",
    signaturePolicy: "strip",
    counts: {
      holds: holds.length,
      sourceRefs: Array.isArray(ledger?.sourceRefs) ? ledger.sourceRefs.length : 0,
      mappings: Array.isArray(ledger?.branchMapping) ? ledger.branchMapping.length : 0,
      removalPaths: Array.isArray(ledger?.removalPaths) ? ledger.removalPaths.length : 0,
      restorationRecords: Array.isArray(ledger?.restoration) ? ledger.restoration.length : 0,
      approvals: Array.isArray(ledger?.approvals) ? ledger.approvals.length : 0,
      bundles: Array.isArray(ledger?.bundles) ? ledger.bundles.length : 0,
    },
    evidence: {
      ledgerSha256: HASH_PATTERN.test(ledgerSha256 ?? "") ? ledgerSha256 : null,
      observationSha256: start && end ? evidenceDigest(observations) : null,
    },
    holds,
  };
}

function cleanGitEnvironment(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (key.toUpperCase().startsWith("GIT_")) delete result[key];
  }
  return {
    ...result,
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function assertReadOnlyGitArguments(args) {
  const [command, operation] = args;
  const rule = ALLOWED_GIT_COMMANDS[command];
  if (!rule || (rule instanceof Set && !rule.has(operation))) fail("FORBIDDEN_GIT_OPERATION");
}

function runGit(gitPath, root, args, acceptedStatuses = [0], encoding = "utf8") {
  assertReadOnlyGitArguments(args);
  const result = spawnSync(gitPath, ["-C", root, ...args], {
    encoding,
    env: cleanGitEnvironment(process.env),
    maxBuffer: 32_000_000,
    windowsHide: true,
  });
  if (result.error || !acceptedStatuses.includes(result.status ?? -1)) fail("READ_ONLY_GIT_COMMAND_FAILED");
  return result;
}

function inspectRegularFile(filePath, expectedDigest = null) {
  const resolved = path.resolve(filePath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    return { regularFile: false, sha256: null, size: null };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return { regularFile: false, sha256: null, size: null };
  const bytes = fs.readFileSync(resolved);
  const digest = sha256(bytes);
  return {
    regularFile: expectedDigest === null || digest === expectedDigest,
    sha256: digest,
    size: stat.size,
  };
}

function inspectTool(record) {
  const [role, executablePath, expectedDigest, expectedVersion] = record;
  const file = inspectRegularFile(executablePath, expectedDigest);
  if (!file.regularFile) return { role, ...file, version: null };
  if (role === "wheel") return { role, ...file, version: expectedVersion };
  const result = spawnSync(executablePath, ["--version"], {
    encoding: "utf8",
    env: cleanGitEnvironment(process.env),
    maxBuffer: 1_000_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { role, ...file, version: null };
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  let version = output;
  if (role === "filter-repo" && (output === expectedVersion || /^[0-9a-f]{7,64}$/i.test(output))) {
    version = PINNED_FILTER_REPO.version;
  }
  return { role, ...file, version };
}

function inspectCandidate(gitPath, root) {
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    fail("CANDIDATE_PATH_UNAVAILABLE");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("CANDIDATE_PATH_UNSAFE");
  const headOid = runGit(gitPath, root, ["rev-parse", "HEAD"]).stdout.trim();
  const headRef = runGit(gitPath, root, ["rev-parse", "--symbolic-full-name", "HEAD"]).stdout.trim();
  const status = runGit(gitPath, root, ["status", "--porcelain=v2", "--untracked-files=all"]).stdout;
  const index = runGit(gitPath, root, ["diff", "--cached", "--quiet", "--exit-code"], [0, 1]);
  const refs = runGit(gitPath, root, [
    "for-each-ref",
    "--include-root-refs",
    "--format=%(refname)%00%(objectname)%00%(symref)%00",
  ]).stdout;
  const canonicalRefs = normalizedLines(refs);
  return {
    clean: status.length === 0,
    indexEmpty: index.status === 0,
    refsSha256: sha256(canonicalRefs),
    refCount: canonicalRefs.length === 0 ? 0 : canonicalRefs.split("\n").length,
    headRef,
    headOid,
  };
}

function inspectRemote(gitPath, root, remoteRecord) {
  const output = runGit(gitPath, root, ["ls-remote", "--symref", remoteRecord[0]]).stdout;
  const canonical = normalizedLines(output);
  const lines = canonical.length === 0 ? [] : canonical.split("\n");
  const head = lines.find((line) => line.startsWith("ref: ") && line.endsWith("\tHEAD"));
  return {
    sha256: sha256(canonical),
    rowCount: lines.length,
    defaultBranch: head ? head.slice(5, head.indexOf("\t")) : null,
  };
}

function inspectRestoration(gitPath, root, candidateTip) {
  return RESTORATION_RECORDS.map(([item]) => {
    const blob = runGit(gitPath, root, ["cat-file", "blob", `${candidateTip}:${item}`], [0], null).stdout;
    const tree = runGit(gitPath, root, ["ls-tree", candidateTip, "--", item]).stdout.trim();
    return [item, sha256(blob), tree.split(/\s+/)[0] ?? null];
  });
}

function parseBundlePrerequisites(bundlePath) {
  const descriptor = fs.openSync(bundlePath, "r");
  try {
    const buffer = Buffer.alloc(1_048_576);
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, length).toString("latin1");
    const end = prefix.indexOf("\n\n");
    if (end < 0) return null;
    return prefix
      .slice(0, end)
      .split("\n")
      .filter((line) => line.startsWith("-")).length;
  } finally {
    fs.closeSync(descriptor);
  }
}

function inspectBundle(gitPath, root, record) {
  const [role, bundlePath, expectedDigest] = record;
  const before = inspectRegularFile(bundlePath, expectedDigest);
  if (!before.regularFile) {
    return {
      role,
      regularFile: false,
      verified: false,
      prerequisiteCount: null,
      sha256: before.sha256,
      size: before.size,
      heads: [],
    };
  }
  const verify = runGit(gitPath, root, ["bundle", "verify", bundlePath], [0, 1]);
  const headsOutput = runGit(gitPath, root, ["bundle", "list-heads", bundlePath], [0, 1]);
  const heads = headsOutput.status === 0
    ? normalizedLines(headsOutput.stdout)
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(" ");
          return [line.slice(separator + 1), line.slice(0, separator)];
        })
        .sort(([left], [right]) => left.localeCompare(right))
    : [];
  const after = inspectRegularFile(bundlePath, expectedDigest);
  return {
    role,
    regularFile: before.regularFile && after.regularFile,
    verified: verify.status === 0 && before.sha256 === after.sha256 && before.size === after.size,
    prerequisiteCount: parseBundlePrerequisites(bundlePath),
    sha256: after.sha256,
    size: after.size,
    heads,
  };
}

function inspectCandidateScan(record) {
  const [scanPath, expectedDigest] = record;
  const file = inspectRegularFile(scanPath, expectedDigest);
  if (!file.regularFile) return { sha256: file.sha256 };
  let report;
  try {
    report = JSON.parse(fs.readFileSync(scanPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { sha256: file.sha256 };
  }
  return {
    sha256: file.sha256,
    findingCount: report.findingCount,
    unresolvedRefCount:
      report.scope?.unapprovedRefCount ??
      report.ownerDecisions?.unapprovedRefCount ??
      report.ownerDecisions?.unresolvedRefCount ??
      null,
    signatureCount:
      (report.ownerDecisions?.signedCommitCount ?? report.signedCommitCount ?? 0) +
      (report.ownerDecisions?.signedTagCount ?? report.signedTagCount ?? 0),
    rewriteAllowed: report.ownerDecisions?.rewriteAllowed,
  };
}

function collectObservation(ledger) {
  const gitRecord = ledger.tools.find(([role]) => role === "git");
  if (!gitRecord) fail("GIT_TOOL_MISSING");
  const gitPath = gitRecord[1];
  const candidateRoot = ledger.candidateRepository[0];
  return {
    candidate: inspectCandidate(gitPath, candidateRoot),
    remote: inspectRemote(gitPath, candidateRoot, ledger.remote),
    tools: ledger.tools.map(inspectTool).sort((left, right) => left.role.localeCompare(right.role)),
    restoration: inspectRestoration(gitPath, candidateRoot, ledger.candidateRepository[5]),
    bundles: ledger.bundles
      .map((record) => inspectBundle(gitPath, candidateRoot, record))
      .sort((left, right) => left.role.localeCompare(right.role)),
    candidateScan: inspectCandidateScan(ledger.candidateScan),
  };
}

export function runCutoverPreflight({ ledgerPath, expectedLedgerSha256, now = Date.now(), environment = process.env }) {
  if (unsafeEnvironmentKeys(environment).length > 0) {
    const result = evaluateCutoverEvidence({
      ledger: {},
      ledgerSha256: null,
      expectedLedgerSha256,
      observations: null,
      environment,
      now,
    });
    return result;
  }
  const ledgerFile = inspectRegularFile(ledgerPath);
  if (!ledgerFile.regularFile) fail("LEDGER_FILE_UNSAFE");
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("LEDGER_JSON_INVALID");
  }
  const staticHolds = validateStaticLedger(ledger, now);
  if (staticHolds.includes("LEDGER_SCHEMA_INVALID") || staticHolds.includes("CANDIDATE_LEDGER_INVALID")) {
    return evaluateCutoverEvidence({
      ledger,
      ledgerSha256: ledgerFile.sha256,
      expectedLedgerSha256,
      observations: null,
      environment,
      now,
    });
  }
  const start = collectObservation(ledger);
  const end = collectObservation(ledger);
  const finalLedgerFile = inspectRegularFile(ledgerPath);
  const digest =
    ledgerFile.sha256 === finalLedgerFile.sha256 && ledgerFile.size === finalLedgerFile.size
      ? finalLedgerFile.sha256
      : null;
  return evaluateCutoverEvidence({
    ledger,
    ledgerSha256: digest,
    expectedLedgerSha256,
    observations: { start, end },
    environment,
    now,
  });
}

export function formatCutoverPreflightReport(result) {
  const lines = [
    `Cutover preflight: ${result.status}`,
    "Push authorization: never granted by this command",
    `Checkpoint policy: ${result.checkpointPolicy}`,
    `Identity/signature policy: ${result.identityPolicy}/${result.signaturePolicy}`,
    `Counts: ${result.counts.sourceRefs} source refs, ${result.counts.mappings} mappings, ${result.counts.removalPaths} removal paths, ${result.counts.restorationRecords} restoration records, ${result.counts.bundles} bundles, ${result.counts.approvals} approvals`,
  ];
  if (result.holds.length > 0) lines.push(`HOLD codes: ${result.holds.join(", ")}`);
  if (result.evidence.ledgerSha256) lines.push(`Approval-ledger SHA-256: ${result.evidence.ledgerSha256}`);
  if (result.evidence.observationSha256) lines.push(`Observation SHA-256: ${result.evidence.observationSha256}`);
  return lines.join("\n");
}

export const CUTOVER_PREFLIGHT_READ_ONLY_GIT_COMMANDS = Object.freeze(
  Object.fromEntries(
    Object.entries(ALLOWED_GIT_COMMANDS).map(([command, operations]) => [
      command,
      operations instanceof Set ? [...operations] : true,
    ]),
  ),
);
