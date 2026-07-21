import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { REPOSITORY_SAFETY_ALLOWLIST } from "./allowlist.mjs";
import { CONTENT_RULES, PATH_RULES } from "./rules.mjs";
import { scanBuffer } from "./scanner.mjs";

const HISTORY_REPORT_SCHEMA = 1;
const HISTORY_SCANNER_VERSION = "phase17-v3";
const HISTORY_RULE_SET_VERSION = "phase17-history-rules-v3";
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_STRUCTURAL_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_PATH_ALIASES = 100_000;
const OWNER_IDENTITY_SCOPES = new Set(["undecided", "preserve", "rewrite"]);
const OWNER_SIGNATURE_SCOPES = new Set(["undecided", "strip", "abort-on-signed"]);
const ALLOW_MATCH_POLICY_VERSIONS = Object.freeze({
  "hardcoded-secret-assignment": "placeholder-terms-v1",
  "email-address": "example-domains-v1",
});
const PATH_POLICY_VERSIONS = Object.freeze({
  "local-environment-file": "dotenv-except-example-v1",
  "private-credential-file": "private-key-extensions-v1",
  "opaque-archive": "archive-extensions-v1",
  "database-artifact": "database-extensions-and-migration-exception-v1",
  "financial-export-file": "financial-table-extensions-v1",
  "generated-private-output": "generated-output-paths-v1",
  "editor-private-state": "editor-directories-v1",
  "application-backup-export": "timestamped-backup-name-v1",
});
const UNSAFE_GIT_ENVIRONMENT_KEYS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const REACHABILITY_ORDER = new Map([
  ["ref-reachable", 0],
  ["unapproved-ref", 1],
  ["reflog-only", 2],
  ["dangling-tree", 3],
  ["object-only", 4],
]);

export class HistoryScanOperationalError extends Error {
  constructor(code) {
    super("Repository history scan could not complete.");
    this.name = "HistoryScanOperationalError";
    this.code = code;
  }
}

function fail(code) {
  throw new HistoryScanOperationalError(code);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

function runGit(root, args, { input, acceptedStatuses = [0], maxBuffer = 512 * 1024 * 1024, code } = {}) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  }
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "buffer",
    input,
    maxBuffer,
    windowsHide: true,
    env: {
      ...environment,
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      LANG: "C",
      LC_ALL: "C",
    },
  });

  if (result.error || !acceptedStatuses.includes(result.status ?? -1)) fail(code ?? "GIT_COMMAND_FAILED");
  return result.stdout ?? Buffer.alloc(0);
}

function splitLines(buffer) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue;
    const line = buffer.subarray(start, index);
    if (line.length > 0) lines.push(line);
    start = index + 1;
  }
  if (start < buffer.length) lines.push(buffer.subarray(start));
  return lines;
}

function strictUtf8(buffer, code) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    fail(code);
  }
}

function parseOid(value, objectFormat, code = "MALFORMED_GIT_OUTPUT") {
  const length = objectFormat === "sha256" ? 64 : 40;
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) fail(code);
  return value;
}

function parseRefs(buffer, objectFormat) {
  const refs = [];
  for (const line of splitLines(buffer)) {
    const fields = [];
    let start = 0;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== 0) continue;
      fields.push(line.subarray(start, index));
      start = index + 1;
    }
    if (fields.length !== 3 || start !== line.length) fail("MALFORMED_REF_INVENTORY");
    const name = strictUtf8(fields[0], "MALFORMED_REF_NAME");
    const oid = parseOid(fields[1].toString("ascii"), objectFormat, "MALFORMED_REF_INVENTORY");
    const symbolicTarget = strictUtf8(fields[2], "MALFORMED_REF_NAME");
    refs.push({ name, oid, symbolicTarget, raw: line });
  }
  refs.sort((left, right) => bytewiseCompare(left.name, right.name));
  return refs;
}

function sameFilesystemEntry(left, right) {
  const leftStat = statSync(left);
  const rightStat = statSync(right);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function reflogDirectories(gitDir, commonDir) {
  const candidates = [
    { directory: path.join(commonDir, "logs"), label: "common" },
    { directory: path.join(gitDir, "logs"), label: "current-worktree" },
  ];
  const worktreesDirectory = path.join(commonDir, "worktrees");
  if (existsSync(worktreesDirectory)) {
    const worktreesStat = lstatSync(worktreesDirectory);
    if (worktreesStat.isSymbolicLink() || !worktreesStat.isDirectory()) fail("REFLOG_LAYOUT_UNSUPPORTED");
    for (const name of readdirSync(worktreesDirectory).sort(bytewiseCompare)) {
      const metadataDirectory = path.join(worktreesDirectory, name);
      const metadataStat = lstatSync(metadataDirectory);
      if (metadataStat.isSymbolicLink() || !metadataStat.isDirectory()) fail("REFLOG_LAYOUT_UNSUPPORTED");
      candidates.push({ directory: path.join(metadataDirectory, "logs"), label: "linked-worktree" });
    }
  }

  const unique = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate.directory)) continue;
    const candidateStat = lstatSync(candidate.directory);
    if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) fail("REFLOG_LAYOUT_UNSUPPORTED");
    if (unique.some((item) => sameFilesystemEntry(item.directory, candidate.directory))) continue;
    unique.push(candidate);
  }
  return unique;
}

function readReflogFiles(directory, prefix = Buffer.alloc(0)) {
  const files = [];
  for (const name of readdirSync(directory, { encoding: "buffer" }).sort(Buffer.compare)) {
    const absolutePath = path.join(directory, name.toString());
    const entryStat = lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) fail("REFLOG_SYMLINK_PRESENT");
    const relativePath = prefix.length === 0 ? Buffer.from(name) : Buffer.concat([prefix, Buffer.from("/"), name]);
    if (entryStat.isDirectory()) {
      files.push(...readReflogFiles(absolutePath, relativePath));
    } else if (entryStat.isFile()) {
      files.push({ absolutePath, relativePath });
    } else {
      fail("REFLOG_LAYOUT_UNSUPPORTED");
    }
  }
  return files;
}

function parseReflogInventory({ gitDir, commonDir, objectFormat, refNames }) {
  const oidLength = objectFormat === "sha256" ? 64 : 40;
  const zeroOid = "0".repeat(oidLength);
  const records = [];
  const messages = [];
  const actors = [];
  const pathRecords = [];
  const roots = new Set();
  const orphanLogs = new Set();

  for (const source of reflogDirectories(gitDir, commonDir)) {
    for (const file of readReflogFiles(source.directory)) {
      const relativeName = strictUtf8(file.relativePath, "MALFORMED_REFLOG_PATH").replaceAll("\\", "/");
      const logKey = `${source.label}:${relativeName}`;
      if (relativeName !== "HEAD" && !refNames.has(relativeName)) orphanLogs.add(logKey);
      const contents = readFileSync(file.absolutePath);
      const fileRoots = [];
      for (const [lineIndex, line] of splitLines(contents).entries()) {
        const firstSpace = line.indexOf(0x20);
        const secondSpace = firstSpace < 0 ? -1 : line.indexOf(0x20, firstSpace + 1);
        const messageSeparator = secondSpace < 0 ? -1 : line.indexOf(0x09, secondSpace + 1);
        if (firstSpace !== oidLength || secondSpace !== oidLength * 2 + 1) {
          fail("MALFORMED_REFLOG_INVENTORY");
        }
        const oldOid = parseOid(line.subarray(0, firstSpace).toString("ascii"), objectFormat, "MALFORMED_REFLOG_INVENTORY");
        const newOid = parseOid(
          line.subarray(firstSpace + 1, secondSpace).toString("ascii"),
          objectFormat,
          "MALFORMED_REFLOG_INVENTORY",
        );
        const message = messageSeparator < 0 ? Buffer.alloc(0) : line.subarray(messageSeparator + 1);
        const actorEnd = messageSeparator < 0 ? line.length : messageSeparator;
        const actor = parseIdentity(line.subarray(secondSpace + 1, actorEnd));
        records.push({ logKey, line: lineIndex + 1, oldOid, newOid, lineDigest: hash(line) });
        const messageOid = newOid !== zeroOid ? newOid : oldOid;
        actors.push({ identity: actor, oid: messageOid !== zeroOid ? messageOid : hash(line) });
        if (message.length > 0 && messageOid !== zeroOid) messages.push({ oid: messageOid, buffer: message });
        if (oldOid !== zeroOid) {
          roots.add(oldOid);
          fileRoots.push(oldOid);
        }
        if (newOid !== zeroOid) {
          roots.add(newOid);
          fileRoots.push(newOid);
        }
      }
      pathRecords.push({ buffer: file.relativePath, oid: fileRoots[0] ?? null });
    }
  }

  records.sort(
    (left, right) =>
      bytewiseCompare(left.logKey, right.logKey) ||
      left.line - right.line ||
      bytewiseCompare(left.oldOid, right.oldOid) ||
      bytewiseCompare(left.newOid, right.newOid),
  );
  return {
    entryCount: records.length,
    roots: [...roots].sort(bytewiseCompare),
    messages,
    actors,
    pathRecords,
    orphanLogCount: orphanLogs.size,
    digest: hash(JSON.stringify(records)),
  };
}

function parseObjectInventory(buffer, objectFormat) {
  const objects = new Map();
  for (const line of splitLines(buffer)) {
    const fields = line.toString("ascii").split(" ");
    if (fields.length !== 3) fail("MALFORMED_OBJECT_INVENTORY");
    const [oidValue, type, sizeValue] = fields;
    const oid = parseOid(oidValue, objectFormat, "MALFORMED_OBJECT_INVENTORY");
    const size = Number(sizeValue);
    if (!Number.isSafeInteger(size) || size < 0 || !["blob", "commit", "tag", "tree"].includes(type)) {
      fail("UNSUPPORTED_OBJECT_INVENTORY");
    }
    objects.set(oid, { oid, type, size });
  }
  return objects;
}

function objectInventoryDigest(inventory) {
  const records = [...inventory.values()]
    .map((entry) => [entry.oid, entry.type, entry.size])
    .sort((left, right) => bytewiseCompare(left[0], right[0]));
  return hash(JSON.stringify(records));
}

function refInventoryDigest(refs) {
  return hash(Buffer.concat(refs.map((item) => Buffer.concat([item.raw, Buffer.from("\n")]))));
}

function allowlistDigest(entries) {
  const records = entries
    .map((entry) => [entry.ruleId, entry.path, entry.fileSha256.toLowerCase()])
    .sort(
      (left, right) =>
        bytewiseCompare(left[0], right[0]) ||
        bytewiseCompare(left[1], right[1]) ||
        bytewiseCompare(left[2], right[2]),
    );
  return hash(JSON.stringify(records));
}

function objectBatches(entries) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const entry of entries) {
    if (current.length > 0 && bytes + entry.size > MAX_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function readObjectBatch(root, entries, objectFormat) {
  const input = Buffer.from(`${entries.map((entry) => entry.oid).join("\n")}\n`, "ascii");
  const output = runGit(root, ["cat-file", "--batch"], {
    input,
    maxBuffer: Math.max(MAX_BATCH_BYTES * 2, entries.reduce((total, entry) => total + entry.size, 0) + 1024 * 1024),
    code: "OBJECT_READ_FAILED",
  });
  const result = new Map();
  let cursor = 0;

  for (const expected of entries) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd < 0) fail("MALFORMED_OBJECT_STREAM");
    const header = output.subarray(cursor, headerEnd).toString("ascii").split(" ");
    if (header.length !== 3) fail("MALFORMED_OBJECT_STREAM");
    const oid = parseOid(header[0], objectFormat, "MALFORMED_OBJECT_STREAM");
    const size = Number(header[2]);
    if (oid !== expected.oid || header[1] !== expected.type || size !== expected.size) {
      fail("OBJECT_INVENTORY_CHANGED");
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) fail("MALFORMED_OBJECT_STREAM");
    result.set(oid, output.subarray(contentStart, contentEnd));
    cursor = contentEnd + 1;
  }

  if (cursor !== output.length) fail("MALFORMED_OBJECT_STREAM");
  return result;
}

function readObjects(root, inventory, objectFormat, maxBlobBytes) {
  const eligible = [];
  for (const entry of inventory.values()) {
    if (entry.type === "blob") {
      if (entry.size > maxBlobBytes) fail("BLOB_SIZE_LIMIT");
      eligible.push(entry);
      continue;
    }
    if (entry.size > MAX_STRUCTURAL_BYTES) fail("STRUCTURAL_OBJECT_SIZE_LIMIT");
    eligible.push(entry);
  }
  eligible.sort((left, right) => bytewiseCompare(left.oid, right.oid));

  const contents = new Map();
  for (const batch of objectBatches(eligible)) {
    for (const [oid, buffer] of readObjectBatch(root, batch, objectFormat)) {
      contents.set(oid, buffer);
    }
  }
  return contents;
}

function headerLines(buffer) {
  const separator = buffer.indexOf(Buffer.from("\n\n"));
  const headers = buffer.subarray(0, separator < 0 ? buffer.length : separator);
  return { lines: splitLines(Buffer.concat([headers, Buffer.from("\n")])), message: separator < 0 ? Buffer.alloc(0) : buffer.subarray(separator + 2) };
}

function structuredHeaders(lines, code) {
  const headers = [];
  for (const line of lines) {
    if (line[0] === 0x20) {
      if (headers.length === 0) fail(code);
      const current = headers.at(-1);
      current.value = Buffer.concat([current.value, Buffer.from("\n"), line.subarray(1)]);
      continue;
    }
    const separator = line.indexOf(0x20);
    if (separator <= 0) fail(code);
    const name = line.subarray(0, separator).toString("ascii");
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(code);
    headers.push({ name, value: line.subarray(separator + 1) });
  }
  return headers;
}

function parseIdentity(line) {
  const value = strictUtf8(line, "MALFORMED_IDENTITY").replace(/ \d+ [+-]\d{4}$/, "");
  return value;
}

function parseCommit(buffer, objectFormat) {
  const { lines, message } = headerLines(buffer);
  const headers = structuredHeaders(lines, "MALFORMED_COMMIT_OBJECT");
  const children = [];
  let tree = null;
  let author = null;
  let committer = null;
  let signed = false;
  let embeddedSignature = false;
  const metadata = [];
  const singleHeaders = new Set();
  for (const header of headers) {
    if (["tree", "author", "committer", "gpgsig", "gpgsig-sha256"].includes(header.name)) {
      if (singleHeaders.has(header.name)) fail("MALFORMED_COMMIT_OBJECT");
      singleHeaders.add(header.name);
    }
    if (header.name === "tree") {
      tree = parseOid(header.value.toString("ascii"), objectFormat, "MALFORMED_COMMIT_OBJECT");
      children.push(tree);
    } else if (header.name === "parent") {
      children.push(parseOid(header.value.toString("ascii"), objectFormat, "MALFORMED_COMMIT_OBJECT"));
    } else if (header.name === "author") {
      author = parseIdentity(header.value);
    } else if (header.name === "committer") {
      committer = parseIdentity(header.value);
    } else if (/^gpgsig(?:-sha256)?$/.test(header.name)) {
      signed = true;
      metadata.push(Buffer.concat([Buffer.from(`${header.name}\n`), header.value]));
    } else if (header.name === "mergetag") {
      embeddedSignature = true;
      metadata.push(Buffer.concat([Buffer.from(`${header.name}\n`), header.value]));
    } else {
      metadata.push(Buffer.concat([Buffer.from(`${header.name}\n`), header.value]));
    }
  }
  if (!tree || !author || !committer) fail("MALFORMED_COMMIT_OBJECT");
  return { children, tree, author, committer, signed, embeddedSignature, message, metadata };
}

function parseTag(buffer, objectFormat) {
  const { lines, message } = headerLines(buffer);
  const headers = structuredHeaders(lines, "MALFORMED_TAG_OBJECT");
  for (const name of ["object", "type", "tag"]) {
    if (headers.filter((header) => header.name === name).length !== 1) fail("MALFORMED_TAG_OBJECT");
  }
  if (headers.filter((header) => header.name === "tagger").length > 1) fail("MALFORMED_TAG_OBJECT");
  const objectHeader = headers.find((header) => header.name === "object");
  const typeHeader = headers.find((header) => header.name === "type");
  const tagHeader = headers.find((header) => header.name === "tag");
  const taggerHeader = headers.find((header) => header.name === "tagger");
  if (!objectHeader || !typeHeader || !tagHeader) fail("MALFORMED_TAG_OBJECT");
  const targetType = typeHeader.value.toString("ascii");
  if (!["blob", "commit", "tag", "tree"].includes(targetType)) fail("MALFORMED_TAG_OBJECT");
  return {
    children: [parseOid(objectHeader.value.toString("ascii"), objectFormat, "MALFORMED_TAG_OBJECT")],
    targetType,
    tagName: tagHeader.value,
    tagger: taggerHeader ? parseIdentity(taggerHeader.value) : null,
    metadata: headers
      .filter((header) => !["object", "type", "tag", "tagger"].includes(header.name))
      .map((header) => Buffer.concat([Buffer.from(`${header.name}\n`), header.value])),
    message,
  };
}

function containsDetachedSignature(buffer) {
  const text = buffer.toString("ascii");
  return (
    /-----BEGIN (?:PGP |SSH |CMS |PKCS7 )?SIGNATURE-----/.test(text) ||
    text.includes("-----BEGIN SIGNED MESSAGE-----")
  );
}

function parseTree(buffer, objectFormat) {
  const oidBytes = objectFormat === "sha256" ? 32 : 20;
  const entries = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const space = buffer.indexOf(0x20, cursor);
    const nul = space < 0 ? -1 : buffer.indexOf(0, space + 1);
    if (space < 0 || nul < 0 || nul + 1 + oidBytes > buffer.length) fail("MALFORMED_TREE_OBJECT");
    const mode = buffer.subarray(cursor, space).toString("ascii");
    const name = buffer.subarray(space + 1, nul);
    if (!/^(?:40000|100644|100755|120000|160000)$/.test(mode) || name.length === 0 || name.includes(0x2f)) {
      fail("MALFORMED_TREE_OBJECT");
    }
    const oid = buffer.subarray(nul + 1, nul + 1 + oidBytes).toString("hex");
    entries.push({ mode, name, oid });
    cursor = nul + 1 + oidBytes;
  }
  return entries;
}

function buildObjectGraph(inventory, contents, objectFormat) {
  const graph = new Map();
  const commits = new Map();
  const tags = new Map();
  const trees = new Map();

  for (const entry of inventory.values()) {
    if (entry.type === "blob") {
      graph.set(entry.oid, []);
      continue;
    }
    const buffer = contents.get(entry.oid);
    if (!buffer) fail("MISSING_STRUCTURAL_OBJECT");
    if (entry.type === "commit") {
      const parsed = parseCommit(buffer, objectFormat);
      commits.set(entry.oid, parsed);
      graph.set(entry.oid, parsed.children);
    } else if (entry.type === "tag") {
      const parsed = parseTag(buffer, objectFormat);
      tags.set(entry.oid, parsed);
      graph.set(entry.oid, parsed.children);
    } else {
      const parsed = parseTree(buffer, objectFormat);
      trees.set(entry.oid, parsed);
      graph.set(
        entry.oid,
        parsed.filter((item) => item.mode !== "160000").map((item) => item.oid),
      );
    }
  }

  for (const children of graph.values()) {
    for (const oid of children) {
      if (!inventory.has(oid)) fail("MISSING_REFERENCED_OBJECT");
    }
  }
  for (const tag of tags.values()) {
    if (inventory.get(tag.children[0])?.type !== tag.targetType) fail("TAG_TARGET_TYPE_MISMATCH");
  }
  return { graph, commits, tags, trees };
}

function traverse(graph, roots) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const oid = pending.pop();
    if (visited.has(oid)) continue;
    if (!graph.has(oid)) fail("MISSING_ROOT_OBJECT");
    visited.add(oid);
    for (const child of graph.get(oid)) pending.push(child);
  }
  return visited;
}

function classificationFor(oid, approved, unapproved, reflog, dangling) {
  if (approved.has(oid)) return "ref-reachable";
  if (unapproved.has(oid)) return "unapproved-ref";
  if (reflog.has(oid)) return "reflog-only";
  if (dangling.has(oid)) return "dangling-tree";
  return "object-only";
}

function pathKey(buffer, mode, reachability) {
  return `${reachability}:${mode}:${buffer.toString("base64")}`;
}

function appendPath(prefix, name) {
  if (prefix.length === 0) return Buffer.from(name);
  return Buffer.concat([prefix, Buffer.from("/"), name]);
}

function collectPaths({ inventory, graphData, classifications, structuralRoots }) {
  const paths = new Map();
  const gitlinks = [];
  let aliasCount = 0;

  function addPath(oid, mode, value, reachability) {
    let aliases = paths.get(oid);
    if (!aliases) {
      aliases = new Map();
      paths.set(oid, aliases);
    }
    const key = pathKey(value, mode, reachability);
    if (!aliases.has(key)) {
      aliases.set(key, { mode, path: value, reachability });
      aliasCount += 1;
      if (aliasCount > MAX_PATH_ALIASES) fail("PATH_ALIAS_LIMIT");
    }
  }

  function walkTree(treeOid, prefix, reachability, stack = new Set()) {
    if (stack.has(treeOid)) fail("TREE_CYCLE");
    const entries = graphData.trees.get(treeOid);
    if (!entries) fail("MISSING_TREE_OBJECT");
    const nextStack = new Set(stack).add(treeOid);
    for (const entry of entries) {
      const value = appendPath(prefix, entry.name);
      if (entry.mode === "40000") {
        walkTree(entry.oid, value, reachability, nextStack);
      } else if (entry.mode === "160000") {
        gitlinks.push({ objectId: treeOid, path: value, reachability });
      } else {
        const target = inventory.get(entry.oid);
        if (!target || target.type !== "blob") fail("TREE_ENTRY_TYPE_MISMATCH");
        addPath(entry.oid, entry.mode, value, reachability);
      }
    }
  }

  for (const [oid, commit] of graphData.commits) {
    const reachability = classifications.get(oid);
    walkTree(commit.tree, Buffer.alloc(0), reachability);
  }

  for (const rootOid of structuralRoots) {
    let targetOid = rootOid;
    const seenTags = new Set();
    while (inventory.get(targetOid)?.type === "tag") {
      if (seenTags.has(targetOid)) fail("TAG_CYCLE");
      seenTags.add(targetOid);
      targetOid = graphData.tags.get(targetOid)?.children[0];
      if (!targetOid) fail("MALFORMED_TAG_OBJECT");
    }
    if (inventory.get(targetOid)?.type === "tree") {
      walkTree(targetOid, Buffer.alloc(0), classifications.get(rootOid));
    }
  }

  const referencedTrees = new Set();
  for (const entries of graphData.trees.values()) {
    for (const entry of entries) if (entry.mode === "40000") referencedTrees.add(entry.oid);
  }
  for (const [oid] of graphData.trees) {
    if (referencedTrees.has(oid)) continue;
    walkTree(oid, Buffer.alloc(0), classifications.get(oid));
  }
  return { paths, gitlinks };
}

function decodePath(buffer) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    return null;
  }
}

function compileReviewedBinaryAllowlist(allowlistEntries) {
  const reviewed = [];
  const seen = new Set();
  for (const entry of allowlistEntries) {
    if (entry.ruleId !== "opaque-binary-object") continue;
    if (
      typeof entry.path !== "string" ||
      typeof entry.fileSha256 !== "string" ||
      entry.path.length === 0 ||
      entry.path.startsWith("/") ||
      entry.path.endsWith("/") ||
      entry.path.includes("\\") ||
      entry.path.includes("\0") ||
      entry.path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
      !/^[0-9a-f]{64}$/i.test(entry.fileSha256)
    ) {
      fail("INVALID_BINARY_ALLOWLIST");
    }
    const pathBuffer = Buffer.from(entry.path, "utf8");
    if (pathBuffer.toString("utf8") !== entry.path) fail("INVALID_BINARY_ALLOWLIST");
    const fileSha256 = entry.fileSha256.toLowerCase();
    const key = `${entry.path}\0${fileSha256}`;
    if (seen.has(key)) fail("DUPLICATE_BINARY_ALLOWLIST");
    seen.add(key);
    reviewed.push({ pathBuffer, fileSha256 });
  }
  return reviewed;
}

function reviewedBinaryAliases({ records, reachability, buffer, reviewedBinaryEntries }) {
  const aliases = records.filter((record) => record.reachability === reachability);
  if (aliases.length === 0) return false;
  const digest = hash(buffer);
  return aliases.every((record) => {
    if (record.mode !== "100644") return false;
    return reviewedBinaryEntries.some(
      (entry) => entry.fileSha256 === digest && entry.pathBuffer.equals(record.path),
    );
  });
}

function looksBinary(buffer) {
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    return false;
  }
  if (buffer.includes(0)) return true;
  try {
    UTF8_DECODER.decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function magicRule(buffer) {
  if (buffer.subarray(0, 16).equals(Buffer.from("SQLite format 3\0", "binary"))) return "database-artifact";
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ||
    buffer.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
  ) {
    return "opaque-archive";
  }
  return null;
}

function internalFinding({ objectId, ruleId, reachability, pathBuffer = null, line = null, surface = "blob" }) {
  return { objectId, ruleId, reachability, pathBuffer, line, surface };
}

function scanBlob({ entry, buffer, aliases, reachability, allowlistEntries, reviewedBinaryEntries }) {
  const findings = [];
  if (!buffer) fail("MISSING_BLOB_OBJECT");

  const magic = magicRule(buffer);
  const records = aliases ? [...aliases.values()] : [];
  if (records.length === 0) {
    if (magic) findings.push(internalFinding({ objectId: entry.oid, ruleId: magic, reachability }));
    for (const item of scanBuffer({ relativePath: ".history-object", buffer, allowlistEntries })) {
      findings.push(internalFinding({ objectId: entry.oid, ruleId: item.ruleId, reachability, line: item.line }));
    }
    if (looksBinary(buffer)) {
      findings.push(internalFinding({ objectId: entry.oid, ruleId: "unattributed-binary-object", reachability }));
    }
    return findings;
  }

  const aliasReachability = [...new Set(records.map((record) => record.reachability))].sort(
    (left, right) => (REACHABILITY_ORDER.get(left) ?? 99) - (REACHABILITY_ORDER.get(right) ?? 99),
  );
  for (const aliasClass of aliasReachability) {
    if (magic) {
      findings.push(internalFinding({ objectId: entry.oid, ruleId: magic, reachability: aliasClass }));
    } else if (
      looksBinary(buffer) &&
      !reviewedBinaryAliases({ records, reachability: aliasClass, buffer, reviewedBinaryEntries })
    ) {
      findings.push(internalFinding({ objectId: entry.oid, ruleId: "opaque-binary-object", reachability: aliasClass }));
    }
  }

  for (const record of records) {
    findings.push(
      ...scanMessage({
        oid: entry.oid,
        buffer: record.path,
        reachability: record.reachability,
        surface: "tree-path",
        allowlistEntries,
      }),
    );
    const decoded = decodePath(record.path);
    if (decoded == null) {
      findings.push(
        internalFinding({
          objectId: entry.oid,
          ruleId: "malformed-git-path",
          reachability: record.reachability,
          surface: "tree-entry",
        }),
      );
      for (const item of scanBuffer({ relativePath: ".history-object", buffer, allowlistEntries })) {
        findings.push(
          internalFinding({ objectId: entry.oid, ruleId: item.ruleId, reachability: record.reachability, line: item.line }),
        );
      }
      continue;
    }
    for (const item of scanBuffer({
      relativePath: decoded,
      buffer,
      allowlistEntries,
      symbolicLink: record.mode === "120000",
    })) {
      findings.push(
        internalFinding({
          objectId: entry.oid,
          ruleId: item.ruleId,
          reachability: record.reachability,
          pathBuffer: record.path,
          line: item.line,
          surface: "tree-entry",
        }),
      );
    }
  }
  return findings;
}

function scanMessage({ oid, buffer, reachability, surface, allowlistEntries }) {
  const findings = [];
  for (const item of scanBuffer({ relativePath: ".history-message.txt", buffer, allowlistEntries })) {
    findings.push(internalFinding({ objectId: oid, ruleId: item.ruleId, reachability, line: item.line, surface }));
  }
  return findings;
}

function scanIdentity({ oid, identity, reachability, surface, allowlistEntries }) {
  return scanMessage({
    oid,
    buffer: Buffer.from(identity, "utf8"),
    reachability,
    surface,
    allowlistEntries,
  }).filter((finding) => finding.ruleId !== "email-address");
}

function findingOrder(left, right) {
  return (
    (REACHABILITY_ORDER.get(left.reachability) ?? 99) - (REACHABILITY_ORDER.get(right.reachability) ?? 99) ||
    bytewiseCompare(left.ruleId, right.ruleId) ||
    bytewiseCompare(left.surface, right.surface) ||
    Buffer.compare(left.pathBuffer ?? Buffer.alloc(0), right.pathBuffer ?? Buffer.alloc(0)) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    bytewiseCompare(left.objectId, right.objectId)
  );
}

function publicFindings(internal) {
  internal.sort(findingOrder);
  return internal.map((item, index) => {
    return {
      id: `HF-${String(index + 1).padStart(4, "0")}`,
      ruleId: item.ruleId,
      reachability: item.reachability,
      surface: item.surface,
      path: null,
      line: item.line,
    };
  });
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) counts[value[key]] = (counts[value[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => bytewiseCompare(left, right)));
}

function ruleSetDigest() {
  for (const rule of PATH_RULES) {
    if (!PATH_POLICY_VERSIONS[rule.id]) fail("UNVERSIONED_PATH_POLICY");
  }
  for (const rule of CONTENT_RULES) {
    if (rule.allowMatch && !ALLOW_MATCH_POLICY_VERSIONS[rule.id]) fail("UNVERSIONED_ALLOW_MATCH_POLICY");
  }
  const rules = [
    {
      version: HISTORY_RULE_SET_VERSION,
      sourceDigest: hash(readFileSync(new URL("./rules.mjs", import.meta.url))),
      scanEngineSourceDigest: hash(readFileSync(new URL("./scanner.mjs", import.meta.url))),
    },
    ...PATH_RULES.map((rule) => ({ id: rule.id, kind: "path", policy: PATH_POLICY_VERSIONS[rule.id] })),
    ...CONTENT_RULES.map((rule) => ({
      id: rule.id,
      kind: "content",
      pattern: rule.pattern.source,
      flags: rule.pattern.flags,
      allowMatchPolicy: rule.allowMatch ? ALLOW_MATCH_POLICY_VERSIONS[rule.id] : null,
    })),
    { id: "database-artifact", kind: "magic", signature: "sqlite3" },
    { id: "opaque-archive", kind: "magic", signature: "zip-gzip-7z" },
    {
      id: "opaque-binary-object",
      kind: "history",
      allowlistPolicy: "exact-path-sha256-all-aliases-v1",
    },
    { id: "unattributed-binary-object", kind: "history" },
    { id: "malformed-git-path", kind: "history" },
    { id: "symbolic-link", kind: "history" },
    { id: "git-submodule", kind: "history" },
  ];
  return hash(JSON.stringify(rules));
}

function ensureRepositoryCompleteness(root) {
  const inheritedUnsafeKey = Object.keys(process.env).find(
    (key) => {
      const normalized = key.toUpperCase();
      return (
        UNSAFE_GIT_ENVIRONMENT_KEYS.includes(normalized) ||
        normalized.startsWith("GIT_CONFIG_KEY_") ||
        normalized.startsWith("GIT_CONFIG_VALUE_")
      );
    },
  );
  if (inheritedUnsafeKey) fail("GIT_ENVIRONMENT_OVERRIDE_PRESENT");
  runGit(root, ["rev-parse", "--git-dir"], { code: "NOT_GIT_REPOSITORY" });
  const bare = runGit(root, ["rev-parse", "--is-bare-repository"], {
    code: "REPOSITORY_KIND_UNKNOWN",
  })
    .toString("ascii")
    .trim();
  const absoluteGitDir = runGit(root, ["rev-parse", "--absolute-git-dir"], {
    code: "REPOSITORY_ROOT_UNKNOWN",
  })
    .toString("utf8")
    .trim();
  const discoveredRoot =
    bare === "true"
      ? Buffer.from(absoluteGitDir)
      : bare === "false"
        ? runGit(root, ["rev-parse", "--show-toplevel"], { code: "REPOSITORY_ROOT_UNKNOWN" })
        : fail("REPOSITORY_KIND_UNKNOWN");
  const exactRoot = statSync(root);
  const actualRoot = statSync(discoveredRoot.toString("utf8").trim());
  if (exactRoot.dev !== actualRoot.dev || exactRoot.ino !== actualRoot.ino) {
    fail("REPOSITORY_ROOT_MISMATCH");
  }
  const shallow = runGit(root, ["rev-parse", "--is-shallow-repository"], { code: "SHALLOW_STATE_UNKNOWN" })
    .toString("ascii")
    .trim();
  if (shallow === "true") fail("SHALLOW_REPOSITORY");
  if (shallow !== "false") fail("SHALLOW_STATE_UNKNOWN");

  const gitPath = runGit(root, ["rev-parse", "--git-path", "objects/info/alternates"], {
    code: "GIT_PATH_UNAVAILABLE",
  })
    .toString("utf8")
    .trim();
  const alternatesPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(root, gitPath);
  let alternatesPresent = false;
  if (existsSync(alternatesPath)) {
    const alternatesStat = lstatSync(alternatesPath);
    alternatesPresent =
      alternatesStat.isSymbolicLink() || !alternatesStat.isFile() || readFileSync(alternatesPath).length > 0;
  }
  if (alternatesPresent) {
    fail("OBJECT_ALTERNATES_PRESENT");
  }
  const partialCloneExtension = runGit(root, ["config", "--get", "extensions.partialClone"], {
    acceptedStatuses: [0, 1],
    code: "PROMISOR_STATE_UNKNOWN",
  });
  const promisorRemotes = runGit(root, ["config", "--get-regexp", "^remote\\..*\\.promisor$"], {
    acceptedStatuses: [0, 1],
    code: "PROMISOR_STATE_UNKNOWN",
  });
  if (partialCloneExtension.length > 0 || promisorRemotes.length > 0) fail("PARTIAL_CLONE_PRESENT");
  const commonDirValue = runGit(root, ["rev-parse", "--git-common-dir"], {
    code: "GIT_COMMON_DIR_UNKNOWN",
  })
    .toString("utf8")
    .trim();
  const commonDir = path.isAbsolute(commonDirValue) ? commonDirValue : path.resolve(root, commonDirValue);
  const linkedWorktreesDirectory = path.join(commonDir, "worktrees");
  if (existsSync(linkedWorktreesDirectory)) {
    const linkedWorktreesStat = lstatSync(linkedWorktreesDirectory);
    if (
      linkedWorktreesStat.isSymbolicLink() ||
      !linkedWorktreesStat.isDirectory() ||
      readdirSync(linkedWorktreesDirectory).length > 0
    ) {
      fail("LINKED_WORKTREES_PRESENT");
    }
  }
  const packDirectory = path.join(commonDir, "objects", "pack");
  if (existsSync(packDirectory) && readdirSync(packDirectory).some((name) => name.endsWith(".promisor"))) {
    fail("PARTIAL_CLONE_PRESENT");
  }
  return { gitDir: absoluteGitDir, commonDir };
}

export function scanHistoryRepository(
  root = process.cwd(),
  {
    approvedRefs,
    allowlistEntries = REPOSITORY_SAFETY_ALLOWLIST,
    identityScope = "undecided",
    signatureScope = "undecided",
    maxBlobBytes = MAX_BLOB_BYTES,
    _testBeforeFinalInventory,
  } = {},
) {
  const resolvedRoot = path.resolve(root);
  if (!OWNER_IDENTITY_SCOPES.has(identityScope)) fail("INVALID_IDENTITY_SCOPE");
  if (!OWNER_SIGNATURE_SCOPES.has(signatureScope)) fail("INVALID_SIGNATURE_SCOPE");
  if (!Number.isSafeInteger(maxBlobBytes) || maxBlobBytes < 0) fail("INVALID_BLOB_SIZE_LIMIT");
  if (_testBeforeFinalInventory != null && typeof _testBeforeFinalInventory !== "function") {
    fail("INVALID_TEST_HOOK");
  }
  const { gitDir, commonDir } = ensureRepositoryCompleteness(resolvedRoot);
  const reviewedBinaryEntries = compileReviewedBinaryAllowlist(allowlistEntries);
  const gitVersion = runGit(resolvedRoot, ["--version"], { code: "GIT_VERSION_UNKNOWN" })
    .toString("ascii")
    .trim();
  if (!/^git version [0-9][0-9A-Za-z.()+ -]{0,120}$/.test(gitVersion)) fail("GIT_VERSION_UNKNOWN");
  const objectFormat = runGit(resolvedRoot, ["rev-parse", "--show-object-format"], {
    code: "OBJECT_FORMAT_UNKNOWN",
  })
    .toString("ascii")
    .trim();
  if (!["sha1", "sha256"].includes(objectFormat)) fail("UNSUPPORTED_OBJECT_FORMAT");

  const rawRefs = runGit(
    resolvedRoot,
    ["for-each-ref", "--include-root-refs", "--format=%(refname)%00%(objectname)%00%(symref)%00"],
    { code: "REF_INVENTORY_FAILED" },
  );
  const refs = parseRefs(rawRefs, objectFormat);
  const initialRefInventoryDigest = refInventoryDigest(refs);
  const refNames = new Set(refs.map((item) => item.name));
  const refScopeExplicit = approvedRefs != null;
  const approvedNames = approvedRefs == null ? refNames : new Set(approvedRefs);
  for (const name of approvedNames) if (!refNames.has(name)) fail("APPROVED_REF_MISSING");
  const approvedRoots = refs.filter((item) => approvedNames.has(item.name)).map((item) => item.oid);
  const unapprovedRoots = refs.filter((item) => !approvedNames.has(item.name)).map((item) => item.oid);

  const reflogs = parseReflogInventory({ gitDir, commonDir, objectFormat, refNames });
  const reflogRoots = reflogs.roots;

  const rawInventory = runGit(
    resolvedRoot,
    ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { code: "OBJECT_INVENTORY_FAILED" },
  );
  const inventory = parseObjectInventory(rawInventory, objectFormat);
  const initialObjectInventoryDigest = objectInventoryDigest(inventory);
  const contents = readObjects(resolvedRoot, inventory, objectFormat, maxBlobBytes);
  const graphData = buildObjectGraph(inventory, contents, objectFormat);
  const approvedReachable = traverse(graphData.graph, approvedRoots);
  const unapprovedReachable = traverse(graphData.graph, unapprovedRoots);
  const reflogReachable = traverse(graphData.graph, reflogRoots);
  const knownReachable = new Set([...approvedReachable, ...unapprovedReachable, ...reflogReachable]);
  const unattachedStructural = [...inventory.values()]
    .filter((item) => item.type !== "blob" && !knownReachable.has(item.oid))
    .map((item) => item.oid);
  const danglingReachable = traverse(graphData.graph, unattachedStructural);
  const classifications = new Map();
  for (const oid of inventory.keys()) {
    classifications.set(
      oid,
      classificationFor(oid, approvedReachable, unapprovedReachable, reflogReachable, danglingReachable),
    );
  }

  const { paths, gitlinks } = collectPaths({
    inventory,
    graphData,
    classifications,
    structuralRoots: [
      ...approvedRoots,
      ...unapprovedRoots,
      ...reflogRoots,
      ...unattachedStructural.filter((oid) => inventory.get(oid)?.type === "tag"),
    ],
  });
  const internal = [];
  for (const ref of refs) {
    internal.push(
      ...scanMessage({
        oid: ref.oid,
        buffer: Buffer.from(ref.name, "utf8"),
        reachability: approvedNames.has(ref.name) ? "ref-reachable" : "unapproved-ref",
        surface: "ref-name",
        allowlistEntries,
      }),
    );
  }
  for (const message of reflogs.messages) {
    internal.push(
      ...scanMessage({
        oid: message.oid,
        buffer: message.buffer,
        reachability: classifications.get(message.oid),
        surface: "reflog-message",
        allowlistEntries,
      }),
    );
  }
  for (const pathRecord of reflogs.pathRecords) {
    internal.push(
      ...scanMessage({
        oid: pathRecord.oid ?? hash(pathRecord.buffer),
        buffer: pathRecord.buffer,
        reachability: classifications.get(pathRecord.oid) ?? "reflog-only",
        surface: "reflog-path",
        allowlistEntries,
      }),
    );
  }
  for (const actor of reflogs.actors) {
    internal.push(
      ...scanIdentity({
        oid: actor.oid,
        identity: actor.identity,
        reachability: classifications.get(actor.oid) ?? "reflog-only",
        surface: "reflog-identity",
        allowlistEntries,
      }),
    );
  }
  for (const entry of inventory.values()) {
    if (entry.type !== "blob") continue;
    internal.push(
      ...scanBlob({
        entry,
        buffer: contents.get(entry.oid),
        aliases: paths.get(entry.oid),
        reachability: classifications.get(entry.oid),
        allowlistEntries,
        reviewedBinaryEntries,
      }),
    );
  }
  for (const item of gitlinks) {
    const decoded = decodePath(item.path);
    internal.push(
      internalFinding({
        objectId: item.objectId,
        ruleId: decoded == null ? "malformed-git-path" : "git-submodule",
        reachability: item.reachability,
        pathBuffer: decoded == null ? null : item.path,
        surface: "tree-entry",
      }),
    );
  }

  const authors = new Set();
  const committers = new Set();
  const taggers = new Set();
  const reflogIdentities = new Set(reflogs.actors.map((actor) => actor.identity));
  let authorCommitterDifferences = 0;
  let signedCommitCount = 0;
  let embeddedSignatureCount = 0;
  for (const [oid, commit] of graphData.commits) {
    authors.add(commit.author);
    committers.add(commit.committer);
    if (commit.author !== commit.committer) authorCommitterDifferences += 1;
    if (commit.signed || commit.embeddedSignature) signedCommitCount += 1;
    if (commit.embeddedSignature) embeddedSignatureCount += 1;
    internal.push(
      ...scanIdentity({
        oid,
        identity: commit.author,
        reachability: classifications.get(oid),
        surface: "author-identity",
        allowlistEntries,
      }),
      ...scanIdentity({
        oid,
        identity: commit.committer,
        reachability: classifications.get(oid),
        surface: "committer-identity",
        allowlistEntries,
      }),
    );
    internal.push(
      ...scanMessage({
        oid,
        buffer: commit.message,
        reachability: classifications.get(oid),
        surface: "commit-message",
        allowlistEntries,
      }),
    );
    for (const metadata of commit.metadata) {
      internal.push(
        ...scanMessage({
          oid,
          buffer: metadata,
          reachability: classifications.get(oid),
          surface: "commit-header",
          allowlistEntries,
        }),
      );
    }
  }
  let signedTagCount = 0;
  for (const [oid, tag] of graphData.tags) {
    if (tag.tagger) taggers.add(tag.tagger);
    if (containsDetachedSignature(tag.message)) signedTagCount += 1;
    if (tag.tagger) {
      internal.push(
        ...scanIdentity({
          oid,
          identity: tag.tagger,
          reachability: classifications.get(oid),
          surface: "tagger-identity",
          allowlistEntries,
        }),
      );
    }
    internal.push(
      ...scanMessage({
        oid,
        buffer: tag.message,
        reachability: classifications.get(oid),
        surface: "tag-message",
        allowlistEntries,
      }),
    );
    internal.push(
      ...scanMessage({
        oid,
        buffer: tag.tagName,
        reachability: classifications.get(oid),
        surface: "tag-name",
        allowlistEntries,
      }),
    );
    for (const metadata of tag.metadata) {
      internal.push(
        ...scanMessage({
          oid,
          buffer: metadata,
          reachability: classifications.get(oid),
          surface: "tag-header",
          allowlistEntries,
        }),
      );
    }
  }

  _testBeforeFinalInventory?.();
  const finalRepository = ensureRepositoryCompleteness(resolvedRoot);
  if (
    !sameFilesystemEntry(gitDir, finalRepository.gitDir) ||
    !sameFilesystemEntry(commonDir, finalRepository.commonDir)
  ) {
    fail("REPOSITORY_CHANGED_DURING_SCAN");
  }
  const finalRefs = parseRefs(
    runGit(
      resolvedRoot,
      ["for-each-ref", "--include-root-refs", "--format=%(refname)%00%(objectname)%00%(symref)%00"],
      {
        code: "REF_INVENTORY_FAILED",
      },
    ),
    objectFormat,
  );
  const finalReflogs = parseReflogInventory({
    gitDir,
    commonDir,
    objectFormat,
    refNames: new Set(finalRefs.map((item) => item.name)),
  });
  const finalInventory = parseObjectInventory(
    runGit(resolvedRoot, ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
      code: "OBJECT_INVENTORY_FAILED",
    }),
    objectFormat,
  );
  if (
    refInventoryDigest(finalRefs) !== initialRefInventoryDigest ||
    finalReflogs.digest !== reflogs.digest ||
    objectInventoryDigest(finalInventory) !== initialObjectInventoryDigest
  ) {
    fail("REPOSITORY_CHANGED_DURING_SCAN");
  }

  const findings = publicFindings(internal);
  const objectTypeCounts = {};
  const objectReachabilityCounts = {};
  for (const entry of inventory.values()) {
    objectTypeCounts[entry.type] = (objectTypeCounts[entry.type] ?? 0) + 1;
    const reachability = classifications.get(entry.oid);
    objectReachabilityCounts[reachability] = (objectReachabilityCounts[reachability] ?? 0) + 1;
  }
  const decisionsResolved = identityScope !== "undecided" && signatureScope !== "undecided";
  const signatureDecisionAllowsRewrite =
    signatureScope !== "abort-on-signed" || signedCommitCount + signedTagCount === 0;
  const allRefsApproved = unapprovedRoots.length === 0;
  const reportWithoutDigest = {
    schemaVersion: HISTORY_REPORT_SCHEMA,
    scannerVersion: HISTORY_SCANNER_VERSION,
    scannerSourceDigest: hash(readFileSync(new URL(import.meta.url))),
    runtime: { nodeVersion: process.version, gitVersion, objectFormat },
    complete: true,
    ruleSetDigest: ruleSetDigest(),
    allowlistEntryCount: allowlistEntries.length,
    allowlistDigest: allowlistDigest(allowlistEntries),
    scope: {
      refScopeExplicit,
      approvedRefCount: approvedRoots.length,
      unapprovedRefCount: unapprovedRoots.length,
      rootRefCount: refs.filter((item) => !item.name.startsWith("refs/")).length,
      refInventoryDigest: initialRefInventoryDigest,
      reflogEntryCount: reflogs.entryCount,
      reflogRootCount: reflogRoots.length,
      orphanReflogCount: reflogs.orphanLogCount,
      reflogInventoryDigest: reflogs.digest,
      objectCount: inventory.size,
      objectInventoryDigest: initialObjectInventoryDigest,
      objectTypeCounts: Object.fromEntries(Object.entries(objectTypeCounts).sort(([a], [b]) => bytewiseCompare(a, b))),
      objectReachabilityCounts: Object.fromEntries(
        Object.entries(objectReachabilityCounts).sort(([a], [b]) => bytewiseCompare(a, b)),
      ),
    },
    ownerDecisions: {
      identityScope,
      signatureScope,
      resolved: decisionsResolved,
      rewriteAllowed:
        findings.length === 0 &&
        refScopeExplicit &&
        allRefsApproved &&
        decisionsResolved &&
        signatureDecisionAllowsRewrite,
      distinctAuthorIdentityCount: authors.size,
      distinctCommitterIdentityCount: committers.size,
      distinctTaggerIdentityCount: taggers.size,
      distinctReflogIdentityCount: reflogIdentities.size,
      authorCommitterDifferenceCount: authorCommitterDifferences,
      signedCommitCount,
      signedTagCount,
      embeddedSignatureCount,
    },
    findingCount: findings.length,
    findingCountsByRule: countBy(findings, "ruleId"),
    findingCountsByReachability: countBy(findings, "reachability"),
    findings,
  };
  return { ...reportWithoutDigest, evidenceDigest: hash(JSON.stringify(reportWithoutDigest)) };
}

export function formatHistoryTextReport(result) {
  const approvalState = result.ownerDecisions.rewriteAllowed
    ? "resolved"
    : result.findingCount > 0
      ? "findings remain"
      : !result.scope.refScopeExplicit
      ? "explicit approved-ref scope required"
      : result.scope.unapprovedRefCount > 0
        ? "unapproved refs remain"
        : !result.ownerDecisions.resolved
          ? "identity/signature decision required"
          : "signed history conflicts with abort decision";
  const lines = [
    `Repository history safety scan ${result.findingCount === 0 ? "passed" : "found review items"} (${result.findingCount} findings across ${result.scope.objectCount} local objects).`,
    `Evidence digest: ${result.evidenceDigest}`,
    `Reachability: ${Object.entries(result.scope.objectReachabilityCounts)
      .map(([name, count]) => `${name}=${count}`)
      .join(", ")}`,
    `Rewrite approval state: ${approvalState}.`,
  ];
  for (const finding of result.findings) {
    const pathValue = finding.path == null ? "[PATH_WITHHELD]" : finding.path;
    const lineValue = finding.line == null ? "" : `:${finding.line}`;
    lines.push(
      `${finding.id} ${finding.ruleId} ${finding.reachability} ${finding.surface}:${pathValue}${lineValue} [REDACTED]`,
    );
  }
  return lines.join("\n");
}
