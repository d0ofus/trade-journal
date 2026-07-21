import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HistoryScanOperationalError,
  scanHistoryRepository,
} from "./history-scanner.mjs";

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "trade-journal-history-safety-"));
}

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function initializeRepository(root) {
  git(root, ["init", "--quiet"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "user.name", "History Safety Test"]);
  git(root, ["config", "user.email", "history-safety@example.test"]);
}

function commitFile(root, filename, content, message) {
  writeFileSync(path.join(root, filename), content);
  git(root, ["add", "--", filename]);
  git(root, ["commit", "--quiet", "-m", message]);
}

function repositoryRefs(root) {
  return git(root, ["for-each-ref", "--include-root-refs", "--format=%(refname)"])
    .split(/\r?\n/)
    .filter(Boolean);
}

function scan(root, overrides = {}) {
  return scanHistoryRepository(root, {
    allowlistEntries: [],
    approvedRefs: repositoryRefs(root),
    identityScope: "preserve",
    signatureScope: "strip",
    ...overrides,
  });
}

function brokerageCandidate() {
  return ["DU", "12345678"].join("");
}

function providerCandidate() {
  return ["sk-", "a".repeat(24)].join("");
}

test("classifies findings reachable from approved refs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "candidate");

    const report = scan(root);
    assert.equal(report.complete, true);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.reachability === "ref-reachable",
      ),
      true,
    );
    assert.equal(JSON.stringify(report).includes(brokerageCandidate()), false);
    assert.equal(report.ownerDecisions.rewriteAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies replaced commits retained only by reflogs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "baseline.txt", "clean\n", "baseline");
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "candidate");
    git(root, ["reset", "--hard", "HEAD~1"]);
    rmSync(path.join(root, ".git", "ORIG_HEAD"), { force: true });

    const report = scan(root);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.reachability === "reflog-only",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies private binary artifacts retained by dangling trees", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const blob = git(root, ["hash-object", "-w", "--stdin"], {
      input: Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), Buffer.from([1, 2, 3])]),
    }).trim();
    git(root, ["mktree"], { input: `100644 blob ${blob}\tarchive.db\n` });

    const report = scan(root);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "database-artifact" && item.reachability === "dangling-tree",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies standalone blobs without inventing historical paths", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    git(root, ["hash-object", "-w", "--stdin"], { input: `${brokerageCandidate()}\n` });

    const report = scan(root);
    const finding = report.findings.find(
      (item) => item.ruleId === "brokerage-account-id" && item.reachability === "object-only",
    );
    assert.ok(finding);
    assert.equal(finding.path, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withholds malformed Git filename bytes while still scanning their blobs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const blob = git(root, ["hash-object", "-w", "--stdin"], { input: `${brokerageCandidate()}\n` }).trim();
    const treeInput = Buffer.concat([
      Buffer.from(`100644 blob ${blob}\tbad-`, "ascii"),
      Buffer.from([0xff]),
      Buffer.from("-name\0", "ascii"),
    ]);
    git(root, ["mktree", "-z"], { input: treeInput });

    const report = scan(root);
    const malformed = report.findings.find((item) => item.ruleId === "malformed-git-path");
    assert.ok(malformed);
    assert.equal(malformed.path, null);
    assert.equal(JSON.stringify(report).includes("bad-"), false);
    assert.equal(report.findings.some((item) => item.ruleId === "brokerage-account-id"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps commit identities out of findings and reports counts only", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe commit");

    const report = scan(root);
    const serialized = JSON.stringify(report);
    assert.equal(report.ownerDecisions.distinctAuthorIdentityCount, 1);
    assert.equal(report.ownerDecisions.distinctCommitterIdentityCount, 1);
    assert.equal(serialized.includes("History Safety Test"), false);
    assert.equal(serialized.includes("history-safety@example.test"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires an explicit strip decision before rewriting signed commits", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const tree = git(root, ["mktree"], { input: "" }).trim();
    const commit = [
      `tree ${tree}`,
      "author History Safety Test <history-safety@example.test> 1700000000 +0000",
      "committer History Safety Test <history-safety@example.test> 1700000000 +0000",
      "gpgsig-sha256 -----BEGIN PGP SIGNATURE-----",
      " placeholder",
      " -----END PGP SIGNATURE-----",
      "",
      "signed fixture",
      "",
    ].join("\n");
    const commitId = git(root, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: commit }).trim();
    git(root, ["update-ref", "refs/heads/main", commitId]);

    const stopped = scan(root, { signatureScope: "abort-on-signed" });
    assert.equal(stopped.ownerDecisions.signedCommitCount, 1);
    assert.equal(stopped.ownerDecisions.resolved, true);
    assert.equal(stopped.ownerDecisions.rewriteAllowed, false);
    assert.equal(scan(root, { signatureScope: "strip" }).ownerDecisions.rewriteAllowed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("produces byte-stable public reports and evidence digests", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "candidate");

    const first = scan(root);
    const second = scan(root);
    assert.deepEqual(second, first);
    assert.equal(second.evidenceDigest, first.evidenceDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed instead of silently scanning a parent repository", () => {
  const root = temporaryDirectory();
  try {
    assert.throws(
      () => scan(root),
      (error) =>
        error instanceof HistoryScanOperationalError &&
        ["NOT_GIT_REPOSITORY", "REPOSITORY_ROOT_MISMATCH"].includes(error.code),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports CLI bootstrap failures without paths, values, or stack traces", () => {
  const root = temporaryDirectory();
  try {
    const scriptDirectory = path.join(root, "scripts", "repository-safety");
    mkdirSync(scriptDirectory, { recursive: true });
    copyFileSync(new URL("./history-cli.mjs", import.meta.url), path.join(scriptDirectory, "history-cli.mjs"));
    const result = spawnSync(process.execPath, [path.join(scriptDirectory, "history-cli.mjs")], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(root), false);
    assert.match(result.stderr, /SCANNER_BOOTSTRAP_FAILED/);
    assert.equal(result.stderr.includes(" at "), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps path aliases separated by reachability and refuses unapproved refs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "approved path");
    const primaryBranch = git(root, ["branch", "--show-current"]).trim();
    git(root, ["checkout", "--quiet", "-b", "unsafe"]);
    git(root, ["mv", "candidate.txt", ".env"]);
    git(root, ["commit", "--quiet", "-m", "unapproved alias"]);
    git(root, ["checkout", "--quiet", primaryBranch]);

    const report = scan(root, { approvedRefs: ["HEAD", `refs/heads/${primaryBranch}`] });
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "local-environment-file" && item.reachability === "unapproved-ref",
      ),
      true,
    );
    assert.equal(report.scope.unapprovedRefCount, 1);
    assert.equal(report.ownerDecisions.rewriteAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires explicit approved-ref scope before allowing a rewrite", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const report = scanHistoryRepository(root, {
      allowlistEntries: [],
      identityScope: "preserve",
      signatureScope: "strip",
    });
    assert.equal(report.scope.refScopeExplicit, false);
    assert.equal(report.ownerDecisions.rewriteAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inventories both reflog endpoints and reports orphan reflog files", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "baseline.txt", "clean\n", "baseline");
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "candidate");
    git(root, ["reset", "--hard", "HEAD~1"]);
    rmSync(path.join(root, ".git", "ORIG_HEAD"), { force: true });
    const orphanDirectory = path.join(root, ".git", "logs", "refs", "heads");
    mkdirSync(orphanDirectory, { recursive: true });
    copyFileSync(path.join(root, ".git", "logs", "HEAD"), path.join(orphanDirectory, "orphaned"));

    const report = scan(root);
    assert.equal(report.scope.orphanReflogCount, 1);
    assert.equal(report.scope.reflogRootCount >= 2, true);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.reachability === "reflog-only",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inventories detached HEAD as a root ref", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "baseline.txt", "clean\n", "baseline");
    commitFile(root, "main.txt", "clean\n", "main");
    const primaryBranch = git(root, ["branch", "--show-current"]).trim();
    git(root, ["checkout", "--quiet", "--detach", "HEAD~1"]);
    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "detached candidate");

    const report = scan(root, { approvedRefs: [`refs/heads/${primaryBranch}`] });
    assert.equal(report.scope.rootRefCount >= 1, true);
    assert.equal(report.scope.unapprovedRefCount, 1);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.reachability === "unapproved-ref",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags attributed opaque binary blobs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "ordinary.bin", Buffer.from([1, 0, 2, 3]), "binary");
    const report = scan(root);
    assert.equal(report.findings.some((item) => item.ruleId === "opaque-binary-object"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows only an exact reviewed binary path and digest", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const content = Buffer.from([1, 0, 2, 3]);
    commitFile(root, "reviewed.ico", content, "reviewed binary");
    const fileSha256 = createHash("sha256").update(content).digest("hex");
    const allowlistEntries = [
      {
        ruleId: "opaque-binary-object",
        path: "reviewed.ico",
        fileSha256,
      },
    ];

    const reviewed = scan(root, { allowlistEntries });
    assert.equal(reviewed.findings.some((item) => item.ruleId === "opaque-binary-object"), false);

    const wrongDigest = scan(root, {
      allowlistEntries: [{ ...allowlistEntries[0], fileSha256: "0".repeat(64) }],
    });
    assert.equal(wrongDigest.findings.some((item) => item.ruleId === "opaque-binary-object"), true);

    const wrongCase = scan(root, {
      allowlistEntries: [{ ...allowlistEntries[0], path: "Reviewed.ico" }],
    });
    assert.equal(wrongCase.findings.some((item) => item.ruleId === "opaque-binary-object"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not allow a reviewed binary blob through an unreviewed alias", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const content = Buffer.from([1, 0, 2, 3]);
    writeFileSync(path.join(root, "reviewed.ico"), content);
    copyFileSync(path.join(root, "reviewed.ico"), path.join(root, "copy.ico"));
    git(root, ["add", "--", "reviewed.ico", "copy.ico"]);
    git(root, ["commit", "--quiet", "-m", "aliased binary"]);
    const report = scan(root, {
      allowlistEntries: [
        {
          ruleId: "opaque-binary-object",
          path: "reviewed.ico",
          fileSha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    });

    assert.equal(report.findings.some((item) => item.ruleId === "opaque-binary-object"), true);

    const fullyReviewed = scan(root, {
      allowlistEntries: [
        {
          ruleId: "opaque-binary-object",
          path: "reviewed.ico",
          fileSha256: createHash("sha256").update(content).digest("hex"),
        },
        {
          ruleId: "opaque-binary-object",
          path: "copy.ico",
          fileSha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    });
    assert.equal(fullyReviewed.findings.some((item) => item.ruleId === "opaque-binary-object"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not let a reviewed binary exception suppress magic-file findings", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const content = Buffer.concat([Buffer.from("SQLite format 3\0", "binary"), Buffer.from([1, 2, 3])]);
    commitFile(root, "reviewed.ico", content, "magic binary");
    const report = scan(root, {
      allowlistEntries: [
        {
          ruleId: "opaque-binary-object",
          path: "reviewed.ico",
          fileSha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    });

    assert.equal(report.findings.some((item) => item.ruleId === "database-artifact"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects noncanonical and duplicate reviewed binary entries", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const entry = {
      ruleId: "opaque-binary-object",
      path: "reviewed.ico",
      fileSha256: "0".repeat(64),
    };

    assert.throws(
      () => scan(root, { allowlistEntries: [{ ...entry, path: "./reviewed.ico" }] }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "INVALID_BINARY_ALLOWLIST",
    );
    assert.throws(
      () => scan(root, { allowlistEntries: [entry, { ...entry }] }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "DUPLICATE_BINARY_ALLOWLIST",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed for invalid owner decisions and oversized blobs", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    assert.throws(
      () => scan(root, { identityScope: "unknown" }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "INVALID_IDENTITY_SCOPE",
    );
    assert.throws(
      () => scan(root, { signatureScope: "unknown" }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "INVALID_SIGNATURE_SCOPE",
    );
    assert.throws(
      () => scan(root, { maxBlobBytes: 1 }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "BLOB_SIZE_LIMIT",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed for object alternates and partial-clone markers", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const alternates = path.join(root, ".git", "objects", "info", "alternates");
    writeFileSync(alternates, `${root}\n`);
    assert.throws(
      () => scan(root),
      (error) => error instanceof HistoryScanOperationalError && error.code === "OBJECT_ALTERNATES_PRESENT",
    );
    rmSync(alternates);

    git(root, ["config", "extensions.partialClone", "origin"]);
    assert.throws(
      () => scan(root),
      (error) => error instanceof HistoryScanOperationalError && error.code === "PARTIAL_CLONE_PRESENT",
    );
    git(root, ["config", "--unset", "extensions.partialClone"]);
    writeFileSync(path.join(root, ".git", "objects", "pack", "fixture.promisor"), "");
    assert.throws(
      () => scan(root),
      (error) => error instanceof HistoryScanOperationalError && error.code === "PARTIAL_CLONE_PRESENT",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies symlink and gitlink entries without following them", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "baseline.txt", "clean\n", "baseline");
    const targetCommit = git(root, ["rev-parse", "HEAD"]).trim();
    const linkBlob = git(root, ["hash-object", "-w", "--stdin"], { input: "target.txt" }).trim();
    const tree = git(root, ["mktree"], {
      input: `120000 blob ${linkBlob}\tlink\n160000 commit ${targetCommit}\tmodule\n`,
    }).trim();
    const commit = git(root, ["commit-tree", tree, "-p", targetCommit, "-m", "special entries"]).trim();
    git(root, ["update-ref", "HEAD", commit]);

    const report = scan(root);
    assert.equal(report.findings.some((item) => item.ruleId === "symbolic-link"), true);
    assert.equal(report.findings.some((item) => item.ruleId === "git-submodule"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("counts annotated tag identities and non-PGP signatures without exposing them", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    const tagObject = [
      `object ${commit}`,
      "type commit",
      "tag reviewed",
      "tagger Private Tagger <tagger@test.invalid> 1700000000 +0000",
      "",
      "reviewed tag",
      "-----BEGIN SSH SIGNATURE-----",
      "placeholder",
      "-----END SSH SIGNATURE-----",
      "",
    ].join("\n");
    const tag = git(root, ["hash-object", "-t", "tag", "-w", "--stdin"], { input: tagObject }).trim();
    git(root, ["update-ref", "refs/tags/reviewed", tag]);

    const report = scan(root, { signatureScope: "abort-on-signed" });
    assert.equal(report.ownerDecisions.signedTagCount, 1);
    assert.equal(report.ownerDecisions.distinctTaggerIdentityCount, 1);
    assert.equal(report.ownerDecisions.rewriteAllowed, false);
    assert.equal(JSON.stringify(report).includes("Private Tagger"), false);
    assert.equal(JSON.stringify(report).includes("tagger@test.invalid"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when asked to scan a nested directory of a repository", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    mkdirSync(path.join(root, "nested"));
    assert.throws(
      () => scan(path.join(root, "nested")),
      (error) => error instanceof HistoryScanOperationalError && error.code === "REPOSITORY_ROOT_MISMATCH",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses distinct CLI exit statuses for approval, review, and operational failure", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const script = fileURLToPath(new URL("./history-cli.mjs", import.meta.url));
    const refArguments = repositoryRefs(root).flatMap((name) => ["--ref", name]);
    const approved = spawnSync(
      process.execPath,
      [script, "--root", root, ...refArguments, "--identity-scope", "preserve", "--signature-scope", "strip"],
      { encoding: "utf8" },
    );
    assert.equal(approved.status, 0, `${approved.stdout}\n${approved.stderr}`);

    const undecided = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
    assert.equal(undecided.status, 1);

    commitFile(root, "candidate.txt", `${brokerageCandidate()}\n`, "candidate");
    const findingRefs = repositoryRefs(root).flatMap((name) => ["--ref", name]);
    const review = spawnSync(
      process.execPath,
      [script, "--root", root, ...findingRefs, "--identity-scope", "preserve", "--signature-scope", "strip"],
      { encoding: "utf8" },
    );
    assert.equal(review.status, 1);
    assert.equal(review.stdout.includes(brokerageCandidate()), false);

    const operational = spawnSync(process.execPath, [script, "--root", path.join(root, "missing")], {
      encoding: "utf8",
    });
    assert.equal(operational.status, 2);
    assert.equal(operational.stderr.includes(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores replace-object substitution and scans the original object", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const sensitive = git(root, ["hash-object", "-w", "--stdin"], { input: brokerageCandidate() }).trim();
    const replacement = git(root, ["hash-object", "-w", "--stdin"], { input: "ABCDEFGHIJ" }).trim();
    git(root, ["replace", sensitive, replacement]);

    const report = scan(root);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.reachability === "object-only",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects inherited Git environment overrides", () => {
  const root = temporaryDirectory();
  const previous = process.env.GIT_OBJECT_DIRECTORY;
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const approvedRefs = repositoryRefs(root);
    process.env.GIT_OBJECT_DIRECTORY = path.join(root, "substituted-objects");
    assert.throws(
      () =>
        scanHistoryRepository(root, {
          allowlistEntries: [],
          approvedRefs,
          identityScope: "preserve",
          signatureScope: "strip",
        }),
      (error) =>
        error instanceof HistoryScanOperationalError && error.code === "GIT_ENVIRONMENT_OVERRIDE_PRESENT",
    );
  } finally {
    if (previous == null) delete process.env.GIT_OBJECT_DIRECTORY;
    else process.env.GIT_OBJECT_DIRECTORY = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects case-variant Git environment overrides", () => {
  const root = temporaryDirectory();
  const key = "git_object_directory";
  const previous = process.env[key];
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const approvedRefs = repositoryRefs(root);
    process.env[key] = path.join(root, "substituted-objects");
    assert.throws(
      () =>
        scanHistoryRepository(root, {
          allowlistEntries: [],
          approvedRefs,
          identityScope: "preserve",
          signatureScope: "strip",
        }),
      (error) =>
        error instanceof HistoryScanOperationalError && error.code === "GIT_ENVIRONMENT_OVERRIDE_PRESENT",
    );
  } finally {
    if (previous == null) delete process.env[key];
    else process.env[key] = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans ref names, reflog messages, tree paths, tag names, and unknown headers", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, `${brokerageCandidate()}.txt`, "clean\n", "metadata surfaces");
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["update-ref", "-m", brokerageCandidate(), "refs/heads/metadata", commit]);
    git(root, ["update-ref", `refs/heads/${brokerageCandidate()}`, commit]);
    copyFileSync(
      path.join(root, ".git", "logs", "HEAD"),
      path.join(root, ".git", "logs", "refs", "heads", `${brokerageCandidate()}-orphan`),
    );
    const tagObject = [
      `object ${commit}`,
      "type commit",
      `tag ${brokerageCandidate()}`,
      "tagger History Safety Test <history-safety@example.test> 1700000000 +0000",
      `review ${brokerageCandidate()}`,
      "",
      "safe body",
      "",
    ].join("\n");
    const tag = git(root, ["hash-object", "-t", "tag", "-w", "--stdin"], { input: tagObject }).trim();
    git(root, ["update-ref", "refs/tags/metadata", tag]);

    const report = scan(root);
    const surfaces = new Set(
      report.findings.filter((item) => item.ruleId === "brokerage-account-id").map((item) => item.surface),
    );
    for (const surface of ["ref-name", "reflog-message", "reflog-path", "tree-path", "tag-name", "tag-header"]) {
      assert.equal(surfaces.has(surface), true, surface);
    }
    assert.equal(report.scope.orphanReflogCount >= 1, true);
    assert.equal(JSON.stringify(report).includes(brokerageCandidate()), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans non-email identity metadata and structural header names", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    git(root, ["config", "user.name", brokerageCandidate()]);
    commitFile(root, "safe.txt", "clean\n", "identity metadata");
    git(root, ["config", "user.name", "History Safety Test"]);
    const parent = git(root, ["rev-parse", "HEAD"]).trim();
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]).trim();
    const commitObject = [
      `tree ${tree}`,
      `parent ${parent}`,
      "author History Safety Test <history-safety@example.test> 1700000000 +0000",
      "committer History Safety Test <history-safety@example.test> 1700000000 +0000",
      `${providerCandidate()} harmless`,
      "",
      "header metadata",
      "",
    ].join("\n");
    const commit = git(root, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: commitObject }).trim();
    git(root, ["update-ref", "refs/heads/header", commit]);

    const report = scan(root);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "brokerage-account-id" && item.surface === "reflog-identity",
      ),
      true,
    );
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "provider-secret-token" && item.surface === "commit-header",
      ),
      true,
    );
    assert.equal(report.ownerDecisions.distinctReflogIdentityCount >= 1, true);
    assert.equal(JSON.stringify(report).includes(brokerageCandidate()), false);
    assert.equal(JSON.stringify(report).includes(providerCandidate()), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("interprets a directly tagged subtree from its tagged root", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    const blob = git(root, ["hash-object", "-w", "--stdin"], { input: "select 1;\n" }).trim();
    const leaf = git(root, ["mktree"], { input: `100644 blob ${blob}\tmigration.sql\n` }).trim();
    const migrations = git(root, ["mktree"], { input: `040000 tree ${leaf}\t001\n` }).trim();
    const prisma = git(root, ["mktree"], { input: `040000 tree ${migrations}\tmigrations\n` }).trim();
    const tree = git(root, ["mktree"], { input: `040000 tree ${prisma}\tprisma\n` }).trim();
    const commit = git(root, ["commit-tree", tree, "-m", "migration fixture"]).trim();
    git(root, ["update-ref", "refs/heads/main", commit]);
    git(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    const tagObject = [
      `object ${leaf}`,
      "type tree",
      "tag subtree",
      "tagger History Safety Test <history-safety@example.test> 1700000000 +0000",
      "",
      "subtree",
      "",
    ].join("\n");
    const tag = git(root, ["hash-object", "-t", "tag", "-w", "--stdin"], { input: tagObject }).trim();
    git(root, ["update-ref", "refs/tags/subtree", tag]);

    const report = scan(root);
    assert.equal(
      report.findings.some(
        (item) => item.ruleId === "database-artifact" && item.reachability === "ref-reachable",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("binds evidence to the exact object inventory and allowlist policy", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    git(root, ["hash-object", "-w", "--stdin"], { input: "first clean object\n" });
    const first = scan(root);
    git(root, ["hash-object", "-w", "--stdin"], { input: "second clean object\n" });
    const second = scan(root);
    assert.notEqual(second.scope.objectInventoryDigest, first.scope.objectInventoryDigest);
    assert.notEqual(second.evidenceDigest, first.evidenceDigest);

    const withPolicy = scan(root, {
      allowlistEntries: [{ ruleId: "database-url", path: "fixture.txt", fileSha256: "0".repeat(64) }],
    });
    assert.notEqual(withPolicy.allowlistDigest, second.allowlistDigest);
    assert.notEqual(withPolicy.evidenceDigest, second.evidenceDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when repository evidence changes during a scan", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    assert.throws(
      () =>
        scan(root, {
          _testBeforeFinalInventory: () => git(root, ["update-ref", "refs/heads/late", "HEAD"]),
        }),
      (error) =>
        error instanceof HistoryScanOperationalError && error.code === "REPOSITORY_CHANGED_DURING_SCAN",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repeats completeness checks after scanning", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    assert.throws(
      () =>
        scan(root, {
          _testBeforeFinalInventory: () => {
            const metadata = path.join(root, ".git", "worktrees", "late");
            mkdirSync(metadata, { recursive: true });
            writeFileSync(path.join(metadata, "HEAD"), `${git(root, ["rev-parse", "HEAD"]).trim()}\n`);
          },
        }),
      (error) => error instanceof HistoryScanOperationalError && error.code === "LINKED_WORKTREES_PRESENT",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses linked-worktree metadata instead of missing another HEAD", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    commitFile(root, "safe.txt", "clean\n", "safe");
    const metadata = path.join(root, ".git", "worktrees", "linked");
    mkdirSync(metadata, { recursive: true });
    writeFileSync(path.join(metadata, "HEAD"), `${git(root, ["rev-parse", "HEAD"]).trim()}\n`);
    assert.throws(
      () => scan(root),
      (error) => error instanceof HistoryScanOperationalError && error.code === "LINKED_WORKTREES_PRESENT",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
