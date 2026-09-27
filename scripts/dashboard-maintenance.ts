import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runDashboardMaintenance } from "../src/lib/server/dashboard-maintenance";

// An explicit database target is required; this command never discovers production credentials.
async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" }, apply: { type: "boolean", default: false }, "manifest-hash": { type: "string" }, "backup-manifest": { type: "string" } } });
  if (!process.env.DATABASE_URL || !process.env.REPORTING_ACCOUNT_CODE || !values.out) throw new Error("Set DATABASE_URL and REPORTING_ACCOUNT_CODE, and supply --out in a private backup directory");
  if (values.apply) {
    if (!values["manifest-hash"] || !values["backup-manifest"]) throw new Error("Apply requires the rehearsed --manifest-hash and --backup-manifest");
    const file = path.resolve(values["backup-manifest"]), directory = path.dirname(file);
    const manifest = JSON.parse(await readFile(file, "utf8"));
    await readFile(path.join(directory, "restore-verification.json"), "utf8");
    const checksum = createHash("sha256").update(await readFile(path.join(directory, "database.dump"))).digest("hex");
    if (checksum !== manifest.databaseSha256) throw new Error("Backup checksum does not match the tested backup manifest");
  }
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
  try {
    const result = await runDashboardMaintenance(db, { apply: values.apply, expectedManifestHash: values["manifest-hash"] });
    await writeFile(values.out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ applied: result.applied, manifestHash: result.manifestHash, preserved: result.preservationHash, genuineTrades: result.genuineTradeCount, deletion: Object.fromEntries(Object.entries(result.manifest.deletion).map(([table, rows]) => [table, rows.length])), executionUpdates: result.manifest.executionUpdates.length, instrumentUpdates: result.manifest.instrumentUpdates.length, tradeUpdates: result.manifest.groupUpdates.length }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[database]") : "Maintenance failed"); process.exitCode = 1; });
