import { prisma } from "@/lib/prisma";
import { computeClosedTradeGroups } from "@/lib/stats/closed-trades";

function normalizedInstrumentIdentity(input: {
  symbol: string;
  assetType?: string | null;
  currency?: string | null;
}) {
  return [input.symbol, input.assetType ?? "", input.currency ?? ""].join("|");
}

function accountInstrumentGroupKey(
  accountId: string,
  instrument: {
    symbol: string;
    assetType?: string | null;
    currency?: string | null;
  },
) {
  return `${accountId}:${normalizedInstrumentIdentity(instrument)}`;
}

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function buildOpeningByAccountInstrument() {
  const executions = await prisma.execution.findMany({
    select: {
      accountId: true,
      executedAt: true,
      currency: true,
      instrument: {
        select: {
          symbol: true,
          assetType: true,
          currency: true,
        },
      },
    },
    orderBy: { executedAt: "asc" },
  });

  const firstExecutionAt = executions[0]?.executedAt;
  if (!firstExecutionAt) return new Map<string, { quantity: number; avgCost: number }>();

  const candidateKeys = new Set(
    executions.map((exec) =>
      accountInstrumentGroupKey(exec.accountId, {
        symbol: exec.instrument.symbol,
        assetType: exec.instrument.assetType,
        currency: exec.currency ?? exec.instrument.currency,
      }),
    ),
  );

  const snapshots = await prisma.positionSnapshot.findMany({
    where: {
      accountId: { in: [...new Set(executions.map((exec) => exec.accountId))] },
      date: { lt: firstExecutionAt },
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

  const aggregatedSnapshots = new Map<string, { date: number; quantity: number; costValue: number }>();
  for (const snapshot of snapshots) {
    const key = accountInstrumentGroupKey(snapshot.accountId, {
      symbol: snapshot.instrument.symbol,
      assetType: snapshot.instrument.assetType,
      currency: snapshot.currency ?? snapshot.instrument.currency,
    });
    if (!candidateKeys.has(key)) continue;

    const snapshotDate = snapshot.date.getTime();
    const existing = aggregatedSnapshots.get(key);
    if (existing && existing.date !== snapshotDate) continue;

    const next = existing ?? { date: snapshotDate, quantity: 0, costValue: 0 };
    next.quantity += snapshot.quantity;
    next.costValue += snapshot.quantity * snapshot.avgCost;
    aggregatedSnapshots.set(key, next);
  }

  const openingByAccountInstrument = new Map<string, { quantity: number; avgCost: number }>();
  for (const [key, snapshot] of aggregatedSnapshots.entries()) {
    openingByAccountInstrument.set(key, {
      quantity: snapshot.quantity,
      avgCost: Math.abs(snapshot.quantity) > 0 ? snapshot.costValue / snapshot.quantity : 0,
    });
  }

  return openingByAccountInstrument;
}

export async function refreshMaterializedClosedTrades() {
  const executions = await prisma.execution.findMany({
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
    orderBy: { executedAt: "asc" },
  });

  const openingByAccountInstrument = await buildOpeningByAccountInstrument();
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

  await prisma.$transaction(async (tx) => {
    await tx.closedTrade.deleteMany();

    if (groups.length === 0) {
      return;
    }

    for (const chunk of chunked(groups, 200)) {
      await tx.closedTrade.createMany({
        data: chunk.map((group) => ({
          groupKey: group.groupKey,
          accountId: group.accountId,
          instrumentId: group.instrumentId,
          symbol: group.symbol,
          direction: group.side,
          openTime: new Date(group.openTime),
          closeTime: new Date(group.closeTime),
          tradeDate: new Date(`${group.tradeDate}T00:00:00.000Z`),
          totalQuantity: group.totalQuantity,
          avgEntryPrice: group.avgEntryPrice,
          avgExitPrice: group.avgExitPrice,
          grossRealizedPnl: group.grossRealizedPnl,
          openingQuantity: group.openingQuantity,
          closingQuantity: group.closingQuantity,
          realizedPnl: group.realizedPnl,
          totalCommission: group.totalCommission,
        })),
      });
    }

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

    for (const chunk of chunked(executionRows, 500)) {
      await tx.closedTradeExecution.createMany({ data: chunk });
    }
  });

  return { groups: groups.length };
}

export async function ensureMaterializedClosedTrades() {
  const existing = await prisma.closedTrade.findFirst({ select: { groupKey: true } });
  if (existing) return false;

  const firstExecution = await prisma.execution.findFirst({ select: { id: true } });
  if (!firstExecution) return false;

  await refreshMaterializedClosedTrades();
  return true;
}
