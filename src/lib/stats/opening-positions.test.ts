import { describe, expect, it } from "vitest";

import { buildOpeningPositionMap, openingPositionKey } from "@/lib/stats/opening-positions";

describe("buildOpeningPositionMap", () => {
  it("uses the latest snapshot before each account/instrument's own first execution", () => {
    const executions = [
      {
        accountId: "account-a",
        executedAt: new Date("2026-01-10T14:30:00.000Z"),
        currency: "USD",
        instrument: { symbol: "EARLY", assetType: "STOCK", currency: "USD" },
      },
      {
        accountId: "account-a",
        executedAt: new Date("2026-02-10T14:30:00.000Z"),
        currency: "USD",
        instrument: { symbol: "LATE", assetType: "STOCK", currency: "USD" },
      },
    ];

    const snapshots = [
      {
        accountId: "account-a",
        date: new Date("2026-01-05T00:00:00.000Z"),
        quantity: 10,
        avgCost: 20,
        currency: "USD",
        instrument: { symbol: "EARLY", assetType: "STOCK", currency: "USD" },
      },
      {
        accountId: "account-a",
        date: new Date("2026-02-01T00:00:00.000Z"),
        quantity: 25,
        avgCost: 40,
        currency: "USD",
        instrument: { symbol: "LATE", assetType: "STOCK", currency: "USD" },
      },
    ];

    const openingByKey = buildOpeningPositionMap(executions, snapshots);

    expect(
      openingByKey.get(openingPositionKey("account-a", { symbol: "EARLY", assetType: "STOCK", currency: "USD" })),
    ).toEqual({ quantity: 10, avgCost: 20 });
    expect(
      openingByKey.get(openingPositionKey("account-a", { symbol: "LATE", assetType: "STOCK", currency: "USD" })),
    ).toEqual({ quantity: 25, avgCost: 40 });
  });

  it("aggregates snapshots only when they share the latest eligible date", () => {
    const executions = [
      {
        accountId: "account-a",
        executedAt: new Date("2026-02-10T14:30:00.000Z"),
        currency: "USD",
        instrument: { symbol: "AAPL", assetType: "STOCK", currency: "USD" },
      },
    ];

    const snapshots = [
      {
        accountId: "account-a",
        date: new Date("2026-01-01T00:00:00.000Z"),
        quantity: 100,
        avgCost: 10,
        currency: "USD",
        instrument: { symbol: "AAPL", assetType: "STOCK", currency: "USD" },
      },
      {
        accountId: "account-a",
        date: new Date("2026-02-01T00:00:00.000Z"),
        quantity: 20,
        avgCost: 12,
        currency: "USD",
        instrument: { symbol: "AAPL", assetType: "STOCK", currency: "USD" },
      },
      {
        accountId: "account-a",
        date: new Date("2026-02-01T00:00:00.000Z"),
        quantity: 30,
        avgCost: 14,
        currency: "USD",
        instrument: { symbol: "AAPL", assetType: "STOCK", currency: "USD" },
      },
    ];

    const openingByKey = buildOpeningPositionMap(executions, snapshots);

    expect(openingByKey.get(openingPositionKey("account-a", { symbol: "AAPL", assetType: "STOCK", currency: "USD" })))
      .toEqual({ quantity: 50, avgCost: 13.2 });
  });
});
