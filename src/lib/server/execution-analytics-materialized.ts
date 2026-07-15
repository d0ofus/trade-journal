import { prisma } from "@/lib/prisma";
import {
  getExecutionAnalyticsSourceSnapshot,
  isMaterializationWatermarkFresh,
  MATERIALIZATION_WATERMARK_KEYS,
  writeMaterializationWatermark,
} from "@/lib/server/materialization-watermarks";
import {
  buildOpeningPositionMap,
  openingPositionKey,
  type OpeningPositionExecutionCandidate,
} from "@/lib/stats/opening-positions";
import { computeExecutionPnl } from "@/lib/stats/pnl";

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function buildOpeningByAccountInstrument(executions: OpeningPositionExecutionCandidate[]) {
  const candidateKeys = new Set(
    executions.map((exec) =>
      openingPositionKey(exec.accountId, {
        symbol: exec.instrument.symbol,
        assetType: exec.instrument.assetType,
        currency: exec.currency ?? exec.instrument.currency,
      }),
    ),
  );
  if (candidateKeys.size === 0) return new Map<string, { quantity: number; avgCost: number }>();

  const latestFirstExecutionAt = new Date(Math.max(...executions.map((exec) => exec.executedAt.getTime())));
  const snapshots = await prisma.positionSnapshot.findMany({
    where: {
      accountId: { in: [...new Set(executions.map((exec) => exec.accountId))] },
      date: { lt: latestFirstExecutionAt },
      instrument: {
        symbol: { in: [...new Set(executions.map((exec) => exec.instrument.symbol))] },
      },
    },
    select: {
      accountId: true,
      date: true,
      quantity: true,
      avgCost: true,
      currency: true,
      instrument: {
        select: {
          symbol: true,
          assetType: true,
          currency: true,
        },
      },
    },
    orderBy: { date: "desc" },
  });

  return buildOpeningPositionMap(executions, snapshots);
}

export async function refreshMaterializedExecutionAnalytics(options: { accountIds?: string[] } = {}) {
  const accountIds = [...new Set(options.accountIds?.filter(Boolean) ?? [])];
  const scoped = accountIds.length > 0;
  const [executions, positionSnapshotSource] = await Promise.all([
    prisma.execution.findMany({
      select: {
        id: true,
        accountId: true,
        instrumentId: true,
        executedAt: true,
        updatedAt: true,
        side: true,
        quantity: true,
        price: true,
        commission: true,
        fees: true,
        currency: true,
        instrument: {
          select: {
            symbol: true,
            assetType: true,
            currency: true,
          },
        },
      },
      orderBy: [{ executedAt: "asc" }, { id: "asc" }],
    }),
    scoped
      ? Promise.resolve(null)
      : prisma.positionSnapshot.aggregate({
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
  ]);
  const sourceSnapshot = scoped
    ? null
    : {
        executionCount: executions.length,
        executionMaxUpdatedAt:
          executions.reduce<Date | null>((latest, execution) => {
            if (!latest || execution.updatedAt.getTime() > latest.getTime()) return execution.updatedAt;
            return latest;
          }, null),
        positionSnapshotCount: positionSnapshotSource?._count._all ?? 0,
        positionSnapshotMaxUpdatedAt: positionSnapshotSource?._max.updatedAt ?? null,
      };

  const openingByAccountInstrument = await buildOpeningByAccountInstrument(executions);
  const analyticsRows = computeExecutionPnl(
    executions.map((exec) => ({
      id: exec.id,
      accountId: exec.accountId,
      instrumentId: exec.instrumentId,
      symbol: exec.instrument.symbol,
      assetType: exec.instrument.assetType,
      currency: exec.currency ?? exec.instrument.currency,
      executedAt: exec.executedAt,
      side: exec.side,
      quantity: exec.quantity,
      price: exec.price,
      commission: exec.commission,
      fees: exec.fees,
    })),
    openingByAccountInstrument,
  );
  const scopedExecutionIds = new Set(
    scoped ? executions.filter((execution) => accountIds.includes(execution.accountId)).map((execution) => execution.id) : [],
  );
  const analyticsRowsToPersist = scoped
    ? analyticsRows.filter((row) => scopedExecutionIds.has(row.executionId))
    : analyticsRows;

  await prisma.$transaction(async (tx) => {
    await tx.executionAnalytics.deleteMany({
      where: scoped ? { executionId: { in: [...scopedExecutionIds] } } : undefined,
    });

    for (const chunk of chunked(analyticsRowsToPersist, 500)) {
      await tx.executionAnalytics.createMany({
        data: chunk.map((row) => ({
          executionId: row.executionId,
          realizedPnl: row.realizedPnl,
          grossRealizedPnl: row.grossRealizedPnl,
          cumulativePnl: row.cumulativePnl,
          matchedQuantity: row.matchedQuantity,
          avgHoldTimeMs: row.avgHoldTimeMs,
        })),
        skipDuplicates: true,
      });
    }

    if (sourceSnapshot) {
      await writeMaterializationWatermark(tx, MATERIALIZATION_WATERMARK_KEYS.executionAnalytics, sourceSnapshot);
    }
  });

  return { rows: analyticsRowsToPersist.length };
}

export async function ensureMaterializedExecutionAnalytics() {
  const [sourceSnapshot, analyticsCount] = await Promise.all([
    getExecutionAnalyticsSourceSnapshot(prisma),
    prisma.executionAnalytics.count(),
  ]);

  if (sourceSnapshot.executionCount === 0) return false;
  if (
    analyticsCount === sourceSnapshot.executionCount &&
    (await isMaterializationWatermarkFresh(prisma, MATERIALIZATION_WATERMARK_KEYS.executionAnalytics, sourceSnapshot))
  ) {
    return false;
  }

  await refreshMaterializedExecutionAnalytics();
  return true;
}
