import { computeExecutionPnl } from "@/lib/stats/pnl";

describe("computeExecutionPnl", () => {
  it("matches FIFO long closes", () => {
    const pnl = computeExecutionPnl([
      {
        id: "1",
        accountId: "a1",
        instrumentId: "i1",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "BUY",
        quantity: 100,
        price: 100,
        commission: 1,
        fees: 0,
      },
      {
        id: "2",
        accountId: "a1",
        instrumentId: "i1",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:30:00.000Z"),
        side: "SELL",
        quantity: 100,
        price: 105,
        commission: 1,
        fees: 0,
      },
    ]);

    expect(pnl).toHaveLength(2);
    expect(pnl[0].realizedPnl).toBe(-1);
    expect(pnl[1].realizedPnl).toBe(499);
  });

  it("handles short and partial fills", () => {
    const pnl = computeExecutionPnl([
      {
        id: "1",
        accountId: "a1",
        instrumentId: "i2",
        symbol: "TSLA",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "SELL",
        quantity: 50,
        price: 200,
        commission: 1,
        fees: 0,
      },
      {
        id: "2",
        accountId: "a1",
        instrumentId: "i2",
        symbol: "TSLA",
        executedAt: new Date("2026-02-20T16:30:00.000Z"),
        side: "BUY",
        quantity: 20,
        price: 190,
        commission: 1,
        fees: 0,
      },
      {
        id: "3",
        accountId: "a1",
        instrumentId: "i2",
        symbol: "TSLA",
        executedAt: new Date("2026-02-20T17:30:00.000Z"),
        side: "BUY",
        quantity: 30,
        price: 210,
        commission: 1,
        fees: 0,
      },
    ]);

    expect(pnl[1].realizedPnl).toBe(199);
    expect(pnl[2].realizedPnl).toBe(-301);
  });
});
