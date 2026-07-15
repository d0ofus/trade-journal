import crypto from "node:crypto";

export function rawImportArchiveIdentity(content: string) {
  const rawSha256 = crypto.createHash("sha256").update(content).digest("hex");
  return {
    rawSha256,
    rawBytes: Buffer.byteLength(content, "utf8"),
    rawStorageKey: `import-artifacts/sha256/${rawSha256}.txt`,
  };
}
