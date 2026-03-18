import { endOfDay, endOfMonth, endOfYear, format, startOfDay, startOfMonth, startOfWeek, startOfYear, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { computeClosedTradeGroups } from "@/lib/stats/closed-trades";
import { bucketHistogram, buildMetrics, computeExecutionPnl } from "@/lib/stats/pnl";

export async function getDashboardData(filters?: { from?: string; to?: string }) {
  const dashboardTo = filters?.to ? endOfDay(new Date(filters.to)) : undefined;
  const executions = await prisma.execution.findMany({
    where: {
      executedAt: dashboardTo ? { lte: dashboardTo } : undefined,
    },
    include: { instrument: true },
    orderBy: { executedAt: "asc" },
  });

  const rangeStart = filters?.from ? startOfDay(new Date(filters.from)) : undefined;
  const rangeEnd = filters?.to ? endOfDay(new Date(filters.to)) : undefined;
  const inSelectedRange = (executedAt: Date) => {
    if (rangeStart && executedAt < rangeStart) return false;
    if (rangeEnd && executedAt > rangeEnd) return false;
    return true;
  };

  const execRows = executions.map((exec) => ({
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
  }));

  const pnlRows = computeExecutionPnl(execRows);
  const pnlByExecution = new Map(pnlRows.map((row) => [row.executionId, row]));
  const executionById = new Map(executions.map((execution) => [execution.id, execution]));
  const filteredExecutions = executions.filter((execution) => inSelectedRange(execution.executedAt));
  const filteredExecutionIds = new Set(filteredExecutions.map((execution) => execution.id));

  const anchorDate = rangeEnd ?? new Date();
  const dayStart = startOfDay(anchorDate);
  const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const monthStart = startOfMonth(anchorDate);

  const realizedDay = filteredExecutions
    .filter((exec) => exec.executedAt >= dayStart)
    .reduce((sum, exec) => sum + (pnlByExecution.get(exec.id)?.realizedPnl ?? 0), 0);
  const realizedWeek = filteredExecutions
    .filter((exec) => exec.executedAt >= weekStart)
    .reduce((sum, exec) => sum + (pnlByExecution.get(exec.id)?.realizedPnl ?? 0), 0);
  const realizedMonth = filteredExecutions
    .filter((exec) => exec.executedAt >= monthStart)
    .reduce((sum, exec) => sum + (pnlByExecution.get(exec.id)?.realizedPnl ?? 0), 0);

  const filteredPnlRows = pnlRows.filter((row) => filteredExecutionIds.has(row.executionId));
  const filteredCommissions = filteredExecutions.reduce((sum, exec) => sum + exec.commission + exec.fees, 0);
  const metrics = buildMetrics(filteredPnlRows, filteredCommissions);

  const daily = new Map<string, number>();
  filteredExecutions.forEach((exec) => {
    const key = format(exec.executedAt, "yyyy-MM-dd");
    daily.set(key, (daily.get(key) ?? 0) + (pnlByExecution.get(exec.id)?.realizedPnl ?? 0));
  });

  const dailyPnl = [...daily.entries()].map(([date, pnl]) => ({ date, pnl }));

  let equityBaseline = 0;
  if (filteredExecutions.length > 0) {
    const firstExecutionAt = filteredExecutions[0].executedAt;
    for (const row of pnlRows) {
      const exec = executionById.get(row.executionId);
      if (!exec || exec.executedAt >= firstExecutionAt) break;
      equityBaseline = row.cumulativePnl;
    }
  }

  const equityCurve = filteredPnlRows.map((row) => {
    const exec = executionById.get(row.executionId)!;
    return {
      at: format(exec.executedAt, "yyyy-MM-dd HH:mm"),
      equity: row.cumulativePnl - equityBaseline,
    };
  });

  const returnValues = filteredPnlRows.filter((row) => row.matchedQuantity > 0).map((row) => row.realizedPnl);
  const histogram = bucketHistogram(returnValues, 12);
  const closedRows = filteredPnlRows.filter((row) => row.matchedQuantity > 0);
  const largestGain = closedRows.length > 0 ? Math.max(...closedRows.map((row) => row.realizedPnl)) : 0;
  const largestLoss = closedRows.length > 0 ? Math.min(...closedRows.map((row) => row.realizedPnl)) : 0;
  const winningRows = closedRows.filter((row) => row.realizedPnl > 0);
  const losingRows = closedRows.filter((row) => row.realizedPnl < 0);
  const avgWinHoldMs =
    winningRows.length > 0 ? winningRows.reduce((sum, row) => sum + row.avgHoldTimeMs, 0) / winningRows.length : 0;
  const avgLossHoldMs =
    losingRows.length > 0 ? losingRows.reduce((sum, row) => sum + row.avgHoldTimeMs, 0) / losingRows.length : 0;

  const grossDailyMap = new Map<string, number>();
  const dailyTradeCountMap = new Map<string, number>();
  const dailyVolumeMap = new Map<string, number>();

  filteredExecutions.forEach((exec) => {
    const key = format(exec.executedAt, "yyyy-MM-dd");
    const pnl = pnlByExecution.get(exec.id);
    if (pnl?.matchedQuantity && pnl.matchedQuantity > 0) {
      grossDailyMap.set(key, (grossDailyMap.get(key) ?? 0) + pnl.grossRealizedPnl);
    }
    dailyTradeCountMap.set(key, (dailyTradeCountMap.get(key) ?? 0) + 1);
    dailyVolumeMap.set(key, (dailyVolumeMap.get(key) ?? 0) + Math.abs(exec.quantity));
  });

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
  const avgDailyVolume = volumeDays.length > 0 ? volumeDays.reduce((sum, value) => sum + value, 0) / volumeDays.length : 0;

  const scatter = filteredExecutions.map((exec) => ({
    time: format(exec.executedAt, "HH:mm"),
    symbol: exec.instrument.symbol,
    price: exec.price,
    side: exec.side,
  }));

  return {
    cards: {
      totalTrades: executions.length,
      largestGain,
      largestLoss,
      avgWinHoldMs,
      avgLossHoldMs,
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
    prisma.execution.findMany({
      where,
      include: {
        instrument: true,
        account: true,
        tags: { include: { tag: true } },
        tradeNote: true,
      },
      orderBy: { executedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.execution.count({ where }),
  ]);

  const pnlRows = computeExecutionPnl(
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
  const pnlMap = new Map(pnlRows.map((row) => [row.executionId, row]));

  const rows = executions.map((exec) => ({
    ...exec,
    realizedPnl: pnlMap.get(exec.id)?.realizedPnl ?? 0,
    commissionTotal: exec.commission + exec.fees,
  }));

  return {
    rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  side?: string;
  tag?: string;
  strategy?: string;
};

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
  const rangeStart = filters.from ? startOfDay(new Date(filters.from)) : undefined;
  const rangeEnd = filters.to ? endOfDay(new Date(filters.to)) : undefined;
  const where = buildExecutionWhere(filters, { applyDateRange: false, includeSide: false });
  if (rangeEnd) {
    where.executedAt = { lte: rangeEnd };
  }

  const executions = await prisma.execution.findMany({
    where,
    include: {
      instrument: true,
      account: true,
    },
    orderBy: { executedAt: "asc" },
  });

  const executionsInRange = rangeStart ? executions.filter((exec) => exec.executedAt >= rangeStart) : executions;
  const openingByAccountInstrument = new Map<string, { quantity: number; avgCost: number }>();
  const firstExecutionAt = executionsInRange[0]?.executedAt;
  const baselineDate = rangeStart ?? (firstExecutionAt ? startOfDay(firstExecutionAt) : undefined);

  if (baselineDate && executionsInRange.length > 0) {
    const candidateKeys = new Set(
      executionsInRange.map((exec) =>
        accountInstrumentGroupKey(exec.accountId, {
          symbol: exec.instrument.symbol,
          assetType: exec.instrument.assetType,
          currency: exec.currency ?? exec.instrument.currency,
        }),
      ),
    );
    const snapshots = await prisma.positionSnapshot.findMany({
      where: {
        accountId: { in: [...new Set(executionsInRange.map((exec) => exec.accountId))] },
        date: { lt: baselineDate },
        instrument: {
          symbol: { in: [...new Set(executionsInRange.map((exec) => exec.instrument.symbol))] },
        },
      },
      include: { instrument: true },
      orderBy: { date: "desc" },
    });

    const aggregatedSnapshots = new Map<string, { date: number; quantity: number; costValue: number }>();
    for (const snapshot of snapshots) {
      const key = accountInstrumentGroupKey(snapshot.accountId, {
        symbol: snapshot.instrument.symbol,
        assetType: snapshot.instrument.assetType,
        currency: snapshot.currency ?? snapshot.instrument.currency,
      });
      if (!candidateKeys.has(key)) {
        continue;
      }
      const snapshotDate = snapshot.date.getTime();
      const existing = aggregatedSnapshots.get(key);
      if (existing && existing.date !== snapshotDate) {
        continue;
      }
      const next = existing ?? { date: snapshotDate, quantity: 0, costValue: 0 };
      next.quantity += snapshot.quantity;
      next.costValue += snapshot.quantity * snapshot.avgCost;
      aggregatedSnapshots.set(key, next);
    }

    for (const [key, snapshot] of aggregatedSnapshots.entries()) {
      openingByAccountInstrument.set(key, {
        quantity: snapshot.quantity,
        avgCost: Math.abs(snapshot.quantity) > 0 ? snapshot.costValue / snapshot.quantity : 0,
      });
    }
  }

  const filteredGroups = computeClosedTradeGroups(
    executionsInRange.map((exec) => ({
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
  ).filter((group) => {
    const tradeDate = new Date(`${group.tradeDate}T00:00:00.000Z`);
    if (filters.from && tradeDate < startOfDay(new Date(filters.from))) {
      return false;
    }
    if (filters.to && tradeDate > endOfDay(new Date(filters.to))) {
      return false;
    }
    return true;
  });

  const groups = filters.side
    ? filteredGroups.filter((group) => group.executions.some((execution) => execution.side === filters.side))
    : filteredGroups;

  const groupKeys = groups.map((group) => group.groupKey);
  const dayNotePairs = new Map<string, { accountId: string; date: Date }>();
  for (const group of groups) {
    const key = `${group.accountId}:${group.tradeDate}`;
    if (!dayNotePairs.has(key)) {
      dayNotePairs.set(key, {
        accountId: group.accountId,
        date: new Date(`${group.tradeDate}T00:00:00.000Z`),
      });
    }
  }

  const uniqueDayNotePairs = [...dayNotePairs.values()];
  const dayNoteAccountIds = [...new Set(uniqueDayNotePairs.map((pair) => pair.accountId))];
  const dayNoteDates = [...new Set(uniqueDayNotePairs.map((pair) => pair.date.toISOString()))].map((iso) => new Date(iso));

  const dayNotes =
    dayNoteAccountIds.length > 0 && dayNoteDates.length > 0
      ? await prisma.dayNote.findMany({
          where: {
            accountId: { in: dayNoteAccountIds },
            date: { in: dayNoteDates },
          },
        })
      : [];

  const closedTradeNotes =
    groupKeys.length > 0
      ? await prisma.closedTradeNote.findMany({
          where: { groupKey: { in: groupKeys } },
        })
      : [];

  const dayNoteMap = new Map(
    dayNotes
      .filter((note): note is NonNullable<typeof note> => note !== null)
      .map((note) => [`${note.accountId}:${note.date.toISOString().slice(0, 10)}`, note.content]),
  );
  const closedNoteMap = new Map(closedTradeNotes.map((note) => [note.groupKey, note.content]));

  return groups.map((group) => ({
    ...group,
    dayNote: dayNoteMap.get(`${group.accountId}:${group.tradeDate}`) ?? "",
    tradeNote: closedNoteMap.get(group.groupKey) ?? "",
  }));
}

export async function getTradeDetail(id: string) {
  const execution = await prisma.execution.findUnique({
    where: { id },
    include: {
      instrument: true,
      account: true,
      tags: { include: { tag: true } },
      tradeNote: true,
    },
  });

  if (!execution) return null;

  const accountExecutions = await prisma.execution.findMany({
    where: { accountId: execution.accountId, instrumentId: execution.instrumentId },
    include: { instrument: true },
    orderBy: { executedAt: "asc" },
  });

  const pnlRows = computeExecutionPnl(
    accountExecutions.map((exec) => ({
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

  return {
    execution,
    relatedExecutions: accountExecutions,
    pnl: pnlRows.find((row) => row.executionId === id),
  };
}

export async function getPositions() {
  return prisma.position.findMany({
    where: { NOT: { quantity: 0 } },
    include: {
      account: true,
      instrument: {
        include: {
          symbolNotes: {
            include: { tags: { include: { tag: true } } },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getCalendarNotes(month?: Date) {
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
      include: { account: true, instrument: true },
      orderBy: { executedAt: "asc" },
    }),
  ]);

  const pnlRows = computeExecutionPnl(
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
  const pnlByExecution = new Map(pnlRows.map((row) => [row.executionId, row.realizedPnl]));
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
  const focus = target ?? new Date();
  const from = startOfYear(focus);
  const to = endOfYear(focus);

  const [executions, snapshots, notes] = await Promise.all([
    prisma.execution.findMany({
      where: { executedAt: { lte: to } },
      include: { account: true, instrument: true },
      orderBy: { executedAt: "asc" },
    }),
    prisma.positionSnapshot.findMany({
      where: {
        date: {
          gte: subDays(from, 1),
          lte: to,
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.dayNote.findMany({
      where: { date: { gte: from, lte: to } },
      include: { account: true, tags: { include: { tag: true } } },
      orderBy: { date: "asc" },
    }),
  ]);

  const pnlRows = computeExecutionPnl(
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
}

export async function getSettingsData() {
  const [accounts, batches] = await Promise.all([
    prisma.account.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.importBatch.findMany({ orderBy: { importedAt: "desc" }, take: 20 }),
  ]);

  return { accounts, batches };
}
