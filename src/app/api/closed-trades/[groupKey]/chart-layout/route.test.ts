import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  closedTradeFindUnique: vi.fn(),
  lockClosedTrade: vi.fn(),
  layoutFindUnique: vi.fn(),
  layoutUpdateMany: vi.fn(),
  layoutCreate: vi.fn(),
  layoutFindUniqueOrThrow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    closedTrade: {
      findUnique: mocks.closedTradeFindUnique,
    },
    closedTradeChartLayout: {
      findUnique: mocks.layoutFindUnique,
      updateMany: mocks.layoutUpdateMany,
      create: mocks.layoutCreate,
      findUniqueOrThrow: mocks.layoutFindUniqueOrThrow,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eNonDemoClosedTrade: vi.fn(() => null),
}));

function layoutRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/closed-trades/trade-1/chart-layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validLayout(version?: number) {
  return {
    layoutMode: "single",
    panels: [
      {
        id: "panel-1",
        symbol: "DEMOA",
        timeframe: "5m",
        rangePreset: "trade",
        visibleFrom: null,
        visibleTo: null,
      },
    ],
    ...(version ? { version } : {}),
  };
}

function transactionClient() {
  return {
    $queryRaw: mocks.lockClosedTrade,
    closedTradeChartLayout: {
      findUnique: mocks.layoutFindUnique,
      updateMany: mocks.layoutUpdateMany,
      create: mocks.layoutCreate,
      findUniqueOrThrow: mocks.layoutFindUniqueOrThrow,
    },
  };
}

describe("closed trade chart layout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: false,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: false }]);
    mocks.layoutFindUnique.mockResolvedValue({ version: 7 });
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  });

  it("requires layout version before updating an existing layout", async () => {
    const { PUT } = await import("./route");

    const response = await PUT(layoutRequest(validLayout()), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Layout version is required.", currentVersion: 7 });
    expect(mocks.layoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.layoutCreate).not.toHaveBeenCalled();
  });

  it("returns persisted layout with version for reload recovery", async () => {
    mocks.layoutFindUnique.mockResolvedValue({
      id: "layout-1",
      closedTradeGroupKey: "trade-1",
      layoutMode: "single",
      panelsJson: JSON.stringify(validLayout(9).panels),
      version: 9,
      createdAt: new Date("2026-06-26T00:00:00.000Z"),
      updatedAt: new Date("2026-06-26T01:00:00.000Z"),
    });
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/closed-trades/trade-1/chart-layout"), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.layout).toMatchObject({
      id: "layout-1",
      groupKey: "trade-1",
      layoutMode: "single",
      version: 9,
      panels: validLayout(9).panels,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T01:00:00.000Z",
    });
  });

  it("returns the latest version when optimistic layout update loses the claim", async () => {
    mocks.layoutFindUnique
      .mockResolvedValueOnce({ version: 7 })
      .mockResolvedValueOnce({ version: 8 });
    mocks.layoutUpdateMany.mockResolvedValue({ count: 0 });
    const { PUT } = await import("./route");

    const response = await PUT(layoutRequest(validLayout(7)), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Layout changed in another tab.", currentVersion: 8 });
    expect(mocks.layoutUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { closedTradeGroupKey: "trade-1", version: 7 },
    }));
    expect(mocks.layoutFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rechecks stale closed-trade state inside the layout transaction", async () => {
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: true }]);
    const { PUT } = await import("./route");

    const response = await PUT(layoutRequest(validLayout(7)), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Cannot edit a stale closed trade." });
    expect(mocks.layoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.layoutCreate).not.toHaveBeenCalled();
  });
});
