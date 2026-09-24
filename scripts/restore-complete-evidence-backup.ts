import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { restoreCompleteEvidenceBackupToIsolated, verifyCompleteEvidenceBackup } from "../src/lib/server/evidence-backup-restore";

/** Verify by default. Applying is restricted to an explicitly opted-in, empty, local restore-test DB. */
async function main() {
  const apply = process.argv.includes("--apply"), paths = process.argv.slice(2).filter(arg => arg !== "--apply");
  if (!paths.length || paths.some(arg => arg.startsWith("--"))) throw new Error("Supply all complete-backup ZIP parts; add --apply only for an isolated restore.");
  const files: Record<string, Uint8Array> = {};
  for (const path of paths) {
    const bytes = await readFile(path);
    if (bytes.length > 100_000_000) throw new Error("Backup part exceeds 100 MB. Use the bounded complete-backup parts.");
    const part = unzipSync(bytes, { filter: file => {
      if (file.originalSize > 20_000_000 || !/^(manifest\.json|database\/part-\d{5}\.bin|originals\/[a-zA-Z0-9-]+\.png)$/.test(file.name)) throw new Error("Unexpected or oversized backup entry.");
      return true;
    } });
    for (const [name, data] of Object.entries(part)) {
      if (files[name] && !Buffer.from(files[name]).equals(data)) throw new Error(`Backup parts disagree: ${name}`);
      files[name] = data;
    }
  }
  const verified = verifyCompleteEvidenceBackup(files);
  if (!apply) {
    console.log(JSON.stringify({ verified: true, mutated: false, originals: verified.manifest.originals.length, tables: verified.plan.tableCount, rows: verified.plan.totalRows, warnings: verified.manifest.warnings }));
    return;
  }
  console.log(JSON.stringify(await restoreCompleteEvidenceBackupToIsolated(files)));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Complete backup verification/restore failed."); process.exitCode = 1; });
