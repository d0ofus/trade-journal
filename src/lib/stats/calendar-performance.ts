export type CalendarClosedTradeRow = {
  tradeDate: Date;
  realizedPnl: number;
};

export type CalendarPositionSnapshotRow = {
  accountId: string;
  instrumentId: string;
  date: Date;
  unrealizedPnl: number | null;
};

export type CalendarDayNoteRow = {
  id: string;
  date: Date;
  content: string;
  account: {
    ibkrAccount: string;
  };
  tags: Array<{
    tag: {
      name: string;
    };
  }>;
};

export type CalendarPerformanceAggregation = {
  year: number;
  days: Array<{
    date: string;
    realized: number;
    mtm: number;
    total: number;
    notes: Array<{
      id: string;
      accountCode: string;
      content: string;
      tags: string[];
    }>;
  }>;
  monthlyTotals: Array<{
    month: string;
    realized: number;
    mtm: number;
    total: number;
  }>;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function compareDates(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function aggregateCalendarPerformance({
  closedTrades,
  from,
  notes,
  snapshots,
}: {
  closedTrades: CalendarClosedTradeRow[];
  from: Date;
  notes: CalendarDayNoteRow[];
  snapshots: CalendarPositionSnapshotRow[];
}): CalendarPerformanceAggregation {
  const fromKey = dateKey(from);
  const realizedByDay = new Map<string, number>();

  for (const trade of closedTrades) {
    const day = dateKey(trade.tradeDate);
    if (day < fromKey) continue;
    realizedByDay.set(day, (realizedByDay.get(day) ?? 0) + trade.realizedPnl);
  }

  const mtmByDay = new Map<string, number>();
  const prevUnrealizedByKey = new Map<string, number>();

  for (const snapshot of snapshots) {
    const key = `${snapshot.accountId}:${snapshot.instrumentId}`;
    const currentUnrealized = snapshot.unrealizedPnl ?? 0;
    const prevUnrealized = prevUnrealizedByKey.get(key) ?? 0;
    const day = dateKey(snapshot.date);

    if (day >= fromKey) {
      const delta = currentUnrealized - prevUnrealized;
      mtmByDay.set(day, (mtmByDay.get(day) ?? 0) + delta);
    }

    prevUnrealizedByKey.set(key, currentUnrealized);
  }

  const notesByDay = new Map<string, CalendarDayNoteRow[]>();
  for (const note of notes) {
    const day = dateKey(note.date);
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
    .sort((a, b) => compareDates(a.date, b.date));

  return {
    year: from.getFullYear(),
    days,
    monthlyTotals: [...monthlyTotals.entries()]
      .map(([month, totals]) => ({ month, ...totals }))
      .sort((a, b) => compareDates(a.month, b.month)),
  };
}
