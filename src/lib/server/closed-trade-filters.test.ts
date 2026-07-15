import { describe, expect, it } from "vitest";
import { buildClosedTradeWhere } from "@/lib/server/closed-trade-filters";

describe("buildClosedTradeWhere", () => {
  it("excludes stale closed trades by default", () => {
    expect(buildClosedTradeWhere({})).toEqual({ isStale: false });
  });

  it("allows stale rows only when explicitly requested", () => {
    expect(buildClosedTradeWhere({ includeStale: true })).toEqual({});
  });

  it("filters closed trades by trade direction and strategy in addition to a closed-trade tag", () => {
    const where = buildClosedTradeWhere({
      direction: "LONG",
      strategy: "Opening Range",
      tag: "demo-momentum",
    });

    expect(where).toEqual({
      isStale: false,
      direction: "LONG",
      AND: [
        {
          executions: {
            some: {
              execution: {
                strategy: { equals: "Opening Range" },
              },
            },
          },
        },
        {
          OR: [
            { tags: { some: { tag: { name: { equals: "demo-momentum" } } } } },
            {
              executions: {
                some: {
                  execution: {
                    tags: { some: { tag: { name: { equals: "demo-momentum" } } } },
                  },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("maps legacy side query params to closed-trade direction", () => {
    expect(buildClosedTradeWhere({ side: "SELL" })).toEqual({
      isStale: false,
      direction: "SHORT",
    });
  });

  it("filters closed trades by account code", () => {
    expect(buildClosedTradeWhere({ account: "DEMO-WORKSTATION" })).toEqual({
      isStale: false,
      account: { ibkrAccount: { equals: "DEMO-WORKSTATION" } },
    });
  });

  it("keeps tag-only matching available for closed-trade and execution tags", () => {
    expect(buildClosedTradeWhere({ tag: "#Mistake" })).toEqual({
      isStale: false,
      AND: [
        {
          OR: [
            { tags: { some: { tag: { name: { equals: "mistake" } } } } },
            {
              executions: {
                some: {
                  execution: {
                    tags: { some: { tag: { name: { equals: "mistake" } } } },
                  },
                },
              },
            },
          ],
        },
      ],
    });
  });
});
