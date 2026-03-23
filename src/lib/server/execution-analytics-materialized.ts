import { prisma } from "@/lib/prisma";
import { computeExecutionPnl } from "@/lib/stats/pnl";

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

export async function refreshMaterializedExecutionAnalytics() {
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
      instrument: {
        select: {
          symbol: true,
        },
      },
    },
    orderBy: { executedAt: "asc" },
  });

  const analyticsRows = computeExecutionPnl(
    executions.map((exec) => ({
      id: exec.id,
      accountId: exec.accountId,
      instrumentId: exec.instrumentId,
      symbol: exec.instrument.symbol,
      executedAt: exec.executedAt,
      side: exec.side,
      quantity: exec.quantity,
      price: exec.price,
      commission: exec.commission,
      fees: exec.fees,
    })),
  );

  await prisma.$transaction(async (tx) => {
    await tx.executionAnalytics.deleteMany();

    for (const chunk of chunked(analyticsRows, 500)) {
      await tx.executionAnalytics.createMany({
        data: chunk.map((row) => ({
          executionId: row.executionId,
          realizedPnl: row.realizedPnl,
          grossRealizedPnl: row.grossRealizedPnl,
          cumulativePnl: row.cumulativePnl,
          matchedQuantity: row.matchedQuantity,
          avgHoldTimeMs: row.avgHoldTimeMs,
        })),
      });
    }
  });

  return { rows: analyticsRows.length };
}

export async function ensureMaterializedExecutionAnalytics() {
  const existing = await prisma.executionAnalytics.findFirst({ select: { executionId: true } });
  if (existing) return false;

  const firstExecution = await prisma.execution.findFirst({ select: { id: true } });
  if (!firstExecution) return false;

  await refreshMaterializedExecutionAnalytics();
  return true;
}
