import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  markImportBatchesMaterializationFailed,
  markImportBatchesMaterialized,
} from "@/lib/server/import-service";

describe("import batch lifecycle transitions", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  dbIt("updates complete unique cohorts atomically and rejects missing members", async () => {
    const marker = Date.now();
    const ids = [`phase15-batch-a-${marker}`, `phase15-batch-b-${marker}`];
    await prisma.importBatch.createMany({
      data: ids.map((id, index) => ({
        id,
        filename: `${id}.csv`,
        fileType: "executions",
        status: "ROWS_APPLIED" as const,
        cohortId: `phase15-cohort-${marker}`,
        sourceId: `phase15-source-${marker}-${index}`,
        cohortRole: "MEMBER" as const,
        rowsSeen: 1,
        rowsImported: 1,
      })),
    });

    try {
      await markImportBatchesMaterialized([ids[0], ids[1], ids[0]]);
      expect(
        (await prisma.importBatch.findMany({ where: { id: { in: ids } } })).every(
          (batch) => batch.status === "MATERIALIZED",
        ),
      ).toBe(true);

      await prisma.importBatch.updateMany({
        where: { id: { in: ids } },
        data: { status: "ROWS_APPLIED", errorMessage: null },
      });
      await expect(markImportBatchesMaterialized([ids[0]])).rejects.toThrow("requires all 2 members");
      expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("ROWS_APPLIED");

      await expect(markImportBatchesMaterialized([ids[0], `phase15-missing-${marker}`])).rejects.toThrow(
        "Expected 2 import batches but found 1",
      );
      expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("ROWS_APPLIED");

      await markImportBatchesMaterializationFailed(ids, "Final import status update failed: injected failure");
      const failed = await prisma.importBatch.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
      expect(failed).toHaveLength(2);
      expect(failed.every((batch) => batch.status === "MATERIALIZATION_FAILED")).toBe(true);
      expect(failed.every((batch) => batch.errorMessage?.includes("Final import status update failed"))).toBe(true);
      expect(failed.every((batch) => batch.notes?.includes("post-import processing did not complete"))).toBe(true);

      await prisma.importBatch.update({
        where: { id: ids[0] },
        data: { status: "ROWS_APPLIED", errorMessage: null, notes: null },
      });
      await expect(
        markImportBatchesMaterializationFailed([ids[0], `phase15-missing-${marker}`], "injected failure"),
      ).rejects.toThrow("Expected 2 import batches but found 1");
      expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: ids[0] } })).toMatchObject({
        status: "ROWS_APPLIED",
        errorMessage: null,
        notes: null,
      });
    } finally {
      await prisma.importBatch.deleteMany({ where: { id: { in: ids } } });
    }
  });
});
