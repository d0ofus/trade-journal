import { computeClosedTradeGroups, type ExecutionForClosed } from "@/lib/stats/closed-trades";

function buildExec(input: {
  id: string;
  executedAt: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission?: number;
  fees?: number;
}): ExecutionForClosed {
  return {
    id: input.id,
    accountId: "a",
    accountCode: "U10263280",
    instrumentId: "i",
    symbol: "GEV",
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
        buildExec({ id: "1", executedAt: "2025-06-20T09:30:00.000Z", side: "BUY", quantity: 20, price: 495.91, commission: 0.36 }),
        buildExec({ id: "2", executedAt: "2025-07-01T11:07:00.000Z", side: "SELL", quantity: 20, price: 491.29, commission: 0.42 }),
        buildExec({ id: "3", executedAt: "2025-09-23T10:07:00.000Z", side: "BUY", quantity: 5, price: 638.4, commission: 0.35 }),
        buildExec({ id: "4", executedAt: "2025-10-03T09:58:00.000Z", side: "SELL", quantity: 5, price: 593.49, commission: 0.35 }),
        buildExec({ id: "5", executedAt: "2026-02-24T09:44:00.000Z", side: "BUY", quantity: 9, price: 841.76, commission: 1 }),
        buildExec({ id: "6", executedAt: "2026-02-26T10:13:00.000Z", side: "SELL", quantity: 9, price: 840.65, commission: 1 }),
      ],
      new Map(),
    );

    expect(groups).toHaveLength(3);
    expect(groups[0].tradeDate).toBe("2026-02-26");
    expect(groups[0].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 9", "SELL 9"]);
    expect(groups[1].tradeDate).toBe("2025-10-03");
    expect(groups[1].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 5", "SELL 5"]);
    expect(groups[2].tradeDate).toBe("2025-07-01");
    expect(groups[2].executions.map((execution) => `${execution.side} ${execution.quantity}`)).toEqual(["BUY 20", "SELL 20"]);
  });

  it("finalizes carry-in closures when opening quantity exists", () => {
    const groups = computeClosedTradeGroups(
      [buildExec({ id: "close-carry", executedAt: "2026-01-03T10:00:00.000Z", side: "SELL", quantity: 5, price: 110, commission: 1 })],
      new Map([["a:i", { quantity: 5, avgCost: 100 }]]),
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
      new Map([["a:i", { quantity: 108, avgCost: 94.08 }]]),
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
      new Map([["a:i", { quantity: 1, avgCost: 70.16 }]]),
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
  });
});
