import { computeClosedTradeGroups, type ExecutionForClosed } from "@/lib/stats/closed-trades";

function buildExec(input: {
  id: string;
  executedAt: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission?: number;
  fees?: number;
  instrumentId?: string;
  exchange?: string;
  assetType?: "OTHER" | "STOCK";
  currency?: string;
}): ExecutionForClosed {
  return {
    id: input.id,
    accountId: "a",
    accountCode: "TEST-ACCOUNT",
    instrumentId: input.instrumentId ?? "i",
    symbol: "DEMOA",
    exchange: input.exchange,
    assetType: input.assetType ?? "OTHER",
    currency: input.currency ?? "USD",
    executedAt: new Date(input.executedAt),
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    commission: input.commission ?? 0,
    fees: input.fees ?? 0,
  };
}

describe("computeClosedTradeGroups", () => {
  it("keeps alternating buy/sell sequences as distinct round trips", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "1", executedAt: "2026-06-01T14:30:00.000Z", side: "BUY", quantity: 20, price: 100, commission: 0.5 }),
        buildExec({ id: "2", executedAt: "2026-06-02T15:00:00.000Z", side: "SELL", quantity: 20, price: 102, commission: 0.5 }),
        buildExec({ id: "3", executedAt: "2026-06-03T14:30:00.000Z", side: "BUY", quantity: 5, price: 200, commission: 0.5 }),
        buildExec({ id: "4", executedAt: "2026-06-04T15:00:00.000Z", side: "SELL", quantity: 5, price: 198, commission: 0.5 }),
        buildExec({ id: "5", executedAt: "2026-06-05T14:30:00.000Z", side: "BUY", quantity: 9, price: 50, commission: 0.5 }),
        buildExec({ id: "6", executedAt: "2026-06-06T15:00:00.000Z", side: "SELL", quantity: 9, price: 51, commission: 0.5 }),
      ],
      new Map(),
    );

    expect(groups).toHaveLength(3);
    expect(groups[0].tradeDate).toBe("2026-06-06");
    expect(groups[0].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 9", "SELL 9"]);
    expect(groups[1].tradeDate).toBe("2026-06-04");
    expect(groups[1].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 5", "SELL 5"]);
    expect(groups[2].tradeDate).toBe("2026-06-02");
    expect(groups[2].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 20", "SELL 20"]);
  });

  it("matches FIFO closes across multiple exchange-specific instrument ids for the same symbol", () => {
    const groups = computeClosedTradeGroups(
      [
        {
          ...buildExec({
            id: "buy-arca",
            instrumentId: "arca-id",
            exchange: "ARCA",
            executedAt: "2026-03-13T09:34:00.000Z",
            side: "BUY",
            quantity: 108,
            price: 94.08,
            commission: 1,
          }),
          symbol: "VAL",
        },
        {
          ...buildExec({
            id: "sell-dark",
            instrumentId: "dark-id",
            exchange: "DARK",
            executedAt: "2026-03-16T12:50:00.000Z",
            side: "SELL",
            quantity: 108,
            price: 91.03,
            commission: 1.02,
          }),
          symbol: "VAL",
        },
      ],
      new Map(),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].symbol).toBe("VAL");
    expect(groups[0].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 108", "SELL 108"]);
  });

  it("finalizes carry-in closures when opening quantity exists", () => {
    const groups = computeClosedTradeGroups(
      [buildExec({ id: "close-carry", executedAt: "2026-01-03T10:00:00.000Z", side: "SELL", quantity: 5, price: 110, commission: 1 })],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 5, avgCost: 100 }]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].totalQuantity).toBe(5);
    expect(groups[0].avgEntryPrice).toBe(100);
    expect(groups[0].avgExitPrice).toBe(110);
    expect(groups[0].executions).toHaveLength(1);
    expect(groups[0].executions[0].side).toBe("SELL");
    expect(groups[0].executions[0].quantity).toBe(5);
    expect(groups[0].realizedPnl).toBe(49);
  });

  it("detects a close inside a filtered range when the opening leg came from a prior snapshot", () => {
    const groups = computeClosedTradeGroups(
      [buildExec({ id: "range-close", executedAt: "2026-03-16T12:50:00.000Z", side: "SELL", quantity: 108, price: 91.03, commission: 1.02 })],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 108, avgCost: 94.08 }]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].tradeDate).toBe("2026-03-16");
    expect(groups[0].openingQuantity).toBe(108);
    expect(groups[0].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["SELL 108"]);
  });

  it("detects a round trip that returns to the starting carry position", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "carry-open-1", executedAt: "2026-03-17T09:41:00.000Z", side: "BUY", quantity: 27, price: 73.53 }),
        buildExec({ id: "carry-open-2", executedAt: "2026-03-17T09:41:01.000Z", side: "BUY", quantity: 9, price: 73.53, commission: 1 }),
        buildExec({ id: "carry-close", executedAt: "2026-03-17T17:17:00.000Z", side: "SELL", quantity: 36, price: 74.47, commission: 1.01 }),
      ],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 1, avgCost: 70.16 }]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].tradeDate).toBe("2026-03-17");
    expect(groups[0].openingQuantity).toBe(1);
    expect(groups[0].closingQuantity).toBe(1);
    expect(groups[0].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual([
      "BUY 27",
      "BUY 9",
      "SELL 36",
    ]);
    expect(groups[0].totalQuantity).toBe(36);
    expect(groups[0].avgEntryPrice).toBeCloseTo(73.53, 8);
    expect(groups[0].avgExitPrice).toBe(74.47);
    expect(groups[0].grossRealizedPnl).toBeCloseTo(33.84, 8);
    expect(groups[0].totalCommission).toBeCloseTo(2.01, 8);
    expect(groups[0].realizedPnl).toBeCloseTo(31.83, 8);
  });

  it("preserves carry basis after an add-and-close trade returns to the opening quantity", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "carry-open", executedAt: "2026-03-17T09:41:00.000Z", side: "BUY", quantity: 36, price: 73.53, commission: 1 }),
        buildExec({ id: "carry-close", executedAt: "2026-03-17T17:17:00.000Z", side: "SELL", quantity: 36, price: 74.47, commission: 1.01 }),
        buildExec({ id: "carry-liquidate", executedAt: "2026-03-18T10:00:00.000Z", side: "SELL", quantity: 1, price: 75, commission: 0.25 }),
      ],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 1, avgCost: 70.16 }]]),
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].closingQuantity).toBe(1);
    expect(groups[1].avgEntryPrice).toBeCloseTo(73.53, 8);
    expect(groups[1].grossRealizedPnl).toBeCloseTo(33.84, 8);
    expect(groups[0].openingQuantity).toBe(1);
    expect(groups[0].closingQuantity).toBe(0);
    expect(groups[0].avgEntryPrice).toBeCloseTo(70.16, 8);
    expect(groups[0].avgExitPrice).toBe(75);
    expect(groups[0].grossRealizedPnl).toBeCloseTo(4.84, 8);
    expect(groups[0].realizedPnl).toBeCloseTo(4.59, 8);
  });

  it("matches return-to-baseline closes against in-range long lots before carry lots", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "add", executedAt: "2026-03-17T09:30:00.000Z", side: "BUY", quantity: 5, price: 120 }),
        buildExec({ id: "return-to-carry", executedAt: "2026-03-17T10:00:00.000Z", side: "SELL", quantity: 5, price: 110 }),
        buildExec({ id: "liquidate-carry", executedAt: "2026-03-18T10:00:00.000Z", side: "SELL", quantity: 10, price: 140 }),
      ],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 10, avgCost: 100 }]]),
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].openingQuantity).toBe(10);
    expect(groups[1].closingQuantity).toBe(10);
    expect(groups[1].avgEntryPrice).toBe(120);
    expect(groups[1].avgExitPrice).toBe(110);
    expect(groups[1].grossRealizedPnl).toBe(-50);
    expect(groups[0].openingQuantity).toBe(10);
    expect(groups[0].closingQuantity).toBe(0);
    expect(groups[0].avgEntryPrice).toBe(100);
    expect(groups[0].avgExitPrice).toBe(140);
    expect(groups[0].grossRealizedPnl).toBe(400);
  });

  it("matches return-to-baseline covers against in-range short lots before short carry lots", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "add-short", executedAt: "2026-03-17T09:30:00.000Z", side: "SELL", quantity: 5, price: 80 }),
        buildExec({ id: "return-to-carry-short", executedAt: "2026-03-17T10:00:00.000Z", side: "BUY", quantity: 5, price: 90 }),
        buildExec({ id: "liquidate-short-carry", executedAt: "2026-03-18T10:00:00.000Z", side: "BUY", quantity: 10, price: 60 }),
      ],
      new Map([["a:DEMOA|OTHER|USD", { quantity: -10, avgCost: 100 }]]),
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].openingQuantity).toBe(-10);
    expect(groups[1].closingQuantity).toBe(-10);
    expect(groups[1].avgEntryPrice).toBe(80);
    expect(groups[1].avgExitPrice).toBe(90);
    expect(groups[1].grossRealizedPnl).toBe(-50);
    expect(groups[0].openingQuantity).toBe(-10);
    expect(groups[0].closingQuantity).toBe(0);
    expect(groups[0].avgEntryPrice).toBe(100);
    expect(groups[0].avgExitPrice).toBe(60);
    expect(groups[0].grossRealizedPnl).toBe(400);
  });

  it("includes carry basis when an added position and the opening carry are fully liquidated together", () => {
    const groups = computeClosedTradeGroups(
      [
        buildExec({ id: "carry-open", executedAt: "2026-03-17T09:41:00.000Z", side: "BUY", quantity: 36, price: 73.53, commission: 1 }),
        buildExec({ id: "carry-liquidate-all", executedAt: "2026-03-17T17:17:00.000Z", side: "SELL", quantity: 37, price: 74.47, commission: 1.01 }),
      ],
      new Map([["a:DEMOA|OTHER|USD", { quantity: 1, avgCost: 70.16 }]]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].openingQuantity).toBe(1);
    expect(groups[0].closingQuantity).toBe(0);
    expect(groups[0].totalQuantity).toBe(37);
    expect(groups[0].avgEntryPrice).toBeCloseTo((36 * 73.53 + 70.16) / 37, 8);
    expect(groups[0].avgExitPrice).toBe(74.47);
    expect(groups[0].grossRealizedPnl).toBeCloseTo(38.15, 8);
    expect(groups[0].realizedPnl).toBeCloseTo(36.14, 8);
  });
});
