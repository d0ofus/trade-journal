import { computeExecutionPnl } from "@/lib/stats/pnl";
import { openingPositionKey } from "@/lib/stats/opening-positions";

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

  it("keeps cumulative P&L chronological across overlapping symbols", () => {
    const pnl = computeExecutionPnl([
      {
        id: "spy-open",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 100,
        commission: 0,
        fees: 0,
      },
      {
        id: "tsla-open",
        accountId: "a1",
        instrumentId: "tsla",
        symbol: "TSLA",
        executedAt: new Date("2026-02-20T14:45:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 200,
        commission: 0,
        fees: 0,
      },
      {
        id: "tsla-close",
        accountId: "a1",
        instrumentId: "tsla",
        symbol: "TSLA",
        executedAt: new Date("2026-02-20T15:00:00.000Z"),
        side: "SELL",
        quantity: 10,
        price: 210,
        commission: 0,
        fees: 0,
      },
      {
        id: "spy-close",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:30:00.000Z"),
        side: "SELL",
        quantity: 10,
        price: 103,
        commission: 0,
        fees: 0,
      },
    ]);

    expect(pnl.map((row) => row.executionId)).toEqual(["spy-open", "tsla-open", "tsla-close", "spy-close"]);
    expect(pnl.map((row) => row.cumulativePnl)).toEqual([0, 0, 100, 130]);
  });

  it("keeps lots account-scoped while cumulative P&L remains chronological over the input ledger", () => {
    const pnl = computeExecutionPnl([
      {
        id: "a1-open",
        accountId: "a1",
        instrumentId: "spy-a",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 100,
        commission: 0,
        fees: 0,
      },
      {
        id: "a2-short-open",
        accountId: "a2",
        instrumentId: "spy-b",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T14:45:00.000Z"),
        side: "SELL",
        quantity: 10,
        price: 50,
        commission: 0,
        fees: 0,
      },
      {
        id: "a1-close",
        accountId: "a1",
        instrumentId: "spy-a",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:00:00.000Z"),
        side: "SELL",
        quantity: 10,
        price: 105,
        commission: 0,
        fees: 0,
      },
      {
        id: "a2-cover",
        accountId: "a2",
        instrumentId: "spy-b",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:30:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 45,
        commission: 0,
        fees: 0,
      },
    ]);

    expect(pnl.map((row) => row.executionId)).toEqual(["a1-open", "a2-short-open", "a1-close", "a2-cover"]);
    expect(pnl.map((row) => row.matchedQuantity)).toEqual([0, 0, 10, 10]);
    expect(pnl.map((row) => row.cumulativePnl)).toEqual([0, 0, 50, 100]);
  });

  it("uses execution id as a deterministic tie-breaker for identical timestamps", () => {
    const executedAt = new Date("2026-02-20T14:30:00.000Z");
    const pnl = computeExecutionPnl([
      {
        id: "b-close",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt,
        side: "SELL",
        quantity: 10,
        price: 105,
        commission: 0,
        fees: 0,
      },
      {
        id: "a-open",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt,
        side: "BUY",
        quantity: 10,
        price: 100,
        commission: 0,
        fees: 0,
      },
    ]);

    expect(pnl.map((row) => row.executionId)).toEqual(["a-open", "b-close"]);
    expect(pnl.map((row) => row.cumulativePnl)).toEqual([0, 50]);
  });

  it("matches same-symbol fills across exchange-specific instrument ids", () => {
    const pnl = computeExecutionPnl([
      {
        id: "open-nasdaq",
        accountId: "a1",
        instrumentId: "nasdaq-aapl",
        symbol: "AAPL",
        assetType: "STOCK",
        currency: "USD",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 100,
        commission: 0,
        fees: 0,
      },
      {
        id: "close-smart",
        accountId: "a1",
        instrumentId: "smart-aapl",
        symbol: "AAPL",
        assetType: "STOCK",
        currency: "USD",
        executedAt: new Date("2026-02-20T15:30:00.000Z"),
        side: "SELL",
        quantity: 10,
        price: 105,
        commission: 0,
        fees: 0,
      },
    ]);

    expect(pnl[1]).toMatchObject({
      executionId: "close-smart",
      grossRealizedPnl: 50,
      realizedPnl: 50,
      matchedQuantity: 10,
      cumulativePnl: 50,
    });
  });

  it("realizes close-only carry-in executions from opening position snapshots", () => {
    const openingByKey = new Map([
      [
        openingPositionKey("a1", { symbol: "AAPL", assetType: "STOCK", currency: "USD" }),
        { quantity: 10, avgCost: 100 },
      ],
    ]);

    const pnl = computeExecutionPnl(
      [
        {
          id: "carry-close",
          accountId: "a1",
          instrumentId: "smart-aapl",
          symbol: "AAPL",
          assetType: "STOCK",
          currency: "USD",
          executedAt: new Date("2026-02-20T15:30:00.000Z"),
          side: "SELL",
          quantity: 10,
          price: 110,
          commission: 1,
          fees: 0,
        },
      ],
      openingByKey,
    );

    expect(pnl).toEqual([
      expect.objectContaining({
        executionId: "carry-close",
        grossRealizedPnl: 100,
        realizedPnl: 99,
        matchedQuantity: 10,
        cumulativePnl: 99,
      }),
    ]);
  });

  it("realizes short carry-in executions from opening position snapshots", () => {
    const openingByKey = new Map([
      [
        openingPositionKey("a1", { symbol: "TSLA", assetType: "STOCK", currency: "USD" }),
        { quantity: -20, avgCost: 200 },
      ],
    ]);

    const pnl = computeExecutionPnl(
      [
        {
          id: "short-carry-cover",
          accountId: "a1",
          instrumentId: "smart-tsla",
          symbol: "TSLA",
          assetType: "STOCK",
          currency: "USD",
          executedAt: new Date("2026-02-20T15:30:00.000Z"),
          side: "BUY",
          quantity: 20,
          price: 190,
          commission: 1,
          fees: 0,
        },
      ],
      openingByKey,
    );

    expect(pnl).toEqual([
      expect.objectContaining({
        executionId: "short-carry-cover",
        grossRealizedPnl: 200,
        realizedPnl: 199,
        matchedQuantity: 20,
        cumulativePnl: 199,
      }),
    ]);
  });

  it("realizes reversals and carries the flipped remainder as a new lot", () => {
    const pnl = computeExecutionPnl([
      {
        id: "long-open",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T14:30:00.000Z"),
        side: "BUY",
        quantity: 10,
        price: 100,
        commission: 0,
        fees: 0,
      },
      {
        id: "long-to-short",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:00:00.000Z"),
        side: "SELL",
        quantity: 15,
        price: 110,
        commission: 0,
        fees: 0,
      },
      {
        id: "short-cover",
        accountId: "a1",
        instrumentId: "spy",
        symbol: "SPY",
        executedAt: new Date("2026-02-20T15:30:00.000Z"),
        side: "BUY",
        quantity: 5,
        price: 105,
        commission: 0,
        fees: 0,
      },
    ]);

    expect(pnl).toEqual([
      expect.objectContaining({ executionId: "long-open", matchedQuantity: 0, realizedPnl: 0, cumulativePnl: 0 }),
      expect.objectContaining({ executionId: "long-to-short", matchedQuantity: 10, realizedPnl: 100, cumulativePnl: 100 }),
      expect.objectContaining({ executionId: "short-cover", matchedQuantity: 5, realizedPnl: 25, cumulativePnl: 125 }),
    ]);
  });
});
