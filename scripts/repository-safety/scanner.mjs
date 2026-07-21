import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPOSITORY_SAFETY_ALLOWLIST } from "./allowlist.mjs";
import { CONTENT_RULES, PATH_RULES, SECRET_ENVIRONMENT_NAME } from "./rules.mjs";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function normalizedPath(filePath) {
  const platformNormalized = path.sep === "\\" ? filePath.replaceAll("\\", "/") : filePath;
  return platformNormalized.replace(/^\.\//, "");
}

function containsNul(buffer) {
  return buffer.includes(0);
}

function decodeUtf8Strict(buffer, label) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw new Error(`${label} is not valid UTF-8; repository safety scanning stopped.`);
  }
}

function canonicalBytes(buffer) {
  if (containsNul(buffer)) return buffer;
  let text;
  try {
    text = UTF8_DECODER.decode(buffer);
  } catch {
    return buffer;
  }
  return Buffer.from(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
}

function swappedUtf16(buffer) {
  const swapped = Buffer.alloc(Math.max(0, buffer.length - 2));
  for (let index = 2; index + 1 < buffer.length; index += 2) {
    swapped[index - 2] = buffer[index + 1];
    swapped[index - 1] = buffer[index];
  }
  return swapped.toString("utf16le");
}

function decodeForContentScan(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return swappedUtf16(buffer);
  }

  const pairs = Math.floor(buffer.length / 2);
  if (pairs >= 4) {
    let evenNuls = 0;
    let oddNuls = 0;
    for (let index = 0; index < pairs * 2; index += 2) {
      if (buffer[index] === 0) evenNuls += 1;
      if (buffer[index + 1] === 0) oddNuls += 1;
    }
    if (oddNuls / pairs > 0.3 && evenNuls / pairs < 0.1) return buffer.toString("utf16le");
    if (evenNuls / pairs > 0.3 && oddNuls / pairs < 0.1) {
      const withBom = Buffer.concat([Buffer.from([0xfe, 0xff]), buffer]);
      return swappedUtf16(withBom);
    }
  }

  return buffer.toString("utf8");
}

export function canonicalFileSha256(buffer) {
  return createHash("sha256").update(canonicalBytes(buffer)).digest("hex");
}

function allowlistKey(entry) {
  return `${entry.ruleId}\0${normalizedPath(entry.path)}\0${entry.fileSha256.toLowerCase()}`;
}

function buildAllowlist(entries) {
  return new Set(entries.map(allowlistKey));
}

function isAllowed(allowlist, ruleId, filePath, fileSha256) {
  return allowlist.has(`${ruleId}\0${filePath}\0${fileSha256}`);
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function finding(ruleId, filePath, source, line = null) {
  return { ruleId, path: filePath, source, line };
}

function scanEnvironmentAssignments(text, filePath, fileSha256, allowlist, source) {
  if (!/(^|\/)\.env(?:\.[^/]+)?$/i.test(filePath)) return [];

  const findings = [];
  for (const [index, line] of text.split("\n").entries()) {
    const assignment = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!assignment || !SECRET_ENVIRONMENT_NAME.test(assignment[1])) continue;
    const rawValue = assignment[2].trim();
    let value;
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const closingQuote = rawValue.indexOf(rawValue[0], 1);
      value = (closingQuote >= 1 ? rawValue.slice(1, closingQuote) : rawValue.slice(1)).trim();
    } else {
      value = rawValue.replace(/(?:^|\s+)#.*$/, "").trim();
    }
    if (!value || isAllowed(allowlist, "nonempty-secret-environment-value", filePath, fileSha256)) continue;
    findings.push(finding("nonempty-secret-environment-value", filePath, source, index + 1));
  }
  return findings;
}

export function scanBuffer({
  relativePath,
  buffer,
  allowlistEntries = REPOSITORY_SAFETY_ALLOWLIST,
  symbolicLink = false,
  source = "worktree",
}) {
  const filePath = normalizedPath(relativePath);
  const fileSha256 = canonicalFileSha256(buffer);
  const allowlist = buildAllowlist(allowlistEntries);
  const findings = [];

  if (symbolicLink) {
    findings.push(finding("symbolic-link", filePath, source));
    return findings;
  }

  for (const rule of PATH_RULES) {
    if (rule.test(filePath) && !isAllowed(allowlist, rule.id, filePath, fileSha256)) {
      findings.push(finding(rule.id, filePath, source));
    }
  }

  const text = decodeForContentScan(buffer).replace(/\r\n?/g, "\n");
  for (const rule of CONTENT_RULES) {
    if (isAllowed(allowlist, rule.id, filePath, fileSha256)) continue;
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      if (rule.allowMatch?.(match[0])) continue;
      findings.push(finding(rule.id, filePath, source, lineNumberAt(text, match.index ?? 0)));
    }
  }
  findings.push(...scanEnvironmentAssignments(text, filePath, fileSha256, allowlist, source));
  return findings;
}

function splitNullDelimited(output, label) {
  const entries = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    const value = output.subarray(start, index);
    if (value.length > 0) entries.push(decodeUtf8Strict(value, label));
    start = index + 1;
  }
  if (start !== output.length) throw new Error(`${label} was not NUL terminated.`);
  return entries;
}

export function listRepositoryCandidates(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
  );
  return splitNullDelimited(output, "Git candidate path")
    .map(normalizedPath)
    .sort((left, right) => left.localeCompare(right));
}

export function listIndexEntries(root) {
  const output = execFileSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  return splitNullDelimited(output, "Git index entry")
    .map((entry) => {
      const separator = entry.indexOf("\t");
      if (separator < 0) throw new Error("Git index entry did not contain a path separator.");
      const [mode, objectId, stage] = entry.slice(0, separator).split(" ");
      if (!mode || !objectId || stage !== "0") {
        throw new Error("Git index contains an unsupported or unmerged entry.");
      }
      return { mode, objectId, path: normalizedPath(entry.slice(separator + 1)) };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listSparseIndexPaths(root) {
  const output = execFileSync("git", ["ls-files", "-v", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  return new Set(
    splitNullDelimited(output, "Git index flag entry")
      .filter((entry) => entry.startsWith("S "))
      .map((entry) => normalizedPath(entry.slice(2))),
  );
}

function hasStagedChanges(root) {
  const result = spawnSync("git", ["diff", "--cached", "--quiet", "--exit-code"], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error("Git could not determine whether staged changes exist.");
}

function readIndexBlob(root, objectId) {
  return execFileSync("git", ["cat-file", "blob", objectId], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
}

function stableFindingOrder(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.source.localeCompare(right.source) ||
    left.ruleId.localeCompare(right.ruleId) ||
    (left.line ?? 0) - (right.line ?? 0)
  );
}

export function scanRepository(root = process.cwd(), allowlistEntries = REPOSITORY_SAFETY_ALLOWLIST) {
  const resolvedRoot = path.resolve(root);
  const candidates = listRepositoryCandidates(resolvedRoot);
  const indexEntries = listIndexEntries(resolvedRoot);
  const sparseIndexPaths = listSparseIndexPaths(resolvedRoot);
  const scanIndexContent = hasStagedChanges(resolvedRoot);
  const indexVersions = new Set();
  const indexSymlinks = new Set();
  const findings = [];
  let filesScanned = 0;

  for (const entry of indexEntries) {
    const symbolicLink = entry.mode === "120000";
    const submodule = entry.mode === "160000";
    if (!scanIndexContent && !symbolicLink && !submodule && !sparseIndexPaths.has(entry.path)) continue;
    if (submodule) {
      findings.push(finding("git-submodule", entry.path, "index"));
      filesScanned += 1;
      continue;
    }
    const buffer = readIndexBlob(resolvedRoot, entry.objectId);
    findings.push(
      ...scanBuffer({
        relativePath: entry.path,
        buffer,
        allowlistEntries,
        symbolicLink,
        source: "index",
      }),
    );
    indexVersions.add(`${entry.path}\0${canonicalFileSha256(buffer)}\0${symbolicLink}`);
    if (symbolicLink) indexSymlinks.add(entry.path);
    filesScanned += 1;
  }

  for (const relativePath of candidates) {
    const absolutePath = path.resolve(resolvedRoot, relativePath);
    const relativeToRoot = path.relative(resolvedRoot, absolutePath);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot) ||
      !existsSync(absolutePath)
    ) {
      continue;
    }

    const stat = lstatSync(absolutePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    const symbolicLink = stat.isSymbolicLink();
    if (indexSymlinks.has(relativePath)) continue;
    const buffer = symbolicLink ? Buffer.alloc(0) : readFileSync(absolutePath);
    const versionKey = `${relativePath}\0${canonicalFileSha256(buffer)}\0${symbolicLink}`;
    if (indexVersions.has(versionKey)) continue;
    findings.push(
      ...scanBuffer({ relativePath, buffer, allowlistEntries, symbolicLink, source: "worktree" }),
    );
    filesScanned += 1;
  }

  findings.sort(stableFindingOrder);
  return { filesScanned, findings };
}

function redactedPath(filePath) {
  let redacted = filePath;
  for (const rule of CONTENT_RULES) {
    redacted = redacted.replace(new RegExp(rule.pattern.source, rule.pattern.flags), "[REDACTED]");
  }
  return redacted.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    return `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

export function redactResult(result) {
  return {
    filesScanned: result.filesScanned,
    findings: result.findings.map((item) => ({ ...item, path: redactedPath(item.path) })),
  };
}

export function formatTextReport(result) {
  if (result.findings.length === 0) {
    return `Repository safety scan passed (${result.filesScanned} candidate versions, 0 findings).`;
  }

  const lines = [
    `Repository safety scan failed (${result.findings.length} findings in ${result.filesScanned} candidate versions).`,
  ];
  for (const item of redactResult(result).findings) {
    const location = item.line == null ? item.path : `${item.path}:${item.line}`;
    lines.push(`- ${item.ruleId} ${item.source}:${location} [REDACTED]`);
  }
  return lines.join("\n");
}
