import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { databaseBackup } from "./database-backup";
import { EvidenceStorageError, putEvidenceObject, signEvidenceGet } from "./evidence-r2";

export type EvidenceBackupManifest = { version: 1; id: string; createdAt: string; databaseBytes: number; databaseSha256: string; parts: { name: string; key: string; bytes: number; sha256: string }[]; originals: { id: string; key: string; name: string; bytes: number; sha256: string }[]; warnings: string[] };
export async function createEvidenceBackup(ownerId: string) {
  const id = randomUUID(), expiresAt = new Date(Date.now() + 86_400_000);
  await prisma.evidenceBackupSession.create({ data: { id, ownerId, expiresAt, manifest: { state: "preparing", parts: [] } } });
  const response = await databaseBackup(id);
  if (!response.ok) throw new EvidenceStorageError("The database restore validation failed. No complete backup was produced.", 500);
  const bytes = Buffer.from(await response.text()), payload = JSON.parse(bytes.toString("utf8"));
  const manifest: EvidenceBackupManifest = { version: 1, id, createdAt: new Date().toISOString(), databaseBytes: bytes.length, databaseSha256: createHash("sha256").update(bytes).digest("hex"), parts: [], originals: payload.evidenceAssets.map((a: { id: string; objectKey: string; bytes: number; sha256: string }) => ({ id: a.id, key: a.objectKey, name: `originals/${a.id}.png`, bytes: a.bytes, sha256: a.sha256 })), warnings: ["Standalone-journal external screenshots retain their existing backup behavior; inspect the database backup's journalScreenshots manifest."] };
  for (let offset = 0, index = 0; offset < bytes.length; offset += 3_000_000, index++) {
    const part = bytes.subarray(offset, offset + 3_000_000), name = `database/part-${String(index).padStart(5, "0")}.bin`, key = `backups/${id}/${name}`;
    manifest.parts.push({ name, key, bytes: part.length, sha256: createHash("sha256").update(part).digest("hex") });
    await prisma.evidenceBackupSession.update({ where: { id }, data: { manifest: { state: "preparing", parts: manifest.parts } as unknown as Prisma.InputJsonValue } });
    await putEvidenceObject(key, part);
  }
  await prisma.evidenceBackupSession.update({ where: { id }, data: { manifest: manifest as unknown as Prisma.InputJsonValue } });
  return { id, files: manifest.parts.length + manifest.originals.length, bytes: manifest.databaseBytes + manifest.originals.reduce((sum, a) => sum + a.bytes, 0), warnings: manifest.warnings };
}
export async function evidenceBackupPage(id: string, ownerId: string, offset: number) {
  const session = await prisma.evidenceBackupSession.findFirst({ where: { id, ownerId, expiresAt: { gt: new Date() } } });
  if (!session) throw new EvidenceStorageError("Backup session expired. Generate a new consistent backup.", 410);
  const manifest = session.manifest as unknown as EvidenceBackupManifest;
  if (manifest.version !== 1) throw new EvidenceStorageError("Backup preparation did not complete. Generate a new backup; incomplete temporary parts expire automatically.");
  const files = [...manifest.parts, ...manifest.originals];
  const page = await Promise.all(files.slice(offset, offset + 10).map(async file => ({ name: file.name, bytes: file.bytes, sha256: file.sha256, url: await signEvidenceGet(file.key, false, file.name.endsWith(".png") ? "image/png" : "application/octet-stream") })));
  const publicManifest = { ...manifest, parts: manifest.parts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), originals: manifest.originals.map(({ id, name, bytes, sha256 }) => ({ id, name, bytes, sha256 })) };
  return { manifest: offset === 0 ? publicManifest : undefined, files: page, next: offset + page.length < files.length ? offset + page.length : null };
}
