import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  refreshMaterializedClosedTrades,
  upsertMaterializedClosedTradeGroups,
} from "@/lib/server/closed-trades-materialized";
import type { ClosedTradeGroup } from "@/lib/stats/closed-trades";

function closedTradeGroup(index: number): ClosedTradeGroup {
  const openTime = new Date(Date.UTC(2199, 0, 1, 10, index % 60));
  const closeTime = new Date(openTime.getTime() + 60_000);

  return {
    tradeId: `trade-${index}`,
    groupKey: `group-${index}`,
    instrumentKey: `instrument-key-${index}`,
    accountId: `account-${index}`,
    accountCode: `ACCOUNT-${index}`,
    instrumentId: `instrument-${index}`,
    symbol: `SYM${index}`,
    side: "LONG",
    openTime: openTime.toISOString(),
    closeTime: closeTime.toISOString(),
    totalQuantity: 1,
    avgEntryPrice: 10,
    avgExitPrice: 11,
    grossRealizedPnl: 1,
    tradeDate: openTime.toISOString().slice(0, 10),
    openingQuantity: 0,
    closingQuantity: 0,
    realizedPnl: 0.5,
    totalCommission: 0.5,
    executions: [],
  };
}

describe("closed-trade bulk upsert", () => {
  it("batches production-scale refreshes into bounded parameterized statements", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const tx = { $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
    const groups = Array.from({ length: 501 }, (_, index) => closedTradeGroup(index));

    await upsertMaterializedClosedTradeGroups(tx, groups);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const firstQuery = executeRaw.mock.calls[0][0] as Prisma.Sql;
    const secondQuery = executeRaw.mock.calls[1][0] as Prisma.Sql;
    expect(firstQuery.sql).toContain('INSERT INTO "ClosedTrade"');
    expect(firstQuery.sql).toContain('ON CONFLICT ("groupKey") DO UPDATE');
    expect(firstQuery.sql).not.toContain("group-0");
    expect(firstQuery.values).toContain("group-0");
    expect(firstQuery.values).toContain("group-499");
    expect(firstQuery.values).toHaveLength(500 * 18);
    expect(firstQuery.values.slice(0, 16)).toEqual([
      "group-0",
      "account-0",
      "instrument-0",
      "SYM0",
      "LONG",
      new Date("2199-01-01T10:00:00.000Z"),
      new Date("2199-01-01T10:01:00.000Z"),
      new Date("2199-01-01T00:00:00.000Z"),
      1,
      10,
      11,
      1,
      0,
      0,
      0.5,
      0.5,
    ]);
    expect(secondQuery.values).toHaveLength(18);
    expect(secondQuery.values).toContain("group-500");
  });
});

describe("closed-trade materialized refresh", () => {
  it("preserves chart layouts and annotations while updating a materialized trade", async () => {
    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const accountId = `closed-refresh-account-${marker}`;
    const instrumentId = `closed-refresh-instrument-${marker}`;
    const buyId = `closed-refresh-buy-${marker}`;

    try {
      await prisma.account.create({
        data: {
          id: accountId,
          name: `Closed refresh ${marker}`,
          ibkrAccount: `CLOSED-REFRESH-${marker}`,
          baseCurrency: "USD",
        },
      });
      await prisma.instrument.create({
        data: {
          id: instrumentId,
          symbol: `CR${marker.slice(-6)}`,
          exchange: "TEST",
          assetType: "STOCK",
          currency: "USD",
        },
      });
      await prisma.execution.createMany({
        data: [
          {
            id: buyId,
            dedupeKey: buyId,
            accountId,
            instrumentId,
            executedAt: new Date("2199-06-01T10:00:00.000Z"),
            side: "BUY",
            quantity: 2,
            price: 10,
            commission: 0.25,
            fees: 0,
            currency: "USD",
          },
          {
            id: `closed-refresh-sell-${marker}`,
            dedupeKey: `closed-refresh-sell-${marker}`,
            accountId,
            instrumentId,
            executedAt: new Date("2199-06-01T11:00:00.000Z"),
            side: "SELL",
            quantity: 2,
            price: 12,
            commission: 0.25,
            fees: 0,
            currency: "USD",
          },
        ],
      });

      await refreshMaterializedClosedTrades({ accountIds: [accountId] });
      const firstTrade = await prisma.closedTrade.findFirstOrThrow({ where: { accountId } });
      await prisma.closedTradeChartLayout.create({
        data: {
          id: `closed-refresh-layout-${marker}`,
          closedTradeGroupKey: firstTrade.groupKey,
          layoutMode: "one-plus-two",
          panelsJson: '[{"id":"panel-1","timeframe":"5m"}]',
          version: 4,
        },
      });
      await prisma.closedTradeAnnotation.create({
        data: {
          id: `closed-refresh-annotation-${marker}`,
          closedTradeGroupKey: firstTrade.groupKey,
          panelId: "panel-1",
          symbol: `CR${marker.slice(-6)}`,
          timeframe: "5m",
          scope: "TRADE",
          type: "entry",
          pointsJson: "[]",
          price: 10,
          text: "Preserve me",
          styleJson: "{}",
        },
      });

      await prisma.execution.update({
        where: { id: buyId },
        data: { commission: 0.75 },
      });
      await refreshMaterializedClosedTrades({ accountIds: [accountId] });

      const refreshedTrade = await prisma.closedTrade.findUniqueOrThrow({
        where: { groupKey: firstTrade.groupKey },
        include: { chartLayouts: true, annotations: true },
      });
      expect(refreshedTrade.totalCommission).toBeCloseTo(1);
      expect(refreshedTrade.chartLayouts).toEqual([
        expect.objectContaining({
          layoutMode: "one-plus-two",
          panelsJson: '[{"id":"panel-1","timeframe":"5m"}]',
          version: 4,
        }),
      ]);
      expect(refreshedTrade.annotations).toEqual([
        expect.objectContaining({
          panelId: "panel-1",
          text: "Preserve me",
          price: 10,
        }),
      ]);
    } finally {
      await prisma.account.deleteMany({ where: { id: accountId } });
      await prisma.instrument.deleteMany({ where: { id: instrumentId } });
    }
  }, 20_000);
});
