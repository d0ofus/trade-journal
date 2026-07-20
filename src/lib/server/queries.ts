import type { Prisma } from "@prisma/client";
import { withDiagnostics } from "@/lib/server/diagnostics";
import { prisma } from "@/lib/prisma";
import { ensureMaterializedClosedTrades } from "@/lib/server/closed-trades-materialized";
import { buildClosedTradeWhere, normalizeTradeTagName, type TradeFilters } from "@/lib/server/closed-trade-filters";
import { ensureMaterializedExecutionAnalytics } from "@/lib/server/execution-analytics-materialized";
import { getImportHistoryPage } from "@/lib/server/import-history-query";
import {
  buildBackupReadinessManifest,
  buildImportArtifactBackupManifest,
  buildJournalScreenshotBackupAssets,
  inspectInlineDataUrl,
} from "@/lib/server/backup-assets";
import { BACKUP_RELEVANT_TIMESTAMP_SOURCES, buildBackupSourceMetadata } from "@/lib/server/backup-freshness";
import { buildBackupTableManifestFromRowCounts, type BackupTableKey } from "@/lib/server/backup-contract";
import { aggregateCalendarPerformance } from "@/lib/stats/calendar-performance";
import { aggregateDashboardData } from "@/lib/stats/dashboard-aggregation";
import { computeTradeSummaryMetrics, latestPriorEquitySnapshot } from "@/lib/stats/trade-summary-metrics";
import {
  utcDateBoundary,
  utcMonthRange,
  utcYearRange,
} from "@/lib/server/utc-date-range";

function analyticsOrZero(
  executionId: string,
  analytics?: {
    executionId: string;
    realizedPnl: number;
    grossRealizedPnl: number;
    cumulativePnl: number;
    matchedQuantity: number;
    avgHoldTimeMs: number;
  } | null,
) {
  return (
    analytics ?? {
      executionId,
      realizedPnl: 0,
      grossRealizedPnl: 0,
      cumulativePnl: 0,
      matchedQuantity: 0,
      avgHoldTimeMs: 0,
    }
  );
}

export async function getDashboardData(filters?: { from?: string; to?: string }) {
  return withDiagnostics("getDashboardData", async (step) => {
    await step("ensure materialized execution analytics", () => ensureMaterializedExecutionAnalytics());
    await step("ensure materialized closed trades", () => ensureMaterializedClosedTrades());

    const dashboardTo = filters?.to ? utcDateBoundary(filters.to, "end") : undefined;
    const rangeStart = filters?.from ? utcDateBoundary(filters.from, "start") : undefined;
    const rangeEnd = filters?.to ? utcDateBoundary(filters.to, "end") : undefined;
    const executions = await step("query executions", () =>
      prisma.execution.findMany({
        where: {
          executedAt: dashboardTo ? { lte: dashboardTo } : undefined,
        },
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
          analytics: {
            select: {
              executionId: true,
              realizedPnl: true,
              grossRealizedPnl: true,
              cumulativePnl: true,
              matchedQuantity: true,
              avgHoldTimeMs: true,
            },
          },
        },
        orderBy: { executedAt: "asc" },
      }),
    );

    const closedTrades = await step("query closed trades", () =>
      prisma.closedTrade.findMany({
        where: {
          isStale: false,
          tradeDate: dashboardTo ? { lte: dashboardTo } : undefined,
        },
        select: {
          groupKey: true,
          openTime: true,
          closeTime: true,
          tradeDate: true,
          realizedPnl: true,
          grossRealizedPnl: true,
          totalCommission: true,
          totalQuantity: true,
        },
        orderBy: [{ closeTime: "asc" }, { groupKey: "asc" }],
      }),
    );

    return step("aggregate dashboard", () =>
      aggregateDashboardData({
        closedTrades,
        executions,
        rangeEnd,
        rangeStart,
      }),
    );
  });
}

function latestDate(...values: Array<Date | null | undefined>) {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .map((value) => value.getTime());
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

type TimestampDelegate = {
  findFirst(input: {
    orderBy: Record<string, "desc">;
    select: Record<string, true>;
  }): Promise<Record<string, Date | null> | null>;
};
type BackupFreshnessClient = typeof prisma | Prisma.TransactionClient;

function prismaDelegateName(prismaModel: string) {
  return `${prismaModel.charAt(0).toLowerCase()}${prismaModel.slice(1)}`;
}

async function latestTimestampForModelField(client: BackupFreshnessClient, prismaModel: string, field: string) {
  const delegateName = prismaDelegateName(prismaModel);
  const delegate = (client as unknown as Record<string, TimestampDelegate | undefined>)[delegateName];
  if (!delegate) {
    throw new Error(`Backup freshness source is configured for unknown Prisma model ${prismaModel}.`);
  }

  const row = await delegate.findFirst({
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });
  const value = row?.[field];
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

async function getDatabaseSizeBytes() {
  try {
    const rows = await prisma.$queryRaw<Array<{ bytes: bigint | number | string | null }>>`
      SELECT pg_database_size(current_database())::bigint AS bytes
    `;
    const raw = rows[0]?.bytes;
    if (typeof raw === "bigint") return Number(raw);
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getLatestBackupRelevantUpdateAt(client: BackupFreshnessClient = prisma) {
  const latestTimestamps = await Promise.all(
    BACKUP_RELEVANT_TIMESTAMP_SOURCES.flatMap((source) =>
      source.timestampFields.map((field) => latestTimestampForModelField(client, source.prismaModel, field)),
    ),
  );

  return latestDate(...latestTimestamps);
}

async function getLatestStaleClosedTradeAt() {
  const row = await prisma.closedTrade.findFirst({
    where: { staleAt: { not: null } },
    orderBy: { staleAt: "desc" },
    select: { staleAt: true },
  });
  return row?.staleAt ?? null;
}

export async function getTrades(filters: {
  from?: string;
  to?: string;
  symbol?: string;
  account?: string;
  side?: string;
  tag?: string;
  strategy?: string;
  page?: number;
  pageSize?: number;
}) {
  return withDiagnostics("getTrades", async (step) => {
    await step("ensure materialized execution analytics", () => ensureMaterializedExecutionAnalytics());

    const where: Record<string, unknown> = {};
    const pageSize = Math.max(1, Math.min(200, Math.floor(filters.pageSize ?? 50)));
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const skip = (page - 1) * pageSize;

    if (filters.from || filters.to) {
      where.executedAt = {
        gte: filters.from ? utcDateBoundary(filters.from, "start") : undefined,
        lte: filters.to ? utcDateBoundary(filters.to, "end") : undefined,
      };
    }

    if (filters.symbol) {
      where.instrument = { symbol: { equals: filters.symbol } };
    }

    const account = filters.account?.trim();
    if (account) {
      where.account = { ibkrAccount: { equals: account } };
    }

    if (filters.side) {
      where.side = filters.side;
    }

    const tag = normalizeTradeTagName(filters.tag);
    if (tag) {
      where.tags = { some: { tag: { name: { equals: tag } } } };
    }

    if (filters.strategy) {
      where.strategy = { equals: filters.strategy };
    }

    const [executions, total] = await Promise.all([
      step("query page", () =>
        prisma.execution.findMany({
          where,
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
            account: {
              select: {
                ibkrAccount: true,
              },
            },
            instrument: {
              select: {
                symbol: true,
              },
            },
            analytics: {
              select: {
                executionId: true,
                realizedPnl: true,
              },
            },
          },
          orderBy: { executedAt: "desc" },
          skip,
          take: pageSize,
        }),
      ),
      step("count page", () => prisma.execution.count({ where })),
    ]);

    const rows = executions.map((exec) => ({
      ...exec,
      realizedPnl: exec.analytics?.realizedPnl ?? 0,
      commissionTotal: exec.commission + exec.fees,
    }));

    return {
      rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });
}

export async function getClosedTrades(filters: TradeFilters, selectedGroupKey?: string | null) {
  return withDiagnostics("getClosedTrades", async (step) => {
    await step("ensure materialized closed trades", () => ensureMaterializedClosedTrades());

    const filteredWhere = buildClosedTradeWhere(filters);
    const where = selectedGroupKey
      ? { OR: [{ groupKey: selectedGroupKey }, filteredWhere] }
      : filteredWhere;

    const groups = await step("query materialized groups", () =>
      prisma.closedTrade.findMany({
        where,
        select: {
          groupKey: true,
          accountId: true,
          symbol: true,
          direction: true,
          openTime: true,
          closeTime: true,
          tradeDate: true,
          totalQuantity: true,
          avgEntryPrice: true,
          avgExitPrice: true,
          grossRealizedPnl: true,
          openingQuantity: true,
          closingQuantity: true,
          realizedPnl: true,
          totalCommission: true,
          isStale: true,
          staleAt: true,
          staleReason: true,
          account: {
            select: {
              ibkrAccount: true,
            },
          },
          executions: {
            select: {
              executionId: true,
              executedAt: true,
              side: true,
              quantity: true,
              price: true,
              commission: true,
              fees: true,
            },
            orderBy: { sortOrder: "asc" },
          },
          tags: {
            select: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: { tag: { name: "asc" } },
          },
        },
        orderBy: [{ isStale: "asc" }, { closeTime: "desc" }, { groupKey: "asc" }],
      }),
    );

    const groupKeys = groups.map((group) => group.groupKey);
    const dayNotePairs = new Map<string, { accountId: string; date: Date }>();
    for (const group of groups) {
      const tradeDate = group.tradeDate.toISOString().slice(0, 10);
      const key = `${group.accountId}:${tradeDate}`;
      if (!dayNotePairs.has(key)) {
        dayNotePairs.set(key, {
          accountId: group.accountId,
          date: new Date(`${tradeDate}T00:00:00.000Z`),
        });
      }
    }

    const uniqueDayNotePairs = [...dayNotePairs.values()];
    const dayNoteAccountIds = [...new Set(uniqueDayNotePairs.map((pair) => pair.accountId))];
    const dayNoteDates = [...new Set(uniqueDayNotePairs.map((pair) => pair.date.toISOString()))].map((iso) => new Date(iso));
    const groupAccountIds = [...new Set(groups.map((group) => group.accountId))];
    const latestTradeDate =
      groups.length > 0 ? new Date(Math.max(...groups.map((group) => group.tradeDate.getTime()))) : null;

    const [dayNotes, closedTradeNotes, journalLinks, dailySnapshots] = await Promise.all([
      dayNoteAccountIds.length > 0 && dayNoteDates.length > 0
        ? step("query day notes", () =>
            prisma.dayNote.findMany({
              where: {
                accountId: { in: dayNoteAccountIds },
                date: { in: dayNoteDates },
              },
              select: {
                accountId: true,
                date: true,
                content: true,
              },
            }),
          )
        : Promise.resolve([]),
      groupKeys.length > 0
        ? step("query closed trade notes", () =>
            prisma.closedTradeNote.findMany({
              where: { groupKey: { in: groupKeys } },
              select: {
                groupKey: true,
                content: true,
                setup: true,
                thesis: true,
                entryReview: true,
                exitReview: true,
                mistake: true,
                lesson: true,
                followUp: true,
                updatedAt: true,
              },
            }),
          )
        : Promise.resolve([]),
      groupKeys.length > 0
        ? step("query closed-trade journal links", () =>
            prisma.journalLink.findMany({
              where: {
                linkType: "REVIEW_SOURCE",
                targetType: "CLOSED_TRADE",
                targetId: { in: groupKeys },
              },
              select: { targetId: true, journalEntryId: true },
              orderBy: { createdAt: "asc" },
            }),
          )
        : Promise.resolve([]),
      groupAccountIds.length > 0 && latestTradeDate
        ? step("query prior equity snapshots", () =>
            prisma.dailySnapshot.findMany({
              where: {
                accountId: { in: groupAccountIds },
                date: { lt: latestTradeDate },
                equity: { not: null },
              },
              select: {
                accountId: true,
                date: true,
                equity: true,
              },
              orderBy: { date: "asc" },
            }),
          )
        : Promise.resolve([]),
    ]);

    const dayNoteMap = new Map(dayNotes.map((note) => [`${note.accountId}:${note.date.toISOString().slice(0, 10)}`, note.content]));
    const closedNoteMap = new Map(closedTradeNotes.map((note) => [note.groupKey, note]));
    const journalEntryIdByGroupKey = new Map<string, string>();
    for (const link of journalLinks) {
      if (link.targetId && !journalEntryIdByGroupKey.has(link.targetId)) {
        journalEntryIdByGroupKey.set(link.targetId, link.journalEntryId);
      }
    }

    return groups.map((group) => {
      const tradeDate = group.tradeDate.toISOString().slice(0, 10);
      const direction = group.direction as "LONG" | "SHORT";
      const executions = group.executions.map((execution) => ({
        id: execution.executionId,
        executedAt: execution.executedAt.toISOString(),
        side: execution.side,
        quantity: execution.quantity,
        price: execution.price,
        commission: execution.commission,
        fees: execution.fees,
      }));
      const equitySnapshot = latestPriorEquitySnapshot(dailySnapshots, group.accountId, group.tradeDate);
      const metrics = computeTradeSummaryMetrics({
        direction,
        avgEntryPrice: group.avgEntryPrice,
        avgExitPrice: group.avgExitPrice,
        realizedPnl: group.realizedPnl,
        executions,
        equityBaseline: equitySnapshot?.equity ?? null,
      });

      return {
        groupKey: group.groupKey,
        accountId: group.accountId,
        accountCode: group.account.ibkrAccount,
        symbol: group.symbol,
        direction,
        openTime: group.openTime.toISOString(),
        closeTime: group.closeTime.toISOString(),
        avgEntryPrice: group.avgEntryPrice,
        avgExitPrice: group.avgExitPrice,
        tradeDate,
        realizedPnl: group.realizedPnl,
        totalCommission: group.totalCommission,
        isStale: group.isStale,
        staleAt: group.staleAt?.toISOString() ?? null,
        staleReason: group.staleReason,
        openingQuantity: group.openingQuantity,
        closingQuantity: group.closingQuantity,
        ...metrics,
        executions,
        dayNote: dayNoteMap.get(`${group.accountId}:${tradeDate}`) ?? "",
        tradeNote: closedNoteMap.get(group.groupKey)?.content ?? "",
        reviewSetup: closedNoteMap.get(group.groupKey)?.setup ?? "",
        reviewThesis: closedNoteMap.get(group.groupKey)?.thesis ?? "",
        reviewEntry: closedNoteMap.get(group.groupKey)?.entryReview ?? "",
        reviewExit: closedNoteMap.get(group.groupKey)?.exitReview ?? "",
        reviewMistake: closedNoteMap.get(group.groupKey)?.mistake ?? "",
        reviewLesson: closedNoteMap.get(group.groupKey)?.lesson ?? "",
        reviewFollowUp: closedNoteMap.get(group.groupKey)?.followUp ?? "",
        reviewUpdatedAt: closedNoteMap.get(group.groupKey)?.updatedAt.toISOString() ?? null,
        closedTradeTags: group.tags.map((tag) => tag.tag.name),
        journalEntryId: journalEntryIdByGroupKey.get(group.groupKey) ?? null,
      };
    });
  });
}

export async function getTradeDetail(id: string) {
  return withDiagnostics("getTradeDetail", async (step) => {
    await step("ensure materialized execution analytics", () => ensureMaterializedExecutionAnalytics());

    const execution = await step("query execution", () =>
      prisma.execution.findUnique({
        where: { id },
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
          account: {
            select: {
              ibkrAccount: true,
            },
          },
          tags: {
            select: {
              tagId: true,
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
          tradeNote: {
            select: {
              content: true,
            },
          },
          analytics: {
            select: {
              executionId: true,
              realizedPnl: true,
              grossRealizedPnl: true,
              cumulativePnl: true,
              matchedQuantity: true,
              avgHoldTimeMs: true,
            },
          },
        },
      }),
    );

    if (!execution) return null;

    const accountExecutions = await step("query related executions", () =>
      prisma.execution.findMany({
        where: { accountId: execution.accountId, instrumentId: execution.instrumentId },
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
        },
        orderBy: { executedAt: "asc" },
      }),
    );

    return {
      execution,
      relatedExecutions: accountExecutions,
      pnl: analyticsOrZero(execution.id, execution.analytics),
    };
  });
}

export async function getPositions() {
  return prisma.position.findMany({
    where: {
      NOT: { quantity: 0 },
    },
    select: {
      id: true,
      accountId: true,
      quantity: true,
      avgCost: true,
      unrealizedPnl: true,
      account: {
        select: {
          ibkrAccount: true,
        },
      },
      instrument: {
        select: {
          symbol: true,
          symbolNotes: {
            select: {
              accountId: true,
              thesis: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCalendarNotes(month?: Date) {
  await ensureMaterializedClosedTrades();
  const target = month ?? new Date();
  const { from, to } = utcMonthRange(target);
  const [notes, closedTrades] = await Promise.all([
    prisma.dayNote.findMany({
      where: { date: { gte: from, lte: to } },
      include: { tags: { include: { tag: true } }, account: true },
      orderBy: { date: "asc" },
    }),
    prisma.closedTrade.findMany({
      where: {
        isStale: false,
        tradeDate: {
          gte: from,
          lte: to,
        },
      },
      select: {
        accountId: true,
        tradeDate: true,
        realizedPnl: true,
        account: {
          select: {
            ibkrAccount: true,
          },
        },
      },
      orderBy: { tradeDate: "asc" },
    }),
  ]);

  const dailyPnlByAccountDate = new Map<string, number>();
  const accountById = new Map(closedTrades.map((trade) => [trade.accountId, trade.account]));

  for (const trade of closedTrades) {
    const day = trade.tradeDate.toISOString().slice(0, 10);
    const key = `${trade.accountId}:${day}`;
    dailyPnlByAccountDate.set(key, (dailyPnlByAccountDate.get(key) ?? 0) + trade.realizedPnl);
  }

  const notesByAccountDate = new Map(notes.map((note) => [`${note.accountId}:${note.date.toISOString().slice(0, 10)}`, note]));
  const keys = new Set<string>([...dailyPnlByAccountDate.keys(), ...notesByAccountDate.keys()]);

  return [...keys]
    .map((key) => {
      const [accountId, date] = key.split(":");
      const note = notesByAccountDate.get(key);
      const account = note?.account ?? accountById.get(accountId);
      if (!account) return null;
      return {
        id: note?.id ?? key,
        account,
        date: note?.date ?? new Date(`${date}T00:00:00.000Z`),
        content: note?.content ?? "",
        tags: note?.tags ?? [],
        dailyPnl: dailyPnlByAccountDate.get(key) ?? 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (a.date.getTime() === b.date.getTime() ? a.account.ibkrAccount.localeCompare(b.account.ibkrAccount) : b.date.getTime() - a.date.getTime()));
}

export async function getCalendarPerformance(target?: Date) {
  return withDiagnostics("getCalendarPerformance", async (step) => {
    await step("ensure materialized closed trades", () => ensureMaterializedClosedTrades());

    const focus = target ?? new Date();
    const { from, snapshotFrom, to } = utcYearRange(focus);

    const [closedTrades, snapshots, notes] = await Promise.all([
      step("query closed trades", () =>
        prisma.closedTrade.findMany({
          where: {
            isStale: false,
            tradeDate: {
              gte: from,
              lte: to,
            },
          },
          select: {
            tradeDate: true,
            realizedPnl: true,
          },
          orderBy: { tradeDate: "asc" },
        }),
      ),
      step("query snapshots", () =>
        prisma.positionSnapshot.findMany({
          where: {
            date: {
              gte: snapshotFrom,
              lte: to,
            },
          },
          select: {
            accountId: true,
            instrumentId: true,
            date: true,
            unrealizedPnl: true,
          },
          orderBy: { date: "asc" },
        }),
      ),
      step("query notes", () =>
        prisma.dayNote.findMany({
          where: { date: { gte: from, lte: to } },
          select: {
            id: true,
            date: true,
            content: true,
            account: {
              select: {
                ibkrAccount: true,
              },
            },
            tags: {
              select: {
                tag: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { date: "asc" },
        }),
      ),
    ]);

    return step("aggregate calendar", () => aggregateCalendarPerformance({ closedTrades, from, notes, snapshots }));
  });
}

async function getBackupTableRowCounts(): Promise<Record<BackupTableKey, number>> {
  const [
    accounts,
    instruments,
    tags,
    importArtifacts,
    materializationWatermarks,
    backupAudits,
    importBatches,
    importRowErrors,
    executions,
    positions,
    positionSnapshots,
    dailySnapshots,
    executionAnalytics,
    executionTags,
    tradeNotes,
    dayNotes,
    dayNoteTags,
    symbolNotes,
    symbolNoteTags,
    closedTrades,
    closedTradeNotes,
    closedTradeLayouts,
    closedTradeAnnotationStates,
    closedTradeAnnotations,
    closedTradeTags,
    closedTradeExecutions,
    marketCandles,
    playbooks,
    playbookRules,
    journalEntries,
    journalNotionRelationTags,
    journalEntryTags,
    journalCharts,
    journalChartMarkers,
    journalContextSnapshots,
    journalLinks,
    journalEntryNotionRelations,
    journalRuleChecks,
    journalReviews,
    journalReviewActions,
    journalSavedViews,
    playbookExamples,
  ] = await Promise.all([
    prisma.account.count(),
    prisma.instrument.count(),
    prisma.tag.count(),
    prisma.importArtifact.count(),
    prisma.materializationWatermark.count(),
    prisma.backupAudit.count(),
    prisma.importBatch.count(),
    prisma.importRowError.count(),
    prisma.execution.count(),
    prisma.position.count(),
    prisma.positionSnapshot.count(),
    prisma.dailySnapshot.count(),
    prisma.executionAnalytics.count(),
    prisma.executionTag.count(),
    prisma.tradeNote.count(),
    prisma.dayNote.count(),
    prisma.dayNoteTag.count(),
    prisma.symbolNote.count(),
    prisma.symbolNoteTag.count(),
    prisma.closedTrade.count(),
    prisma.closedTradeNote.count(),
    prisma.closedTradeChartLayout.count(),
    prisma.closedTradeAnnotationState.count(),
    prisma.closedTradeAnnotation.count(),
    prisma.closedTradeTag.count(),
    prisma.closedTradeExecution.count(),
    prisma.marketCandle.count(),
    prisma.journalPlaybook.count(),
    prisma.journalPlaybookRule.count(),
    prisma.journalEntry.count(),
    prisma.journalNotionRelationTag.count(),
    prisma.journalEntryTag.count(),
    prisma.journalChart.count(),
    prisma.journalChartMarker.count(),
    prisma.journalContextSnapshot.count(),
    prisma.journalLink.count(),
    prisma.journalEntryNotionRelation.count(),
    prisma.journalEntryRuleCheck.count(),
    prisma.journalReview.count(),
    prisma.journalReviewAction.count(),
    prisma.journalSavedView.count(),
    prisma.journalPlaybookExample.count(),
  ]);

  return {
    accounts,
    instruments,
    tags,
    importArtifacts,
    materializationWatermarks,
    backupAudits,
    importBatches,
    importRowErrors,
    executions,
    positions,
    positionSnapshots,
    dailySnapshots,
    executionAnalytics,
    executionTags,
    tradeNotes,
    dayNotes,
    dayNoteTags,
    symbolNotes,
    symbolNoteTags,
    closedTrades,
    closedTradeNotes,
    closedTradeLayouts,
    closedTradeAnnotationStates,
    closedTradeAnnotations,
    closedTradeTags,
    closedTradeExecutions,
    marketCandles,
    playbooks,
    playbookRules,
    journalEntries,
    journalNotionRelationTags,
    journalEntryTags,
    journalCharts,
    journalChartMarkers,
    journalContextSnapshots,
    journalLinks,
    journalEntryNotionRelations,
    journalRuleChecks,
    journalReviews,
    journalReviewActions,
    journalSavedViews,
    playbookExamples,
  };
}

export async function getSettingsData(options: { includeBackupReadiness?: boolean; historyCursor?: string | null } = {}) {
  const [
    accounts,
    importHistory,
    executionCount,
    activeClosedTradeCount,
    staleClosedTradeCount,
    allClosedTradeCount,
    annotationCount,
    journalEntryCount,
    journalChartCount,
    marketCandleCount,
    failedImportBatchCount,
    materializationFailedImportBatchCount,
    skippedImportBatchCount,
    importRowErrorCount,
    screenshotRefs,
    rawImportBytes,
    rawArchivedBytes,
    importArtifactCount,
    missingRawArchiveCount,
    legacyRawArchiveCount,
    databaseSizeBytes,
    latestBackupRelevantUpdateAt,
    latestStaleClosedTradeAt,
    latestBackupAudit,
  ] = await Promise.all([
    prisma.account.findMany({ orderBy: { createdAt: "asc" } }),
    getImportHistoryPage({ cursor: options.historyCursor }),
    prisma.execution.count(),
    prisma.closedTrade.count({ where: { isStale: false } }),
    prisma.closedTrade.count({ where: { isStale: true } }),
    prisma.closedTrade.count(),
    prisma.closedTradeAnnotation.count(),
    prisma.journalEntry.count(),
    prisma.journalChart.count(),
    prisma.marketCandle.count(),
    prisma.importBatch.count({ where: { status: "FAILED" } }),
    prisma.importBatch.count({ where: { status: "MATERIALIZATION_FAILED" } }),
    prisma.importBatch.count({
      where: {
        rowsSkipped: { gt: 0 },
        status: { in: ["SUCCEEDED", "ROWS_APPLIED", "MATERIALIZED", "MATERIALIZATION_FAILED"] },
      },
    }),
    prisma.importRowError.count(),
    prisma.journalChart.findMany({
      where: {
        OR: [
          { screenshotUrl: { not: null } },
          { screenshotKey: { not: null } },
        ],
      },
      select: { id: true, journalEntryId: true, screenshotKey: true, screenshotUrl: true, mimeType: true },
    }),
    prisma.importBatch.aggregate({ _sum: { rawBytes: true } }),
    prisma.importArtifact.aggregate({ _sum: { rawBytes: true } }),
    prisma.importArtifact.count(),
    prisma.importBatch.count({
      where: {
        rawSha256: { not: null },
        rawStorageKey: null,
      },
    }),
    prisma.importBatch.count({ where: { rawSha256: null } }),
    getDatabaseSizeBytes(),
    getLatestBackupRelevantUpdateAt(),
    getLatestStaleClosedTradeAt(),
    prisma.backupAudit.findFirst({ orderBy: { verifiedAt: "desc" } }),
  ]);

  const inlineScreenshotRefs = screenshotRefs.filter((chart) => chart.screenshotUrl?.startsWith("data:"));
  const inlineScreenshotInspections = inlineScreenshotRefs.map((chart) => inspectInlineDataUrl(chart.screenshotUrl ?? ""));

  const backupReadiness = options.includeBackupReadiness
    ? await (async () => {
        const [journalScreenshotAssets, importBatchesForBackup, importArtifactsForBackup, tableRowCounts] = await Promise.all([
          buildJournalScreenshotBackupAssets(screenshotRefs, { includeDataUrl: false }),
          prisma.importBatch.findMany({
            select: { id: true, filename: true, rawSha256: true, rawBytes: true, rawStorageKey: true },
            orderBy: { importedAt: "asc" },
          }),
          prisma.importArtifact.findMany({
            select: { storageKey: true, rawSha256: true, rawBytes: true, content: true },
            orderBy: { createdAt: "asc" },
          }),
          getBackupTableRowCounts(),
        ]);

        const tableManifest = buildBackupTableManifestFromRowCounts(tableRowCounts);
        const source = buildBackupSourceMetadata({
          latestDataChangeAt: latestBackupRelevantUpdateAt,
          rowCounts: tableManifest.rowCounts,
        });

        return buildBackupReadinessManifest({
          generatedAt: new Date().toISOString(),
          journalScreenshotAssets,
          importArtifactManifest: buildImportArtifactBackupManifest(importBatchesForBackup, importArtifactsForBackup),
          tableManifest,
          source,
        });
      })()
    : undefined;

  const backupSource = backupReadiness?.source;

  return {
    accounts,
    importHistory,
    backupReadiness,
    health: {
      executionCount,
      activeClosedTradeCount,
      staleClosedTradeCount,
      allClosedTradeCount,
      annotationCount,
      journalEntryCount,
      journalChartCount,
      marketCandleCount,
      failedImportBatchCount,
      materializationFailedImportBatchCount,
      skippedImportBatchCount,
      importRowErrorCount,
      inlineScreenshotCount: inlineScreenshotRefs.length,
      inlineScreenshotBytes: inlineScreenshotInspections.reduce((sum, parsed) => sum + (parsed?.bytes ?? 0), 0),
      invalidInlineScreenshotCount: inlineScreenshotInspections.filter((parsed) => !parsed).length,
      localScreenshotCount: screenshotRefs.filter((chart) => chart.screenshotKey?.startsWith("local:")).length,
      externalScreenshotCount: screenshotRefs.filter((chart) => {
        if (chart.screenshotUrl?.startsWith("data:")) return false;
        if (chart.screenshotKey?.startsWith("local:")) return false;
        return Boolean(chart.screenshotKey || chart.screenshotUrl);
      }).length,
      rawImportBytes: rawImportBytes._sum.rawBytes ?? 0,
      rawArchivedBytes: rawArchivedBytes._sum.rawBytes ?? 0,
      importArtifactCount,
      missingRawArchiveCount,
      legacyRawArchiveCount,
      databaseSizeBytes,
      latestBackupRelevantUpdateAt: latestBackupRelevantUpdateAt?.toISOString() ?? null,
      latestStaleClosedTradeAt: latestStaleClosedTradeAt?.toISOString() ?? null,
      backupSourceSignature: backupSource?.signature ?? null,
      backupSourceLatestDataChangeAt: backupSource?.latestDataChangeAt ?? null,
      latestBackupAudit: latestBackupAudit
        ? {
            id: latestBackupAudit.id,
            sha256: latestBackupAudit.sha256,
            exportedAt: latestBackupAudit.exportedAt.toISOString(),
            verifiedAt: latestBackupAudit.verifiedAt.toISOString(),
            payloadBytes: latestBackupAudit.payloadBytes,
            totalRows: latestBackupAudit.totalRows,
            tableCount: latestBackupAudit.tableCount,
            strippedFieldCount: latestBackupAudit.strippedFieldCount,
            warningCount: latestBackupAudit.warningCount,
            errorCount: latestBackupAudit.errorCount,
            sourceSignature: latestBackupAudit.sourceSignature,
            sourceLatestDataChangeAt: latestBackupAudit.sourceLatestDataChangeAt?.toISOString() ?? null,
          }
        : null,
    },
  };
}
