/** Read-only preservation audit, optionally with a consistent pg_dump.
 * Output contains counts/checksums only. Backups are written to ignored backups/.
 * Never migrates, repairs, normalizes or publishes production data.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { workstationEvidenceManifest } from "../src/lib/server/workstation-backup";
import { allSectionKeys, sectionEvidenceIds } from "../src/lib/workstation/evidence";
import type { TradeDocument } from "../src/lib/workstation/types";
import { readWorkstationDocument } from "../src/lib/server/trade-workstation";

const checksum = (data: string) => createHash("sha256").update(data).digest("hex");
const client = new PrismaClient({ log: [] });
async function dump(snapshot: string, file: string, connection: URL) {
  const binary = process.env.PG_DUMP_PATH;
  assert(binary, "Set PG_DUMP_PATH to a trusted PostgreSQL pg_dump executable.");
  const env = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || "5432", PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password), PGDATABASE: decodeURIComponent(connection.pathname.slice(1)), PGSSLMODE: connection.searchParams.get("sslmode") || "require", PGCONNECT_TIMEOUT: "15", PGOPTIONS: "-c default_transaction_read_only=on" };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["--format=custom", "--no-owner", "--no-acl", "--snapshot", snapshot, "--file", file], { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], timeout: 240_000 });
    // Do not echo provider errors which might contain connection information.
    child.stderr?.resume();
    child.on("error", () => reject(new Error("pg_dump could not start; verify its executable and target access.")));
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`pg_dump failed (exit ${code}); the partial artifact is not a verified backup.`)));
  });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { file: path.basename(file), bytes: (await stat(file)).size, sha256: hash.digest("hex") };
}

async function main() {
  const connection = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || "missing");
  assert(["postgres:", "postgresql:"].includes(connection.protocol));
  const verification = process.argv.indexOf("--verify");
  const backup = process.argv.includes("--backup");
  assert(!(backup && verification !== -1), "Backup and restore verification are separate operations.");
  if (verification !== -1) {
    assert.equal(connection.hostname, "127.0.0.1");
    assert(["55439", "15439"].includes(connection.port));
    assert(connection.pathname.endsWith("_restore_test"), "Verification is restricted to an isolated restore database.");
  } else assert(connection.hostname.endsWith(".neon.tech"), "Source audit requires the explicitly configured Neon target.");
  if (backup) assert.equal(process.env.ALLOW_PRODUCTION_BACKUP, "1", "Explicit read-only backup authorization is required.");
  const pooled = new URL(process.env.DATABASE_URL || "missing");
  assert.equal(pooled.pathname, connection.pathname, "Database URLs must name the same database.");
  let directory: string | undefined;
  if (backup) { await mkdir("backups", { recursive: true }); directory = await mkdtemp(path.resolve("backups", "pre-r2-")); }
  const audit = await client.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const tables = await tx.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    const counts: Record<string, number> = {};
    for (const { table_name: name } of tables) {
      const [row] = await tx.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) AS count FROM public."${name.replaceAll('"', '""')}"`);
      counts[name] = Number(row.count);
    }
    const notes = await tx.closedTradeNote.findMany({ orderBy: { groupKey: "asc" } });
    const evidence = workstationEvidenceManifest(notes);
    let assignments = 0, unassigned = 0, drawings = 0, reviews = 0;
    const dangling: string[] = [];
    for (const note of notes) if (note.workstationJson) {
      reviews++;
      // Section assignments live in the linked JournalEntry templateData, not
      // the deliberately stripped notion field in ClosedTradeNote JSON.
      const present = await tx.closedTrade.findUnique({ where: { groupKey: note.groupKey }, select: { groupKey: true } });
      const document = present ? await readWorkstationDocument(note.groupKey, tx) : JSON.parse(note.workstationJson) as TradeDocument;
      const ids = new Set((document.evidence ?? []).map(image => image.id));
      const assigned = new Set<string>();
      for (const section of allSectionKeys(document.review?.notion)) for (const id of sectionEvidenceIds(document.review?.notion, section)) {
        assignments++; assigned.add(id); if (!ids.has(id)) dangling.push(`${note.groupKey}:${section}:${id}`);
      }
      unassigned += [...ids].filter(id => !assigned.has(id)).length;
      drawings += document.drawings?.length ?? 0;
    }
    const legacy = await tx.closedTradeAnnotation.findMany({ orderBy: { id: "asc" } });
    const journals = await tx.journalEntry.findMany({ orderBy: { id: "asc" } });
    const charts = await tx.journalChart.findMany({ orderBy: { id: "asc" } });
    const externalStandalone = charts.filter(chart => !chart.screenshotUrl?.startsWith("data:") && (chart.screenshotKey || chart.screenshotUrl)).length;
    const preservation = { counts, reviews, assignments, unassigned, drawings, evidence,
      noteRowsSha256: checksum(JSON.stringify(notes)), legacyDrawingsSha256: checksum(JSON.stringify(legacy)),
      standaloneJournalsSha256: checksum(JSON.stringify(journals)), standaloneChartsSha256: checksum(JSON.stringify(charts)), dangling, externalStandalone };
    let artifact;
    if (directory) {
      const [row] = await tx.$queryRaw<{ snapshot: string }[]>`SELECT pg_export_snapshot() AS snapshot`;
      artifact = await dump(row.snapshot, path.join(directory, "postgres.dump"), connection);
    }
    return { version: 1, measuredAt: new Date().toISOString(), preservation, artifact,
      imagesCompleteInDatabaseDump: externalStandalone === 0 && evidence.invalid.length === 0 && evidence.entries.every(entry => !entry.assetId) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 280_000, maxWait: 15_000 });
  if (verification !== -1) {
    const expected = JSON.parse(await readFile(process.argv[verification + 1], "utf8"));
    const actual = structuredClone(audit.preservation);
    if (process.argv.includes("--after-additive-migration")) {
      for (const table of ["EvidenceAsset", "EvidenceUploadSession", "EvidenceAssetReference", "EvidenceMaintenanceState", "EvidenceBackupSession"]) {
        assert.equal(actual.counts[table], 0, `New table ${table} must be empty during schema-only rehearsal.`);
        assert.equal(expected.preservation.counts[table], undefined);
        delete actual.counts[table];
      }
      assert.equal(actual.counts._prisma_migrations, expected.preservation.counts._prisma_migrations + 1);
      actual.counts._prisma_migrations--;
      const migrations = await client.$queryRaw<{ migration_name: string; checksum: string }[]>`SELECT migration_name, checksum FROM "_prisma_migrations" WHERE migration_name = '20260924000000_private_evidence_assets' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      assert.equal(migrations.length, 1);
      assert.equal(migrations[0].checksum, createHash("sha256").update(await readFile("prisma/migrations/20260924000000_private_evidence_assets/migration.sql")).digest("hex"));
    }
    assert.deepEqual(actual, expected.preservation, "Restored counts, reviews, assignments or image checksums differ.");
  }
  if (directory) await writeFile(path.join(directory, "preservation.json"), JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ action: verification !== -1 ? "restore-verified" : backup ? "backup-created-needs-restore-verification" : "read-only-audit", tables: Object.keys(audit.preservation.counts).length, reviews: audit.preservation.reviews, images: audit.preservation.evidence.entries.length, originalBytes: audit.preservation.evidence.entries.reduce((sum, entry) => sum + entry.bytes, 0), assignments: audit.preservation.assignments, unassigned: audit.preservation.unassigned, invalidImages: audit.preservation.evidence.invalid.length, danglingAssignments: audit.preservation.dangling.length, externalStandalone: audit.preservation.externalStandalone, imagesCompleteInDatabaseDump: audit.imagesCompleteInDatabaseDump, backupDirectory: directory }));
}
main().catch(() => { console.error("Preservation audit failed. No source data was changed; verify connection access, target selection and backup/restore prerequisites."); process.exitCode = 1; }).finally(() => client.$disconnect());
