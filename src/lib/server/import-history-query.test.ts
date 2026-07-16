import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  decodeImportHistoryCursor,
  encodeImportHistoryCursor,
  getImportHistoryPage,
} from "@/lib/server/import-history-query";

const TEST_PREFIX = "phase6-history-";

describe("import history cohort pagination", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  afterEach(async () => {
    if (!process.env.DATABASE_URL) return;
    await prisma.importBatch.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("round-trips stable cursor anchors and rejects malformed cursors", () => {
    const anchor = { importedAt: new Date("2026-07-16T01:02:03.000Z"), id: "batch-id" };
    const encoded = encodeImportHistoryCursor(anchor);

    expect(decodeImportHistoryCursor(encoded)).toEqual(anchor);
    expect(decodeImportHistoryCursor("not-a-cursor")).toBeNull();
  });

  dbIt("returns every member of a cohort larger than the former 20-row history limit", async () => {
    const cohortId = `${TEST_PREFIX}large-cohort`;
    const importedAt = new Date("2099-12-31T23:59:59.000Z");
    await prisma.importBatch.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `${TEST_PREFIX}large-${String(index).padStart(2, "0")}`,
        filename: `large-source-${index}.csv`,
        fileType: "executions",
        status: "MATERIALIZED" as const,
        importedAt,
        cohortId,
        sourceId: `${TEST_PREFIX}source-${index}`,
        sourceFilename: `large-source-${index}.csv`,
        cohortRole: "MEMBER" as const,
      })),
    });

    const page = await getImportHistoryPage();
    const cohort = page.cohorts.find((item) => item.cohortId === cohortId);

    expect(cohort?.batches).toHaveLength(25);
    expect(new Set(cohort?.batches.map((batch) => batch.id)).size).toBe(25);
  });

  dbIt("paginates complete cohorts without missing, duplicating, or splitting members", async () => {
    const baseTime = Date.parse("2099-12-30T12:00:00.000Z");
    const expectedByCohort = new Map<string, string[]>();
    for (let cohortIndex = 0; cohortIndex < 7; cohortIndex += 1) {
      const cohortId = `${TEST_PREFIX}page-cohort-${cohortIndex}`;
      const memberCount = cohortIndex === 2 ? 4 : 1;
      const ids = Array.from({ length: memberCount }, (_, memberIndex) =>
        `${TEST_PREFIX}page-${cohortIndex}-${memberIndex}`,
      );
      expectedByCohort.set(cohortId, ids);
      await prisma.importBatch.createMany({
        data: ids.map((id, memberIndex) => ({
          id,
          filename: `${id}.csv`,
          fileType: "executions",
          status: "MATERIALIZED" as const,
          importedAt: new Date(baseTime - cohortIndex * 1_000),
          cohortId,
          sourceId: `${TEST_PREFIX}page-source-${cohortIndex}-${memberIndex}`,
          sourceFilename: `${id}.csv`,
          cohortRole: "MEMBER" as const,
        })),
      });
    }
    const legacyId = `${TEST_PREFIX}page-legacy`;
    await prisma.importBatch.create({
      data: {
        id: legacyId,
        filename: "legacy.csv",
        fileType: "executions",
        status: "FAILED",
        importedAt: new Date(baseTime - 7_000),
      },
    });

    const pages = [];
    let cursor: string | null = null;
    for (let index = 0; index < 3; index += 1) {
      const page = await getImportHistoryPage({ cursor, cohortLimit: 3 });
      pages.push(page);
      cursor = page.pageInfo.nextCursor;
    }

    const cohorts = pages.flatMap((page) => page.cohorts);
    const expectedCohortKeys = [...expectedByCohort.keys()].map((id) => `cohort:${id}`);
    const seenExpected = cohorts.filter((cohort) => expectedCohortKeys.includes(cohort.key));
    const seenIds = seenExpected.flatMap((cohort) => cohort.batches.map((batch) => batch.id));
    const expectedIds = [...expectedByCohort.values()].flat();

    expect(seenExpected.map((cohort) => cohort.key)).toEqual(expectedCohortKeys);
    expect(seenIds).toHaveLength(new Set(seenIds).size);
    expect(new Set(seenIds)).toEqual(new Set(expectedIds));
    for (const cohort of seenExpected) {
      expect(new Set(cohort.batches.map((batch) => batch.id))).toEqual(
        new Set(expectedByCohort.get(cohort.cohortId!) ?? []),
      );
    }
    const legacy = cohorts.find((cohort) => cohort.key === `legacy:${legacyId}`);
    expect(legacy?.cohortId).toBeNull();
    expect(legacy?.batches.map((batch) => batch.id)).toEqual([legacyId]);
  });
});
