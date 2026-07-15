import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = Prisma.TransactionClient | PrismaClient;

export const MATERIALIZATION_WATERMARK_KEYS = {
  closedTrades: "closed-trades",
  executionAnalytics: "execution-analytics",
} as const;

export type MaterializationSourceSnapshot = {
  executionCount: number;
  executionMaxUpdatedAt: Date | null;
  positionSnapshotCount?: number;
  positionSnapshotMaxUpdatedAt?: Date | null;
};

function isoOrNull(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export function buildMaterializationSourceSignature(snapshot: MaterializationSourceSnapshot) {
  return JSON.stringify({
    executionCount: snapshot.executionCount,
    executionMaxUpdatedAt: isoOrNull(snapshot.executionMaxUpdatedAt),
    positionSnapshotCount: snapshot.positionSnapshotCount ?? 0,
    positionSnapshotMaxUpdatedAt: isoOrNull(snapshot.positionSnapshotMaxUpdatedAt),
  });
}

function sourceCountsJson(snapshot: MaterializationSourceSnapshot) {
  return JSON.stringify({
    executions: snapshot.executionCount,
    positionSnapshots: snapshot.positionSnapshotCount ?? 0,
  });
}

export async function getExecutionAnalyticsSourceSnapshot(db: DbClient): Promise<MaterializationSourceSnapshot> {
  const [executionSource, positionSnapshotSource] = await Promise.all([
    db.execution.aggregate({
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    db.positionSnapshot.aggregate({
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  return {
    executionCount: executionSource._count._all,
    executionMaxUpdatedAt: executionSource._max.updatedAt,
    positionSnapshotCount: positionSnapshotSource._count._all,
    positionSnapshotMaxUpdatedAt: positionSnapshotSource._max.updatedAt,
  };
}

export async function getClosedTradesSourceSnapshot(db: DbClient): Promise<MaterializationSourceSnapshot> {
  const [executionSource, positionSnapshotSource] = await Promise.all([
    db.execution.aggregate({
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    db.positionSnapshot.aggregate({
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  return {
    executionCount: executionSource._count._all,
    executionMaxUpdatedAt: executionSource._max.updatedAt,
    positionSnapshotCount: positionSnapshotSource._count._all,
    positionSnapshotMaxUpdatedAt: positionSnapshotSource._max.updatedAt,
  };
}

export async function isMaterializationWatermarkFresh(
  db: DbClient,
  key: string,
  sourceSnapshot: MaterializationSourceSnapshot,
) {
  const watermark = await db.materializationWatermark.findUnique({
    where: { key },
    select: { sourceSignature: true },
  });

  return watermark?.sourceSignature === buildMaterializationSourceSignature(sourceSnapshot);
}

export async function writeMaterializationWatermark(
  db: DbClient,
  key: string,
  sourceSnapshot: MaterializationSourceSnapshot,
) {
  const sourceSignature = buildMaterializationSourceSignature(sourceSnapshot);
  const countsJson = sourceCountsJson(sourceSnapshot);

  await db.materializationWatermark.upsert({
    where: { key },
    update: {
      sourceSignature,
      sourceCountsJson: countsJson,
      refreshedAt: new Date(),
    },
    create: {
      key,
      sourceSignature,
      sourceCountsJson: countsJson,
    },
  });
}
