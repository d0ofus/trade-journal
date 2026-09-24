import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BACKUP_TABLES } from "@/lib/server/backup-contract";
import {
  BACKUP_RELEVANT_TIMESTAMP_SOURCES,
  BACKUP_OPERATIONAL_TIMESTAMPS,
  buildBackupSourceMetadata,
  readBackupSourceMetadata,
} from "@/lib/server/backup-freshness";

const MUTATION_TIMESTAMP_FIELDS = new Set(["createdAt", "updatedAt", "importedAt", "refreshedAt"]);

function prismaSchema() {
  return readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
}

function modelDateFields(schema: string, prismaModel: string) {
  const modelMatch = schema.match(new RegExp(`model ${prismaModel} \\{([\\s\\S]*?)\\n\\}`));
  if (!modelMatch) return [];
  return modelMatch[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s+(\w+)\s+DateTime\b/)?.[1])
    .filter((field): field is string => Boolean(field));
}

describe("backup freshness source metadata", () => {
  it("builds a stable signature from backup row counts and latest data change", () => {
    const source = buildBackupSourceMetadata({
      latestDataChangeAt: "2026-06-26T00:00:00.000Z",
      rowCounts: {
        accounts: 1,
        backupAudits: 99,
        closedTrades: 3,
      },
    });
    const sameSource = buildBackupSourceMetadata({
      latestDataChangeAt: new Date("2026-06-26T00:00:00.000Z"),
      rowCounts: {
        accounts: 1,
        backupAudits: 1,
        closedTrades: 3,
      },
    });
    const changedSource = buildBackupSourceMetadata({
      latestDataChangeAt: "2026-06-26T00:00:00.000Z",
      rowCounts: {
        accounts: 1,
        closedTrades: 4,
      },
    });

    expect(source.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(source.signature).toBe(sameSource.signature);
    expect(source.signature).not.toBe(changedSource.signature);
    expect(source.rowCounts.backupAudits).toBeUndefined();
  });

  it("reads only self-consistent source metadata from a backup payload", () => {
    const source = buildBackupSourceMetadata({
      latestDataChangeAt: "2026-06-26T00:00:00.000Z",
      rowCounts: {
        accounts: 1,
        closedTrades: 3,
      },
    });

    expect(readBackupSourceMetadata({ manifest: { source } })).toMatchObject(source);
    expect(readBackupSourceMetadata({ manifest: { source: { ...source, signature: "bad" } } })).toBeNull();
    expect(readBackupSourceMetadata({ manifest: {} })).toBeNull();
  });

  it("tracks every content timestamp and explicitly accounts for operational clocks", () => {
    const schema = prismaSchema();
    const sourceByKey = new Map<string, (typeof BACKUP_RELEVANT_TIMESTAMP_SOURCES)[number]>(
      BACKUP_RELEVANT_TIMESTAMP_SOURCES.map((source) => [source.key, source]),
    );

    expect(sourceByKey.has("backupAudits")).toBe(false);

    for (const source of BACKUP_RELEVANT_TIMESTAMP_SOURCES) {
      const table = BACKUP_TABLES.find((candidate) => candidate.key === source.key);
      expect(table?.prismaModel).toBe(source.prismaModel);
      const dateFields = modelDateFields(schema, source.prismaModel);
      expect(source.timestampFields.length).toBeGreaterThan(0);
      expect(dateFields).toEqual(expect.arrayContaining([...source.timestampFields]));
    }

    for (const table of BACKUP_TABLES) {
      if (table.key === "backupAudits" || table.key === "marketCandles") continue;

      const ignored = BACKUP_OPERATIONAL_TIMESTAMPS[table.key] ?? {};
      const dateFields = modelDateFields(schema, table.prismaModel);
      for (const [field, reason] of Object.entries(ignored)) {
        expect(dateFields).toContain(field);
        expect(reason.length).toBeGreaterThan(20);
        expect(sourceByKey.get(table.key)?.timestampFields ?? []).not.toContain(field);
      }
      const mutationFields = dateFields.filter((field) => MUTATION_TIMESTAMP_FIELDS.has(field) && !(field in ignored));
      if (mutationFields.length === 0) continue;

      const source = sourceByKey.get(table.key);
      expect(source, `${table.key} should contribute to backup freshness`).toBeDefined();
      expect(source?.timestampFields).toEqual(expect.arrayContaining(mutationFields));
    }
  });
});
