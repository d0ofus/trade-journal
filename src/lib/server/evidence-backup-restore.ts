import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertTestDatabaseSafety } from "@/lib/test-database-safety";
import { buildBackupRestorePlan } from "./backup-restore";
import { evidenceStorageConfig, putEvidenceObject, readEvidenceObject, verifyEvidencePng } from "./evidence-r2";
import type { EvidenceBackupManifest } from "./evidence-backup";

/** Caller combines all downloaded ZIP parts. No database or storage mutation during verification. */
export function verifyCompleteEvidenceBackup(files: Record<string, Uint8Array>) {
  if (!files["manifest.json"]) throw new Error("The complete backup manifest is missing.");
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8")) as EvidenceBackupManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length || !Array.isArray(manifest.originals) || !Number.isSafeInteger(manifest.databaseBytes) || manifest.databaseBytes <= 0 || !/^[a-f0-9]{64}$/.test(manifest.databaseSha256)) throw new Error("Unsupported complete backup format.");
  const names = new Set<string>(), ids = new Set<string>();
  for (const [index, part] of manifest.parts.entries()) if (part.name !== `database/part-${String(index).padStart(5, "0")}.bin` || part.bytes > 3_000_000) throw new Error("Invalid or unordered database backup part.");
  for (const original of manifest.originals) {
    if (typeof original.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(original.id) || original.name !== `originals/${original.id}.png` || original.bytes > 20_000_000 || ids.has(original.id)) throw new Error("Invalid or duplicate backup original.");
    ids.add(original.id);
  }
  for (const item of [...manifest.parts, ...manifest.originals]) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256) || names.has(item.name)) throw new Error("Invalid or duplicate backup file metadata.");
    names.add(item.name);
    const bytes = files[item.name];
    if (!bytes || bytes.length !== item.bytes || createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error(`Missing or corrupt backup file: ${item.name}. All parts are required.`);
  }
  const database = Buffer.concat(manifest.parts.map(p => files[p.name]));
  if (database.length !== manifest.databaseBytes || createHash("sha256").update(database).digest("hex") !== manifest.databaseSha256) throw new Error("Database backup checksum mismatch.");
  const payload = JSON.parse(database.toString("utf8"));
  const plan = buildBackupRestorePlan(payload);
  if (manifest.originals.length !== (payload.evidenceAssets ?? []).length) throw new Error("The original manifest does not match the database asset count.");
  for (const asset of payload.evidenceAssets ?? []) {
    const original = manifest.originals.find(item => item.id === asset.id);
    if (!original || original.sha256 !== asset.sha256 || original.bytes !== asset.bytes) throw new Error(`Asset metadata does not match its original: ${asset.id}`);
  }
  return { manifest, payload, plan };
}

/** Explicit restore prerequisite. Never accepts a production bucket; DB restore remains separately guarded. */
export async function restoreEvidenceObjectsToNonProduction(files: Record<string, Uint8Array>) {
  const { payload } = verifyCompleteEvidenceBackup(files);
  if (process.env.VERCEL_ENV === "production" || evidenceStorageConfig().bucket.endsWith("-production")) throw new Error("Isolated restore cannot target production storage.");
  for (const asset of payload.evidenceAssets ?? []) {
    if (!/^originals\/[a-zA-Z0-9-]+\/[a-f0-9]{64}\.png$/.test(asset.objectKey) || !/^thumbnails\/[a-zA-Z0-9-]+\/[a-f0-9]{64}\.png$/.test(asset.thumbnailKey)) throw new Error("Backup contains an invalid evidence object key.");
    const bytes = Buffer.from(files[`originals/${asset.id}.png`]), verified = await verifyEvidencePng(bytes);
    if (verified.sha256 !== asset.sha256 || verified.notionHash !== asset.notionHash || verified.width !== asset.width || verified.height !== asset.height) throw new Error("Restored image does not match metadata.");
    for (const [key, body] of [[asset.objectKey, bytes], [asset.thumbnailKey, verified.thumbnail]] as const) {
      try { await putEvidenceObject(key, body); }
      catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error; if (!(await readEvidenceObject(key, body.length)).equals(body)) throw new Error("Restore would replace a different immutable image."); }
    }
    asset.thumbnailBytes = verified.thumbnail.length;
  }
  return { payload, plan: buildBackupRestorePlan(payload) };
}

/** Explicit local restore only. Production restoration needs its own reviewed procedure. */
export async function restoreCompleteEvidenceBackupToIsolated(files: Record<string, Uint8Array>) {
  const verified = verifyCompleteEvidenceBackup(files), target = assertTestDatabaseSafety(process.env).databaseUrl;
  if (!/^(127\.0\.0\.1|localhost):/.test(target.host) || !target.database.endsWith("_restore_test") || target.schema !== "public" || process.env.EVIDENCE_RESTORE_APPROVED !== "1") throw new Error("Restore requires EVIDENCE_RESTORE_APPROVED=1 and an empty local *_restore_test database with test mutations explicitly enabled.");
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  type Delegate = { count(): Promise<number>; createMany(args: { data: unknown[] }): Promise<unknown> };
  try {
    for (const table of verified.plan.tables) if (await (db as unknown as Record<string, Delegate>)[table.delegateName].count()) throw new Error("Restore target is not empty. Existing data is preserved.");
    const restored = await restoreEvidenceObjectsToNonProduction(files);
    await db.$transaction(async tx => {
      const delegates = tx as unknown as Record<string, Delegate>;
      for (const table of restored.plan.tables) {
        if (await delegates[table.delegateName].count()) throw new Error("Target changed during restoration. Database restore was rolled back.");
        const json = new Set(Prisma.dmmf.datamodel.models.find(model => model.name === table.prismaModel)!.fields.filter(field => field.type === "Json").map(field => field.name));
        if (table.rows.length) await delegates[table.delegateName].createMany({ data: table.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null && json.has(key) ? Prisma.DbNull : value]))) });
      }
    }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    for (const table of restored.plan.tables) if (await (db as unknown as Record<string, Delegate>)[table.delegateName].count() !== table.rowCount) throw new Error(`Restored row count differs: ${table.key}`);
    return { restored: true, database: target.database, originals: verified.manifest.originals.length, rows: restored.plan.totalRows, note: "Original checksums and restored row counts verified. External standalone-journal storage remains separate." };
  } finally { await db.$disconnect(); }
}
