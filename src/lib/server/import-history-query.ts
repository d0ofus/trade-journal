import type { ImportHistoryBatchItem, ImportHistoryPage } from "@/lib/import/import-history";
import { prisma } from "@/lib/prisma";

const DEFAULT_COHORT_LIMIT = 20;
const MAX_COHORT_LIMIT = 50;

type ImportHistoryCursor = {
  importedAt: Date;
  id: string;
};

type ImportHistoryAnchorRow = {
  cohortKey: string;
  cohortId: string | null;
  importedAt: Date;
  id: string;
};

function cohortKey(batch: { id: string; cohortId: string | null }) {
  return batch.cohortId ? `cohort:${batch.cohortId}` : `legacy:${batch.id}`;
}

export function encodeImportHistoryCursor(cursor: ImportHistoryCursor) {
  return Buffer.from(
    JSON.stringify({ importedAt: cursor.importedAt.toISOString(), id: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeImportHistoryCursor(value: string | null | undefined): ImportHistoryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      importedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.importedAt !== "string" || typeof parsed.id !== "string" || parsed.id.length === 0) {
      return null;
    }
    const importedAt = new Date(parsed.importedAt);
    if (Number.isNaN(importedAt.getTime())) return null;
    return { importedAt, id: parsed.id };
  } catch {
    return null;
  }
}

function serializeBatch(batch: Awaited<ReturnType<typeof loadImportHistoryBatches>>[number]): ImportHistoryBatchItem {
  return {
    id: batch.id,
    filename: batch.filename,
    fileType: batch.fileType,
    rowsSeen: batch.rowsSeen,
    rowsImported: batch.rowsImported,
    rowsSkipped: batch.rowsSkipped,
    status: batch.status,
    errorMessage: batch.errorMessage,
    rawSha256: batch.rawSha256,
    rawBytes: batch.rawBytes,
    rawStorageKey: batch.rawStorageKey,
    parserVersion: batch.parserVersion,
    positionSnapshotMode: batch.positionSnapshotMode,
    cohortId: batch.cohortId,
    sourceId: batch.sourceId,
    sourceFilename: batch.sourceFilename,
    sourceSection: batch.sourceSection,
    cohortRole: batch.cohortRole,
    importedAt: batch.importedAt.toISOString(),
    notes: batch.notes,
    rowErrorCount: batch._count.rowErrors,
    rowErrors: batch.rowErrors,
  };
}

async function loadImportHistoryBatches(cohortIds: string[], legacyIds: string[]) {
  return prisma.importBatch.findMany({
    where: {
      OR: [
        ...(cohortIds.length > 0 ? [{ cohortId: { in: cohortIds } }] : []),
        ...(legacyIds.length > 0 ? [{ id: { in: legacyIds }, cohortId: null }] : []),
      ],
    },
    orderBy: [{ importedAt: "desc" }, { id: "desc" }],
    include: {
      _count: { select: { rowErrors: true } },
      rowErrors: {
        orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 5,
        select: { id: true, rowNumber: true, code: true, message: true },
      },
    },
  });
}

export async function getImportHistoryPage(options: {
  cursor?: string | null;
  cohortLimit?: number;
} = {}): Promise<ImportHistoryPage> {
  const cursor = decodeImportHistoryCursor(options.cursor);
  const cohortLimit = Math.min(MAX_COHORT_LIMIT, Math.max(1, Math.trunc(options.cohortLimit ?? DEFAULT_COHORT_LIMIT)));
  const [persistedAnchors, legacyAnchors] = await Promise.all([
    prisma.importBatch.findMany({
      where: { cohortId: { not: null } },
      distinct: ["cohortId"],
      orderBy: [{ cohortId: "asc" }, { importedAt: "desc" }, { id: "desc" }],
      select: { cohortId: true, importedAt: true, id: true },
    }),
    prisma.importBatch.findMany({
      where: { cohortId: null },
      select: { cohortId: true, importedAt: true, id: true },
    }),
  ]);
  const anchors: ImportHistoryAnchorRow[] = [...persistedAnchors, ...legacyAnchors]
    .map((anchor) => ({
      ...anchor,
      cohortKey: anchor.cohortId ? `cohort:${anchor.cohortId}` : `legacy:${anchor.id}`,
    }))
    .filter(
      (anchor) =>
        !cursor ||
        anchor.importedAt.getTime() < cursor.importedAt.getTime() ||
        (anchor.importedAt.getTime() === cursor.importedAt.getTime() && anchor.id < cursor.id),
    )
    .sort((left, right) => {
      const byTime = right.importedAt.getTime() - left.importedAt.getTime();
      return byTime || right.id.localeCompare(left.id);
    });
  const anchorRows = anchors.slice(0, cohortLimit + 1);

  const hasNextPage = anchorRows.length > cohortLimit;
  const pageAnchors = anchorRows.slice(0, cohortLimit);
  if (pageAnchors.length === 0) {
    return { cohorts: [], pageInfo: { hasNextPage: false, nextCursor: null } };
  }

  const cohortIds = pageAnchors.flatMap((anchor) => (anchor.cohortId ? [anchor.cohortId] : []));
  const legacyIds = pageAnchors.flatMap((anchor) => (anchor.cohortId ? [] : [anchor.id]));
  const batches = await loadImportHistoryBatches(cohortIds, legacyIds);
  const batchesByCohort = new Map<string, ImportHistoryBatchItem[]>();
  for (const batch of batches) {
    const key = cohortKey(batch);
    const members = batchesByCohort.get(key) ?? [];
    members.push(serializeBatch(batch));
    batchesByCohort.set(key, members);
  }

  const cohorts = pageAnchors.map((anchor) => ({
    key: anchor.cohortKey,
    cohortId: anchor.cohortId,
    importedAt: anchor.importedAt.toISOString(),
    batches: batchesByCohort.get(anchor.cohortKey) ?? [],
  }));
  const lastAnchor = pageAnchors.at(-1)!;

  return {
    cohorts,
    pageInfo: {
      hasNextPage,
      nextCursor: hasNextPage
        ? encodeImportHistoryCursor({ importedAt: lastAnchor.importedAt, id: lastAnchor.id })
        : null,
    },
  };
}
