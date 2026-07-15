import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_TABLES,
  buildBackupTableManifest,
  buildBackupTableManifestFromRowCounts,
  validateBackupPayloadShape,
} from "@/lib/server/backup-contract";

function prismaModelNames() {
  const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]).sort();
}

describe("backup table contract", () => {
  it("maps every Prisma model to exactly one backup table", () => {
    const models = prismaModelNames();
    const contractModels = BACKUP_TABLES.map((table) => table.prismaModel).sort();

    expect(contractModels).toEqual(models);
    expect(new Set(BACKUP_TABLES.map((table) => table.key)).size).toBe(BACKUP_TABLES.length);
    expect(new Set(contractModels).size).toBe(contractModels.length);
  });

  it("computes row counts and reports missing or extra payload arrays", () => {
    const payload = Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, [{ id: table.key }]]));
    delete payload.accounts;
    payload.unexpectedRows = [];

    const manifest = buildBackupTableManifest(payload);
    const validation = validateBackupPayloadShape(payload);

    expect(manifest.rowCounts.instruments).toBe(1);
    expect(manifest.rowCounts.accounts).toBe(0);
    expect(manifest.totalRows).toBe(BACKUP_TABLES.length - 1);
    expect(manifest.complete).toBe(false);
    expect(manifest.missingTables).toEqual(["accounts"]);
    expect(manifest.extraArrayKeys).toEqual(["unexpectedRows"]);
    expect(validation).toEqual({
      ok: false,
      missingTables: ["accounts"],
      extraArrayKeys: ["unexpectedRows"],
    });
  });

  it("builds the same table shape from row counts without full row payloads", () => {
    const rowCounts = Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, 2]));
    const manifest = buildBackupTableManifestFromRowCounts(rowCounts);

    expect(manifest.complete).toBe(true);
    expect(manifest.totalTables).toBe(BACKUP_TABLES.length);
    expect(manifest.totalRows).toBe(BACKUP_TABLES.length * 2);
    expect(manifest.rowCounts.accounts).toBe(2);
  });

  it("orders restore dependencies before dependent tables", () => {
    const rowCounts = Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, 0]));
    const manifest = buildBackupTableManifestFromRowCounts(rowCounts);
    const order = new Map(manifest.importOrder.map((key, index) => [key, index]));

    for (const table of BACKUP_TABLES) {
      for (const dependency of table.dependencies) {
        expect(order.get(dependency), `${dependency} should be before ${table.key}`).toBeLessThan(order.get(table.key) ?? -1);
      }
    }

    expect(order.get("importArtifacts")).toBeLessThan(order.get("importBatches") ?? -1);
    expect(order.get("tags")).toBeLessThan(order.get("closedTradeTags") ?? -1);
    expect(order.get("playbooks")).toBeLessThan(order.get("journalEntries") ?? -1);
  });
});
