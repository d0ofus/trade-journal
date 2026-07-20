import { aggregateCalendarPerformance, type CalendarClosedTradeRow } from "@/lib/stats/calendar-performance";

function at(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

function trade(date: string, realizedPnl: number): CalendarClosedTradeRow {
  return {
    tradeDate: at(date),
    realizedPnl,
  };
}

describe("aggregateCalendarPerformance", () => {
  it("buckets realized P&L by closed-trade date rather than open/execution dates", () => {
    const result = aggregateCalendarPerformance({
      from: at("2026-01-01"),
      closedTrades: [trade("2026-01-03", 100)],
      snapshots: [],
      notes: [],
    });

    expect(result.days.map((day) => [day.date, day.realized])).toEqual([["2026-01-03", 100]]);
    expect(result.days.some((day) => day.date === "2026-01-02")).toBe(false);
    expect(result.monthlyTotals).toEqual([{ month: "2026-01", realized: 100, mtm: 0, total: 100 }]);
  });

  it("uses net closed-trade realized P&L and assigns month-boundary closes to the close month", () => {
    const result = aggregateCalendarPerformance({
      from: at("2026-01-01"),
      closedTrades: [trade("2026-02-01", 100)],
      snapshots: [],
      notes: [],
    });

    expect(result.days).toEqual([
      {
        date: "2026-02-01",
        realized: 100,
        mtm: 0,
        total: 100,
        notes: [],
      },
    ]);
    expect(result.monthlyTotals).toEqual([{ month: "2026-02", realized: 100, mtm: 0, total: 100 }]);
  });

  it("keeps partial closes on their own closed-trade dates", () => {
    const result = aggregateCalendarPerformance({
      from: at("2026-01-01"),
      closedTrades: [trade("2026-01-03", 40), trade("2026-01-05", -15)],
      snapshots: [],
      notes: [],
    });

    expect(result.days.map((day) => [day.date, day.realized, day.total])).toEqual([
      ["2026-01-03", 40, 40],
      ["2026-01-05", -15, -15],
    ]);
    expect(result.monthlyTotals).toEqual([{ month: "2026-01", realized: 25, mtm: 0, total: 25 }]);
  });

  it("preserves MTM unrealized deltas while realized P&L comes from closed trades", () => {
    const result = aggregateCalendarPerformance({
      from: at("2026-01-01"),
      closedTrades: [trade("2026-01-02", 125)],
      snapshots: [
        {
          accountId: "account-a",
          instrumentId: "instrument-a",
          date: at("2025-12-31"),
          unrealizedPnl: 50,
        },
        {
          accountId: "account-a",
          instrumentId: "instrument-a",
          date: at("2026-01-01"),
          unrealizedPnl: 80,
        },
        {
          accountId: "account-a",
          instrumentId: "instrument-a",
          date: at("2026-01-02"),
          unrealizedPnl: 70,
        },
      ],
      notes: [],
    });

    expect(result.days.map((day) => [day.date, day.realized, day.mtm, day.total])).toEqual([
      ["2026-01-01", 0, 30, 30],
      ["2026-01-02", 125, -10, 115],
    ]);
    expect(result.monthlyTotals).toEqual([{ month: "2026-01", realized: 125, mtm: 20, total: 145 }]);
  });

  it("keeps note-only days in the calendar output", () => {
    const result = aggregateCalendarPerformance({
      from: at("2026-01-01"),
      closedTrades: [],
      snapshots: [],
      notes: [
        {
          id: "note-1",
          date: at("2026-01-04"),
          content: "Reviewed setup quality.",
          account: { ibkrAccount: "DU123" },
          tags: [{ tag: { name: "review" } }],
        },
      ],
    });

    expect(result.days).toEqual([
      {
        date: "2026-01-04",
        realized: 0,
        mtm: 0,
        total: 0,
        notes: [{ id: "note-1", accountCode: "DU123", content: "Reviewed setup quality.", tags: ["review"] }],
      },
    ]);
    expect(result.monthlyTotals).toEqual([{ month: "2026-01", realized: 0, mtm: 0, total: 0 }]);
  });

  it.each(["UTC", "Australia/Sydney", "America/New_York"])(
    "reports the canonical UTC year and keeps January 1 data when the process timezone is %s",
    (timezone) => {
      const originalTimezone = process.env.TZ;
      process.env.TZ = timezone;

      try {
        const result = aggregateCalendarPerformance({
          from: at("2026-01-01"),
          closedTrades: [trade("2026-01-01", 25), trade("2026-12-31", 75)],
          snapshots: [],
          notes: [],
        });

        expect(result.year).toBe(2026);
        expect(result.days.map((day) => [day.date, day.realized])).toEqual([
          ["2026-01-01", 25],
          ["2026-12-31", 75],
        ]);
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
      }
    },
  );
});
