import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getClosedTradesSourceSnapshot,
  isMaterializationWatermarkFresh,
  MATERIALIZATION_WATERMARK_KEYS,
  writeMaterializationWatermark,
} from "@/lib/server/materialization-watermarks";
import { planClosedTradeRefresh } from "@/lib/stats/closed-trade-materialization-plan";
import { computeClosedTradeGroups, type ClosedTradeGroup } from "@/lib/stats/closed-trades";
import {
  buildOpeningPositionMap,
  openingPositionKey,
  type OpeningPositionExecutionCandidate,
} from "@/lib/stats/opening-positions";

const CLOSED_TRADES_REFRESH_LOCK_KEY = 76_384_211;
const CLOSED_TRADE_UPSERT_CHUNK_SIZE = 500;

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export async function upsertMaterializedClosedTradeGroups(
  tx: Prisma.TransactionClient,
  groups: ClosedTradeGroup[],
) {
  for (const chunk of chunked(groups, CLOSED_TRADE_UPSERT_CHUNK_SIZE)) {
    const now = new Date();
    const rows = chunk.map(
      (group) => Prisma.sql`(
        ${group.groupKey},
        ${group.accountId},
        ${group.instrumentId},
        ${group.symbol},
        ${group.side},
        ${new Date(group.openTime)},
        ${new Date(group.closeTime)},
        ${new Date(`${group.tradeDate}T00:00:00.000Z`)},
        ${group.totalQuantity},
        ${group.avgEntryPrice},
        ${group.avgExitPrice},
        ${group.grossRealizedPnl},
        ${group.openingQuantity},
        ${group.closingQuantity},
        ${group.realizedPnl},
        ${group.totalCommission},
        false,
        NULL,
        NULL,
        ${now},
        ${now}
      )`,
    );

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ClosedTrade" (
        "groupKey",
        "accountId",
        "instrumentId",
        "symbol",
        "direction",
        "openTime",
        "closeTime",
        "tradeDate",
        "totalQuantity",
        "avgEntryPrice",
        "avgExitPrice",
        "grossRealizedPnl",
        "openingQuantity",
        "closingQuantity",
        "realizedPnl",
        "totalCommission",
        "isStale",
        "staleAt",
        "staleReason",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("groupKey") DO UPDATE SET
        "accountId" = EXCLUDED."accountId",
        "instrumentId" = EXCLUDED."instrumentId",
        "symbol" = EXCLUDED."symbol",
        "direction" = EXCLUDED."direction",
        "openTime" = EXCLUDED."openTime",
        "closeTime" = EXCLUDED."closeTime",
        "tradeDate" = EXCLUDED."tradeDate",
        "totalQuantity" = EXCLUDED."totalQuantity",
        "avgEntryPrice" = EXCLUDED."avgEntryPrice",
        "avgExitPrice" = EXCLUDED."avgExitPrice",
        "grossRealizedPnl" = EXCLUDED."grossRealizedPnl",
        "openingQuantity" = EXCLUDED."openingQuantity",
        "closingQuantity" = EXCLUDED."closingQuantity",
        "realizedPnl" = EXCLUDED."realizedPnl",
        "totalCommission" = EXCLUDED."totalCommission",
        "isStale" = false,
        "staleAt" = NULL,
        "staleReason" = NULL,
        "updatedAt" = EXCLUDED."updatedAt"
    `);
  }
}

async function buildOpeningByAccountInstrument(
  tx: Prisma.TransactionClient,
  executions: OpeningPositionExecutionCandidate[],
) {
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

  const snapshots = await tx.positionSnapshot.findMany({
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

export async function refreshMaterializedClosedTrades(options: { accountIds?: string[] } = {}) {
  const accountIds = [...new Set(options.accountIds?.filter(Boolean) ?? [])];
  const scoped = accountIds.length > 0;
  let groupCount = 0;

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLOSED_TRADES_REFRESH_LOCK_KEY})`;
      const sourceSnapshot = scoped ? null : await getClosedTradesSourceSnapshot(tx);

      const executions = await tx.execution.findMany({
        where: scoped ? { accountId: { in: accountIds } } : undefined,
        select: {
          id: true,
          accountId: true,
          instrumentId: true,
          executedAt: true,
          side: true,
          quantity: true,
          price: true,
          commission: true,
          fees: true,
          currency: true,
          instrument: {
            select: {
              symbol: true,
              exchange: true,
              assetType: true,
              currency: true,
            },
          },
          account: {
            select: {
              ibkrAccount: true,
            },
          },
        },
        orderBy: [{ executedAt: "asc" }, { id: "asc" }],
      });

      const openingByAccountInstrument = await buildOpeningByAccountInstrument(tx, executions);
      const groups = computeClosedTradeGroups(
        executions.map((exec) => ({
          id: exec.id,
          accountId: exec.accountId,
          accountCode: exec.account.ibkrAccount,
          instrumentId: exec.instrumentId,
          symbol: exec.instrument.symbol,
          exchange: exec.instrument.exchange,
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
      groupCount = groups.length;

      const existingGroups = await tx.closedTrade.findMany({
        where: scoped ? { accountId: { in: accountIds } } : undefined,
        select: { groupKey: true },
      });
      const refreshPlan = planClosedTradeRefresh(
        existingGroups.map((group) => group.groupKey),
        groups.map((group) => group.groupKey),
      );

      if (refreshPlan.staleGroupKeys.length > 0) {
        for (const chunk of chunked(refreshPlan.staleGroupKeys, 500)) {
          await tx.closedTrade.updateMany({
            where: { groupKey: { in: chunk } },
            data: {
              isStale: true,
              staleAt: new Date(),
              staleReason: "This trade was not present in the latest materialized closed-trade refresh.",
            },
          });
        }
      }

      await upsertMaterializedClosedTradeGroups(tx, groups);

      const executionRows = groups.flatMap((group) =>
        group.executions.map((execution, sortOrder) => ({
          closedTradeGroupKey: group.groupKey,
          executionId: execution.id,
          sortOrder,
          executedAt: new Date(execution.executedAt),
          side: execution.side,
          quantity: execution.quantity,
          price: execution.price,
          commission: execution.commission,
          fees: execution.fees,
        })),
      );

      for (const chunk of chunked(refreshPlan.executionGroupKeysToReplace, 500)) {
        await tx.closedTradeExecution.deleteMany({
          where: { closedTradeGroupKey: { in: chunk } },
        });
      }

      for (const chunk of chunked(executionRows, 500)) {
        await tx.closedTradeExecution.createMany({ data: chunk, skipDuplicates: true });
      }

      if (sourceSnapshot) {
        await writeMaterializationWatermark(tx, MATERIALIZATION_WATERMARK_KEYS.closedTrades, sourceSnapshot);
      }
    },
    { timeout: 60_000 },
  );

  return { groups: groupCount };
}

export async function ensureMaterializedClosedTrades() {
  const sourceSnapshot = await getClosedTradesSourceSnapshot(prisma);

  if (sourceSnapshot.executionCount === 0) return false;
  if (await isMaterializationWatermarkFresh(prisma, MATERIALIZATION_WATERMARK_KEYS.closedTrades, sourceSnapshot)) {
    return false;
  }

  await refreshMaterializedClosedTrades();
  return true;
}
