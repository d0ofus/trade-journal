import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findMany: vi.fn(),
  annotationStateFindUnique: vi.fn(),
  annotationStateFindUniqueOrThrow: vi.fn(),
  annotationStateUpdateMany: vi.fn(),
  annotationStateCreate: vi.fn(),
  annotationDeleteMany: vi.fn(),
  annotationCreateMany: vi.fn(),
  closedTradeFindUnique: vi.fn(),
  lockClosedTrade: vi.fn(),
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
    closedTradeAnnotation: {
      findMany: mocks.findMany,
    },
    closedTradeAnnotationState: {
      findUnique: mocks.annotationStateFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eNonDemoClosedTrade: vi.fn(() => null),
}));

function transactionClient() {
  return {
    $queryRaw: mocks.lockClosedTrade,
    closedTradeAnnotationState: {
      updateMany: mocks.annotationStateUpdateMany,
      findUniqueOrThrow: mocks.annotationStateFindUniqueOrThrow,
      create: mocks.annotationStateCreate,
    },
    closedTradeAnnotation: {
      deleteMany: mocks.annotationDeleteMany,
      createMany: mocks.annotationCreateMany,
      findMany: mocks.findMany,
    },
  };
}

describe("closed trade annotations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.annotationStateFindUnique.mockResolvedValue({ version: 4, updatedAt: new Date("2026-06-26T00:00:00.000Z") });
    mocks.annotationStateFindUniqueOrThrow.mockResolvedValue({ version: 5, updatedAt: new Date("2026-06-26T00:05:00.000Z") });
    mocks.annotationStateUpdateMany.mockResolvedValue({ count: 1 });
    mocks.annotationStateCreate.mockResolvedValue({ version: 2, updatedAt: new Date("2026-06-26T00:05:00.000Z") });
    mocks.annotationDeleteMany.mockResolvedValue({ count: 0 });
    mocks.annotationCreateMany.mockResolvedValue({ count: 0 });
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: false,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: false }]);
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  });

  it("sanitizes corrupt annotation row JSON before returning GET payloads", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "annotation-1",
        closedTradeGroupKey: "trade-1",
        panelId: "panel-1",
        symbol: " demoa ",
        timeframe: "5m",
        scope: "BROKEN",
        type: "   ",
        pointsJson: '{"not":"an array"}',
        price: null,
        text: null,
        styleJson: "[1,2,3]",
        createdAt: new Date("2026-06-25T00:00:00.000Z"),
        updatedAt: new Date("2026-06-25T00:00:00.000Z"),
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/closed-trades/trade-1/annotations"), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(4);
    expect(body.annotations).toEqual([
      expect.objectContaining({
        id: "annotation-1",
        symbol: "DEMOA",
        scope: "TRADE",
        type: "text",
        points: [],
        style: {},
      }),
    ]);
  });

  it("falls back when persisted points are too long or contain invalid members", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "too-many-points",
        closedTradeGroupKey: "trade-1",
        panelId: "panel-1",
        symbol: "DEMOA",
        timeframe: "5m",
        scope: "TRADE",
        type: "trend",
        pointsJson: JSON.stringify([
          { time: 1, price: 10 },
          { time: 2, price: 11 },
          { time: 3, price: 12 },
          { time: 4, price: 13 },
          { time: 5, price: 14 },
        ]),
        price: null,
        text: null,
        styleJson: "{}",
        createdAt: new Date("2026-06-25T00:00:00.000Z"),
        updatedAt: new Date("2026-06-25T00:00:00.000Z"),
      },
      {
        id: "bad-point",
        closedTradeGroupKey: "trade-1",
        panelId: "panel-1",
        symbol: "DEMOA",
        timeframe: "5m",
        scope: "TRADE",
        type: "ray",
        pointsJson: JSON.stringify([{ time: 1, price: "bad" }]),
        price: Number.NaN,
        text: null,
        styleJson: "{}",
        createdAt: new Date("2026-06-25T00:00:00.000Z"),
        updatedAt: new Date("2026-06-25T00:00:00.000Z"),
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/closed-trades/trade-1/annotations"), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.annotations).toEqual([
      expect.objectContaining({ id: "too-many-points", points: [], price: null }),
      expect.objectContaining({ id: "bad-point", points: [], price: null }),
    ]);
  });

  it("preserves valid annotations and uses default state when no annotation state row exists", async () => {
    mocks.annotationStateFindUnique.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([
      {
        id: "annotation-1",
        closedTradeGroupKey: "trade-1",
        panelId: "panel-1",
        symbol: "DEMOA",
        timeframe: "5m",
        scope: "SYMBOL",
        type: "ray",
        pointsJson: JSON.stringify([{ time: 1_771_891_200, price: 123.45 }]),
        price: 123.45,
        text: "Breakout",
        styleJson: JSON.stringify({ color: "#2563eb", lineWidth: 2 }),
        createdAt: new Date("2026-06-25T00:00:00.000Z"),
        updatedAt: new Date("2026-06-25T01:00:00.000Z"),
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/closed-trades/trade-1/annotations"), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(1);
    expect(body.updatedAt).toBeNull();
    expect(body.annotations).toEqual([
      expect.objectContaining({
        id: "annotation-1",
        groupKey: "trade-1",
        scope: "SYMBOL",
        type: "ray",
        points: [{ time: 1_771_891_200, price: 123.45 }],
        price: 123.45,
        text: "Breakout",
        style: { color: "#2563eb", lineWidth: 2 },
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T01:00:00.000Z",
      }),
    ]);
  });

  it("rejects unauthenticated annotation GET requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const { GET } = await import("./route");

    const response = await GET(new NextRequest("http://localhost/api/closed-trades/trade-1/annotations"), {
      params: Promise.resolve({ groupKey: "trade-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("requires drawing version before updating existing annotation state", async () => {
    const { PUT } = await import("./route");

    const response = await PUT(
      new NextRequest("http://localhost/api/closed-trades/trade-1/annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: [] }),
      }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Drawing version is required.", currentVersion: 4 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not replace annotations when optimistic state claim conflicts", async () => {
    mocks.annotationStateUpdateMany.mockResolvedValue({ count: 0 });
    mocks.annotationStateFindUnique
      .mockResolvedValueOnce({ version: 4 })
      .mockResolvedValueOnce({ version: 5 });
    const { PUT } = await import("./route");

    const response = await PUT(
      new NextRequest("http://localhost/api/closed-trades/trade-1/annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 4,
          annotations: [{ id: "a1", symbol: "DEMOA", scope: "TRADE", type: "horizontal", points: [], price: 100, style: {} }],
        }),
      }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Drawings changed in another tab.", currentVersion: 5 });
    expect(mocks.annotationDeleteMany).not.toHaveBeenCalled();
    expect(mocks.annotationCreateMany).not.toHaveBeenCalled();
  });

  it("rechecks stale closed-trade state inside the annotations transaction", async () => {
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: true }]);
    const { PUT } = await import("./route");

    const response = await PUT(
      new NextRequest("http://localhost/api/closed-trades/trade-1/annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 4,
          annotations: [{ id: "a1", symbol: "DEMOA", scope: "TRADE", type: "horizontal", points: [], price: 100, style: {} }],
        }),
      }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Cannot edit a stale closed trade." });
    expect(mocks.annotationStateUpdateMany).not.toHaveBeenCalled();
    expect(mocks.annotationDeleteMany).not.toHaveBeenCalled();
    expect(mocks.annotationCreateMany).not.toHaveBeenCalled();
  });
});
