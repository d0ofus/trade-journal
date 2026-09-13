import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { buildBackupRestorePlan } from "../src/lib/server/backup-restore";

async function main() {
  const targets = assertTestDatabaseSafety(process.env);
  if (!targets.databaseUrl.database.endsWith("_restore_test") || targets.databaseUrl.schema !== "public") throw Error("Use a dedicated, empty local restore-test database.");
  const file = process.argv[2]; if (!file) throw Error("Supply an application backup file.");
  const bytes = await fs.readFile(file), plan = buildBackupRestorePlan(JSON.parse(bytes.toString("utf8")));
  const db = new PrismaClient({ log: [] });
  const delegates = db as unknown as Record<string, { count(): Promise<number>; createMany(args: { data: unknown[] }): Promise<unknown>; findMany(): Promise<Record<string, unknown>[]> }>;
  const stable = (value: unknown): string => {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  try {
    for (const table of plan.tables) if (await delegates[table.delegateName].count()) throw Error("Restore target is not empty. Existing data is preserved.");
    await db.$transaction(async tx => {
      const write = tx as unknown as typeof delegates;
      for (const table of plan.tables) if (table.rows.length) {
        const fields = Prisma.dmmf.datamodel.models.find(m => m.name === table.prismaModel)!.fields.filter(f => f.type === "Json").map(f => f.name);
        await write[table.delegateName].createMany({ data: table.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null && fields.includes(key) ? Prisma.DbNull : value]))) });
      }
    }, { timeout: 120000 });
    let compared = 0;
    for (const table of plan.tables) {
      const actual = await delegates[table.delegateName].findMany();
      // Compare all exported scalar fields; omitted legacy defaults may be supplied by Prisma.
      const expected = table.rows.map(stable).sort();
      const keys = [...new Set(table.rows.flatMap(Object.keys))];
      const restored = actual.map(row => stable(Object.fromEntries(keys.map(k => [k, row[k]])))).sort();
      if (JSON.stringify(expected) !== JSON.stringify(restored)) throw Error(`Restored data differs in ${table.key}`);
      compared += table.rows.length;
    }
    const evidence = { restoredAt: new Date().toISOString(), sha256: createHash("sha256").update(bytes).digest("hex"), payloadBytes: bytes.length, tables: plan.tableCount, rows: compared, isolatedRestoreVerified: true, database: targets.databaseUrl.database };
    await fs.writeFile(path.join(path.dirname(file), "retention-application-restore-evidence.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Restore failed"); process.exitCode = 1; });
