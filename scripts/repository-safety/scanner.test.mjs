import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalFileSha256,
  formatTextReport,
  redactResult,
  scanBuffer,
  scanRepository,
} from "./scanner.mjs";

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "trade-journal-repository-safety-"));
}

test("scans Git-tracked and non-ignored candidate files", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
    writeFileSync(path.join(root, "safe.txt"), "deterministic demo\n");
    execFileSync("git", ["add", "safe.txt"], { cwd: root });
    const account = ["DU", "12345678"].join("");
    writeFileSync(path.join(root, "candidate.txt"), `account=${account}\n`);

    const result = scanRepository(root, []);
    assert.equal(result.filesScanned, 2);
    assert.deepEqual(result.findings, [
      { ruleId: "brokerage-account-id", path: "candidate.txt", source: "worktree", line: 1 },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("redacts matched values from reports", () => {
  const token = ["ghp_", "a".repeat(32)].join("");
  const findings = scanBuffer({ relativePath: "candidate.txt", buffer: Buffer.from(token), allowlistEntries: [] });
  const report = formatTextReport({ filesScanned: 1, findings });

  assert.equal(findings[0]?.ruleId, "github-token");
  assert.equal(report.includes(token), false);
  assert.match(report, /github-token worktree:candidate\.txt:1 \[REDACTED\]/);
});

test("requires exact canonical file hashes for financial fixture allowlisting", () => {
  const pathName = "fixtures/sample.csv";
  const original = Buffer.from("Account,Symbol\nDEMO-ACCOUNT,DEMOA\n");
  const allowlistEntries = [
    {
      ruleId: "financial-export-file",
      path: pathName,
      fileSha256: canonicalFileSha256(original),
      reason: "Synthetic unit fixture.",
    },
  ];

  assert.deepEqual(scanBuffer({ relativePath: pathName, buffer: original, allowlistEntries }), []);
  assert.deepEqual(
    scanBuffer({
      relativePath: pathName,
      buffer: Buffer.from("Account,Symbol\nDEMO-ACCOUNT,CHANGED\n"),
      allowlistEntries,
    }),
    [{ ruleId: "financial-export-file", path: pathName, source: "worktree", line: null }],
  );
});

test("canonical hashes are stable across LF and CRLF", () => {
  assert.equal(
    canonicalFileSha256(Buffer.from("one\ntwo\n")),
    canonicalFileSha256(Buffer.from("one\r\ntwo\r\n")),
  );
});

test("detects private paths and nonempty environment secrets", () => {
  const password = ["local-", "password"].join("");
  const findings = scanBuffer({
    relativePath: ".env.local",
    buffer: Buffer.from(`AUTH_PASSWORD=${password}\n`),
    allowlistEntries: [],
  });

  assert.deepEqual(findings, [
    { ruleId: "local-environment-file", path: ".env.local", source: "worktree", line: null },
    { ruleId: "nonempty-secret-environment-value", path: ".env.local", source: "worktree", line: 1 },
  ]);
});

test("keeps ordinary URLs, hashes, labels, and empty environment placeholders quiet", () => {
  const content = [
    "NEXTAUTH_SECRET=\"\"",
    "AUTH_PASSWORD=\"\"",
    "documentation=https://example.com/reference",
    `sha256=${"a".repeat(64)}`,
    "label=Gross realized P&L",
  ].join("\n");

  assert.deepEqual(
    scanBuffer({ relativePath: ".env.example", buffer: Buffer.from(content), allowlistEntries: [] }),
    [],
  );
});

test("sorts findings deterministically without exposing unusual filename control characters", () => {
  const account = ["U", "12345678"].join("");
  const findings = scanBuffer({
    relativePath: "odd\nname.csv",
    buffer: Buffer.from(`${account}\n`),
    allowlistEntries: [],
  }).reverse();
  const report = formatTextReport({ filesScanned: 1, findings });

  assert.equal(report.includes(account), false);
  assert.equal(report.includes("odd\nname.csv"), false);
  assert.match(report, /odd\\x0aname\.csv/);
});

test("scans staged index content even when the worktree copy is clean", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Repository Safety Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "repository-safety@example.test"], { cwd: root });
    writeFileSync(path.join(root, "candidate.txt"), "clean\n");
    execFileSync("git", ["add", "candidate.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root });

    const token = ["ghp_", "b".repeat(32)].join("");
    writeFileSync(path.join(root, "candidate.txt"), `${token}\n`);
    execFileSync("git", ["add", "candidate.txt"], { cwd: root });
    writeFileSync(path.join(root, "candidate.txt"), "clean again\n");

    const result = scanRepository(root, []);
    assert.equal(result.findings.some((item) => item.ruleId === "github-token" && item.source === "index"), true);
    assert.equal(formatTextReport(result).includes(token), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans NUL-appended, UTF-16LE, and UTF-16BE content", () => {
  const account = ["DU", "87654321"].join("");
  const nulAppended = Buffer.concat([Buffer.from(account, "utf8"), Buffer.from([0])]);
  const utf16Le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(account, "utf16le")]);
  const utf16BeBody = Buffer.from(account, "utf16le");
  for (let index = 0; index < utf16BeBody.length; index += 2) {
    [utf16BeBody[index], utf16BeBody[index + 1]] = [utf16BeBody[index + 1], utf16BeBody[index]];
  }
  const utf16Be = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16BeBody]);

  for (const buffer of [nulAppended, utf16Le, utf16Be]) {
    assert.equal(
      scanBuffer({ relativePath: "candidate.bin", buffer, allowlistEntries: [] }).some(
        (item) => item.ruleId === "brokerage-account-id",
      ),
      true,
    );
  }
});

test("covers SQLite sidecars, broader key blocks, exported lowercase env values, and nested examples", () => {
  assert.deepEqual(
    scanBuffer({ relativePath: "cache.sqlite-wal", buffer: Buffer.from([0]), allowlistEntries: [] }),
    [{ ruleId: "database-artifact", path: "cache.sqlite-wal", source: "worktree", line: null }],
  );

  const keyHeader = ["-----BEGIN ENCRYPTED", "PRIVATE KEY-----"].join(" ");
  assert.equal(
    scanBuffer({ relativePath: "note.txt", buffer: Buffer.from(keyHeader), allowlistEntries: [] })[0]?.ruleId,
    "private-key-block",
  );

  const secret = ["demo", "secret"].join("-");
  assert.equal(
    scanBuffer({
      relativePath: "config/.env.example",
      buffer: Buffer.from(`export _api_token=${secret}\n`),
      allowlistEntries: [],
    })[0]?.ruleId,
    "nonempty-secret-environment-value",
  );
  assert.deepEqual(
    scanBuffer({
      relativePath: "config/.env.example",
      buffer: Buffer.from("export _api_token=\"\"\n"),
      allowlistEntries: [],
    }),
    [],
  );
});

test("redacts sensitive-looking path values in text and JSON reports", () => {
  const token = ["ghp_", "c".repeat(32)].join("");
  const result = {
    filesScanned: 1,
    findings: scanBuffer({
      relativePath: `evidence-${token}.txt`,
      buffer: Buffer.from(token),
      allowlistEntries: [],
    }),
  };

  assert.equal(formatTextReport(result).includes(token), false);
  assert.equal(JSON.stringify(redactResult(result)).includes(token), false);
});

test("does not collapse distinct invalid UTF-8 byte sequences into one allowlist hash", () => {
  assert.notEqual(
    canonicalFileSha256(Buffer.from([0xc3, 0x28])),
    canonicalFileSha256(Buffer.from([0xe2, 0x28, 0xa1])),
  );
});

test("scans sparse index blobs that are absent from the worktree", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Repository Safety Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "repository-safety@example.test"], { cwd: root });
    const account = ["U", "87654321"].join("");
    writeFileSync(path.join(root, "sparse.txt"), `${account}\n`);
    execFileSync("git", ["add", "sparse.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "sparse baseline"], { cwd: root });
    execFileSync("git", ["update-index", "--skip-worktree", "sparse.txt"], { cwd: root });
    rmSync(path.join(root, "sparse.txt"));

    const result = scanRepository(root, []);
    assert.equal(
      result.findings.some((item) => item.ruleId === "brokerage-account-id" && item.source === "index"),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects Git submodule entries without traversing their object IDs", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Repository Safety Test"], { cwd: root });
    execFileSync("git", ["config", "user.email", "repository-safety@example.test"], { cwd: root });
    writeFileSync(path.join(root, "baseline.txt"), "clean\n");
    execFileSync("git", ["add", "baseline.txt"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `160000,${commit},module`], { cwd: root });

    const result = scanRepository(root, []);
    assert.equal(
      result.findings.some(
        (item) => item.ruleId === "git-submodule" && item.path === "module" && item.source === "index",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects Git symlink entries even when the worktree cannot materialize symlinks", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const objectId = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: "target.txt\n",
    }).trim();
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `120000,${objectId},link`], { cwd: root });

    const result = scanRepository(root, []);
    assert.equal(
      result.findings.some(
        (item) => item.ruleId === "symbolic-link" && item.path === "link" && item.source === "index",
      ),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not skip valid root names that begin with two dots", () => {
  const root = temporaryDirectory();
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const account = ["M", "12345678"].join("");
    writeFileSync(path.join(root, "..candidate"), account);

    const result = scanRepository(root, []);
    assert.equal(result.findings[0]?.ruleId, "brokerage-account-id");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects opaque archives and plain SQL outside migration paths", () => {
  assert.equal(
    scanBuffer({ relativePath: "evidence.zip", buffer: Buffer.from([1, 2, 3]), allowlistEntries: [] })[0]?.ruleId,
    "opaque-archive",
  );
  assert.equal(
    scanBuffer({ relativePath: "snapshot.sql", buffer: Buffer.from("SELECT 1;"), allowlistEntries: [] })[0]?.ruleId,
    "database-artifact",
  );
  assert.deepEqual(
    scanBuffer({
      relativePath: "prisma/migrations/20260101000000_example/migration.sql",
      buffer: Buffer.from("CREATE TABLE example (id text);"),
      allowlistEntries: [],
    }),
    [],
  );
});

test("detects contextual credentials, webhooks, JWTs, and personal email addresses", () => {
  const jwt = [`eyJ${"a".repeat(12)}`, "b".repeat(12), "c".repeat(12)].join(".");
  const bearer = `Bearer ${"d".repeat(24)}`;
  const webhook = ["https://hooks.slack.com/services", "A", "B", "C"].join("/");
  const assignment = `client_secret=\"${"e".repeat(20)}\"`;
  const email = ["person", "private.invalid"].join("@");
  const findings = scanBuffer({
    relativePath: "candidate.txt",
    buffer: Buffer.from([jwt, bearer, webhook, assignment, email].join("\n")),
    allowlistEntries: [],
  });

  assert.deepEqual(
    new Set(findings.map((item) => item.ruleId)),
    new Set(["jwt-token", "bearer-credential", "webhook-secret-url", "hardcoded-secret-assignment", "email-address"]),
  );
});

test("treats dotenv comments after empty values as empty", () => {
  assert.deepEqual(
    scanBuffer({
      relativePath: ".env.example",
      buffer: Buffer.from("AUTH_PASSWORD=\"\" # set locally\nexport api_token= # set locally\n"),
      allowlistEntries: [],
    }),
    [],
  );
});

test("reports scanner import failures without stack traces or absolute paths", () => {
  const root = temporaryDirectory();
  try {
    const scriptDirectory = path.join(root, "scripts", "repository-safety");
    mkdirSync(scriptDirectory, { recursive: true });
    copyFileSync(new URL("./cli.mjs", import.meta.url), path.join(scriptDirectory, "cli.mjs"));
    const result = spawnSync(process.execPath, [path.join(scriptDirectory, "cli.mjs")], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.equal(result.stderr.includes(root), false);
    assert.match(result.stderr, /could not complete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
