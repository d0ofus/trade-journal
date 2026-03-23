import { endOfDay, endOfMonth, endOfYear, format, startOfDay, startOfMonth, startOfWeek, startOfYear, subDays } from "date-fns";
import { withDiagnostics } from "@/lib/server/diagnostics";
import { prisma } from "@/lib/prisma";
import { ensureMaterializedClosedTrades } from "@/lib/server/closed-trades-materialized";
import { ensureMaterializedExecutionAnalytics } from "@/lib/server/execution-analytics-materialized";
import { bucketHistogram, buildMetrics } from "@/lib/stats/pnl";

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

    const dashboardTo = filters?.to ? endOfDay(new Date(filters.to)) : undefined;
    const rangeStart = filters?.from ? startOfDay(new Date(filters.from)) : undefined;
    const rangeEnd = filters?.to ? endOfDay(new Date(filters.to)) : undefined;
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

    const pnlRows = await step("load analytics", () =>
      executions.map((exec) => analyticsOrZero(exec.id, exec.analytics)),
    );

    return step("aggregate dashboard", () => {
      const executionById = new Map(executions.map((execution) => [execution.id, execution]));
      const filteredExecutions: typeof executions = [];
      const filteredPnlRows: typeof pnlRows = [];
      const daily = new Map<string, number>();
      const grossDailyMap = new Map<string, number>();
      const dailyTradeCountMap = new Map<string, number>();
      const dailyVolumeMap = new Map<string, number>();
      const returnValues: number[] = [];
      const scatter: Array<{ time: string; symbol: string; price: number; side: (typeof executions)[number]["side"] }> = [];

      let filteredCommissions = 0;
      let firstFilteredExecutionAt: Date | undefined;
      let realizedDay = 0;
      let realizedWeek = 0;
      let realizedMonth = 0;
      let winningHoldMsTotal = 0;
      let losingHoldMsTotal = 0;
      let winningRowsCount = 0;
      let losingRowsCount = 0;

      const anchorDate = rangeEnd ?? new Date();
      const dayStart = startOfDay(anchorDate);
      const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const monthStart = startOfMonth(anchorDate);

      for (let index = 0; index < executions.length; index += 1) {
        const exec = executions[index];
        const pnl = pnlRows[index];
        const executedAt = exec.executedAt;

        if (rangeStart && executedAt < rangeStart) continue;
        if (rangeEnd && executedAt > rangeEnd) continue;

        filteredExecutions.push(exec);
        filteredPnlRows.push(pnl);
        filteredCommissions += exec.commission + exec.fees;
        firstFilteredExecutionAt ??= executedAt;

        if (executedAt >= dayStart) realizedDay += pnl.realizedPnl;
        if (executedAt >= weekStart) realizedWeek += pnl.realizedPnl;
        if (executedAt >= monthStart) realizedMonth += pnl.realizedPnl;

        const dayKey = format(executedAt, "yyyy-MM-dd");
        daily.set(dayKey, (daily.get(dayKey) ?? 0) + pnl.realizedPnl);
        dailyTradeCountMap.set(dayKey, (dailyTradeCountMap.get(dayKey) ?? 0) + 1);
        dailyVolumeMap.set(dayKey, (dailyVolumeMap.get(dayKey) ?? 0) + Math.abs(exec.quantity));
        scatter.push({
          time: format(executedAt, "HH:mm"),
          symbol: exec.instrument.symbol,
          price: exec.price,
          side: exec.side,
        });

        if (pnl.matchedQuantity > 0) {
          returnValues.push(pnl.realizedPnl);
          grossDailyMap.set(dayKey, (grossDailyMap.get(dayKey) ?? 0) + pnl.grossRealizedPnl);

          if (pnl.realizedPnl > 0) {
            winningHoldMsTotal += pnl.avgHoldTimeMs;
            winningRowsCount += 1;
          } else if (pnl.realizedPnl < 0) {
            losingHoldMsTotal += pnl.avgHoldTimeMs;
            losingRowsCount += 1;
          }
        }
      }

      let equityBaseline = 0;
      if (firstFilteredExecutionAt) {
        for (const row of pnlRows) {
          const exec = executionById.get(row.executionId);
          if (!exec || exec.executedAt >= firstFilteredExecutionAt) break;
          equityBaseline = row.cumulativePnl;
        }
      }

      const dailyPnl = [...daily.entries()].map(([date, pnl]) => ({ date, pnl }));
      const grossDailyPnl = [...grossDailyMap.entries()]
        .map(([date, pnl]) => ({ date, pnl }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      let grossRunning = 0;
      const grossCumulativePnl = grossDailyPnl.map((row) => {
        grossRunning += row.pnl;
        return { date: row.date, pnl: grossRunning };
      });
      const dailyTradeCounts = [...dailyTradeCountMap.entries()]
        .map(([date, trades]) => ({ date, trades }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const volumeDays = [...dailyVolumeMap.values()];
      const avgDailyVolume =
        volumeDays.length > 0 ? volumeDays.reduce((sum, value) => sum + value, 0) / volumeDays.length : 0;
      const metrics = buildMetrics(filteredPnlRows, filteredCommissions);
      const closedRows = filteredPnlRows.filter((row) => row.matchedQuantity > 0);
      const largestGain = closedRows.length > 0 ? Math.max(...closedRows.map((row) => row.realizedPnl)) : 0;
      const largestLoss = closedRows.length > 0 ? Math.min(...closedRows.map((row) => row.realizedPnl)) : 0;
      const histogram = bucketHistogram(returnValues, 12);
      const equityCurve = filteredPnlRows.map((row) => {
        const exec = executionById.get(row.executionId)!;
        return {
          at: format(exec.executedAt, "yyyy-MM-dd HH:mm"),
          equity: row.cumulativePnl - equityBaseline,
        };
      });

      return {
        cards: {
          totalTrades: filteredExecutions.length,
          largestGain: returnValues.length > 0 ? largestGain : 0,
          largestLoss: returnValues.length > 0 ? largestLoss : 0,
          avgWinHoldMs: winningRowsCount > 0 ? winningHoldMsTotal / winningRowsCount : 0,
          avgLossHoldMs: losingRowsCount > 0 ? losingHoldMsTotal / losingRowsCount : 0,
          avgDailyVolume,
          realizedDay,
          realizedWeek,
          realizedMonth,
          ...metrics,
        },
        charts: {
          dailyPnl,
          grossDailyPnl,
          grossCumulativePnl,
          dailyTradeCounts,
          equityCurve,
          histogram,
          scatter,
        },
      };
    });
  });
}

export async function getTrades(filters: {
  from?: string;
  to?: string;
  symbol?: string;
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
        gte: filters.from ? startOfDay(new Date(filters.from)) : undefined,
        lte: filters.to ? endOfDay(new Date(filters.to)) : undefined,
      };
    }

    if (filters.symbol) {
      where.instrument = { symbol: { equals: filters.symbol } };
    }

    if (filters.side) {
      where.side = filters.side;
    }

    if (filters.tag) {
      where.tags = { some: { tag: { name: { equals: filters.tag } } } };
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

type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  tag?: string;
  strategy?: string;
};

function buildExecutionWhere(
  filters: TradeFilters,
  options?: {
    applyDateRange?: boolean;
    includeSide?: boolean;
  },
) {
  const applyDateRange = options?.applyDateRange ?? true;
  const includeSide = options?.includeSide ?? true;
  const where: Record<string, unknown> = {};
  if (applyDateRange && (filters.from || filters.to)) {
    where.executedAt = {
      gte: filters.from ? startOfDay(new Date(filters.from)) : undefined,
      lte: filters.to ? endOfDay(new Date(filters.to)) : undefined,
    };
  }
  if (filters.symbol) {
    where.instrument = { symbol: { equals: filters.symbol } };
  }
  if (includeSide && filters.side) {
    where.side = filters.side;
  }
  if (filters.tag) {
    where.tags = { some: { tag: { name: { equals: filters.tag } } } };
  }
  if (filters.strategy) {
    where.strategy = { equals: filters.strategy };
  }
  return where;
}

export async function getClosedTrades(filters: TradeFilters) {
  return withDiagnostics("getClosedTrades", async (step) => {
    await step("ensure materialized closed trades", () => ensureMaterializedClosedTrades());

    const where: Record<string, unknown> = {};
    if (filters.from || filters.to) {
      where.tradeDate = {
        gte: filters.from ? startOfDay(new Date(filters.from)) : undefined,
        lte: filters.to ? endOfDay(new Date(filters.to)) : undefined,
      };
    }
    if (filters.symbol) {
      where.symbol = { equals: filters.symbol };
    }

    const executionFilters: Record<string, unknown> = {};
    if (filters.side) {
      executionFilters.side = filters.side;
    }
    if (filters.tag) {
      executionFilters.execution = {
        ...(executionFilters.execution as Record<string, unknown> | undefined),
        tags: { some: { tag: { name: { equals: filters.tag } } } },
      };
    }
    if (filters.strategy) {
      executionFilters.execution = {
        ...(executionFilters.execution as Record<string, unknown> | undefined),
        strategy: { equals: filters.strategy },
      };
    }
    if (Object.keys(executionFilters).length > 0) {
      where.executions = { some: executionFilters };
    }

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
        },
        orderBy: [{ closeTime: "desc" }, { groupKey: "asc" }],
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

    const [dayNotes, closedTradeNotes] = await Promise.all([
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
              },
            }),
          )
        : Promise.resolve([]),
    ]);

    const dayNoteMap = new Map(dayNotes.map((note) => [`${note.accountId}:${note.date.toISOString().slice(0, 10)}`, note.content]));
    const closedNoteMap = new Map(closedTradeNotes.map((note) => [note.groupKey, note.content]));

    return groups.map((group) => ({
      groupKey: group.groupKey,
      accountId: group.accountId,
      accountCode: group.account.ibkrAccount,
      symbol: group.symbol,
      tradeDate: group.tradeDate.toISOString().slice(0, 10),
      realizedPnl: group.realizedPnl,
      totalCommission: group.totalCommission,
      openingQuantity: group.openingQuantity,
      closingQuantity: group.closingQuantity,
      executions: group.executions.map((execution) => ({
        id: execution.executionId,
        executedAt: execution.executedAt.toISOString(),
        side: execution.side,
        quantity: execution.quantity,
        price: execution.price,
        commission: execution.commission,
        fees: execution.fees,
      })),
      dayNote: dayNoteMap.get(`${group.accountId}:${group.tradeDate.toISOString().slice(0, 10)}`) ?? "",
      tradeNote: closedNoteMap.get(group.groupKey) ?? "",
    }));
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
    where: { NOT: { quantity: 0 } },
    select: {
      id: true,
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
              thesis: true,
            },
            take: 1,
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCalendarNotes(month?: Date) {
  await ensureMaterializedExecutionAnalytics();
  const target = month ?? new Date();
  const from = startOfMonth(target);
  const to = endOfMonth(target);
  const [notes, executions] = await Promise.all([
    prisma.dayNote.findMany({
      where: { date: { gte: from, lte: to } },
      include: { tags: { include: { tag: true } }, account: true },
      orderBy: { date: "asc" },
    }),
    prisma.execution.findMany({
      where: { executedAt: { lte: to } },
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
      orderBy: { executedAt: "asc" },
    }),
  ]);

  const pnlByExecution = new Map(executions.map((execution) => [execution.id, execution.analytics?.realizedPnl ?? 0]));
  const dailyPnlByAccountDate = new Map<string, number>();
  const accountById = new Map(executions.map((execution) => [execution.accountId, execution.account]));

  for (const execution of executions) {
    if (execution.executedAt < from) continue;
    const day = execution.executedAt.toISOString().slice(0, 10);
    const key = `${execution.accountId}:${day}`;
    dailyPnlByAccountDate.set(key, (dailyPnlByAccountDate.get(key) ?? 0) + (pnlByExecution.get(execution.id) ?? 0));
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
    await step("ensure materialized execution analytics", () => ensureMaterializedExecutionAnalytics());

    const focus = target ?? new Date();
    const from = startOfYear(focus);
    const to = endOfYear(focus);

    const [executions, snapshots, notes] = await Promise.all([
      step("query executions", () =>
        prisma.execution.findMany({
          where: { executedAt: { lte: to } },
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
      ),
      step("query snapshots", () =>
        prisma.positionSnapshot.findMany({
          where: {
            date: {
              gte: subDays(from, 1),
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

    const pnlRows = await step("load analytics", () =>
      executions.map((exec) => analyticsOrZero(exec.id, exec.analytics)),
    );

    return step("aggregate calendar", () => {
      const executionById = new Map(executions.map((exec) => [exec.id, exec]));
      const realizedByDay = new Map<string, number>();

      for (const row of pnlRows) {
        const exec = executionById.get(row.executionId);
        if (!exec || exec.executedAt < from) continue;
        const day = exec.executedAt.toISOString().slice(0, 10);
        realizedByDay.set(day, (realizedByDay.get(day) ?? 0) + row.realizedPnl);
      }

      const mtmByDay = new Map<string, number>();
      const prevUnrealizedByKey = new Map<string, number>();

      for (const snapshot of snapshots) {
        const key = `${snapshot.accountId}:${snapshot.instrumentId}`;
        const currentUnrealized = snapshot.unrealizedPnl ?? 0;
        const prevUnrealized = prevUnrealizedByKey.get(key) ?? 0;
        if (snapshot.date >= from) {
          const day = snapshot.date.toISOString().slice(0, 10);
          const delta = currentUnrealized - prevUnrealized;
          mtmByDay.set(day, (mtmByDay.get(day) ?? 0) + delta);
        }
        prevUnrealizedByKey.set(key, currentUnrealized);
      }

      const notesByDay = new Map<string, typeof notes>();
      for (const note of notes) {
        const day = note.date.toISOString().slice(0, 10);
        const dayNotes = notesByDay.get(day) ?? [];
        dayNotes.push(note);
        notesByDay.set(day, dayNotes);
      }

      const dayKeys = new Set<string>([...realizedByDay.keys(), ...mtmByDay.keys(), ...notesByDay.keys()]);
      const monthlyTotals = new Map<string, { realized: number; mtm: number; total: number }>();

      const days = [...dayKeys]
        .map((date) => {
          const realized = realizedByDay.get(date) ?? 0;
          const mtm = mtmByDay.get(date) ?? 0;
          const total = realized + mtm;
          const month = date.slice(0, 7);
          const monthTotals = monthlyTotals.get(month) ?? { realized: 0, mtm: 0, total: 0 };
          monthTotals.realized += realized;
          monthTotals.mtm += mtm;
          monthTotals.total += total;
          monthlyTotals.set(month, monthTotals);
          return {
            date,
            realized,
            mtm,
            total,
            notes: (notesByDay.get(date) ?? []).map((note) => ({
              id: note.id,
              accountCode: note.account.ibkrAccount,
              content: note.content,
              tags: note.tags.map((tag) => tag.tag.name),
            })),
          };
        })
        .sort((a, b) => (a.date < b.date ? -1 : 1));

      return {
        year: from.getFullYear(),
        days,
        monthlyTotals: [...monthlyTotals.entries()]
          .map(([month, totals]) => ({ month, ...totals }))
          .sort((a, b) => (a.month < b.month ? -1 : 1)),
      };
    });
  });
}

export async function getSettingsData() {
  const [accounts, batches] = await Promise.all([
    prisma.account.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.importBatch.findMany({ orderBy: { importedAt: "desc" }, take: 20 }),
  ]);

  return { accounts, batches };
}
