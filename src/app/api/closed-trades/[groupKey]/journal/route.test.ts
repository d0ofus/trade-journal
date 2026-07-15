import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockClosedTradeJournalBridgeError extends Error {
    code: "CLOSED_TRADE_NOT_FOUND" | "STALE_CLOSED_TRADE" | "CLOSED_TRADE_REVIEW_CHANGED";
    status: number;
    currentReviewUpdatedAt?: string | null;

    constructor(
      code: "CLOSED_TRADE_NOT_FOUND" | "STALE_CLOSED_TRADE" | "CLOSED_TRADE_REVIEW_CHANGED",
      message: string,
      status: number,
      options: { currentReviewUpdatedAt?: Date | null } = {},
    ) {
      super(message);
      this.name = "ClosedTradeJournalBridgeError";
      this.code = code;
      this.status = status;
      if ("currentReviewUpdatedAt" in options) {
        this.currentReviewUpdatedAt = options.currentReviewUpdatedAt?.toISOString() ?? null;
      }
    }
  }

  return {
    closedTradeFindUnique: vi.fn(),
    createJournalEntryFromClosedTrade: vi.fn(),
    journalLinkFindFirst: vi.fn(),
    rejectE2eNonDemoClosedTrade: vi.fn(),
    requireApiSession: vi.fn(),
    ClosedTradeJournalBridgeError: MockClosedTradeJournalBridgeError,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    closedTrade: {
      findUnique: mocks.closedTradeFindUnique,
    },
    journalLink: {
      findFirst: mocks.journalLinkFindFirst,
    },
  },
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eNonDemoClosedTrade: mocks.rejectE2eNonDemoClosedTrade,
}));

vi.mock("@/lib/server/journal", () => ({
  ClosedTradeJournalBridgeError: mocks.ClosedTradeJournalBridgeError,
  createJournalEntryFromClosedTrade: mocks.createJournalEntryFromClosedTrade,
}));

function journalRequest(body?: Record<string, unknown> | string) {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new NextRequest("http://localhost/api/closed-trades/trade-1/journal", init);
}

describe("closed trade journal bridge route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.rejectE2eNonDemoClosedTrade.mockReturnValue(null);
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: false,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    mocks.journalLinkFindFirst.mockResolvedValue(null);
    mocks.createJournalEntryFromClosedTrade.mockResolvedValue({
      created: true,
      entry: { id: "journal-1" },
    });
  });

  it("passes the expected review version to the bridge for first-time journal creation", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      journalRequest({ expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z" }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ journalEntryId: "journal-1", created: true });
    expect(mocks.createJournalEntryFromClosedTrade).toHaveBeenCalledWith("trade-1", {
      expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z",
    });
  });

  it("requires a review version before creating a first linked journal", async () => {
    const { POST } = await import("./route");

    const response = await POST(journalRequest(), { params: Promise.resolve({ groupKey: "trade-1" }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "CLOSED_TRADE_REVIEW_CHANGED",
      error: "Closed-trade review version is required. Reload before creating a journal review.",
    });
    expect(mocks.createJournalEntryFromClosedTrade).not.toHaveBeenCalled();
  });

  it("opens an existing linked journal even when no review version is provided", async () => {
    mocks.journalLinkFindFirst.mockResolvedValue({ journalEntryId: "journal-1" });
    mocks.createJournalEntryFromClosedTrade.mockResolvedValue({
      created: false,
      entry: { id: "journal-1" },
    });
    const { POST } = await import("./route");

    const response = await POST(journalRequest(), { params: Promise.resolve({ groupKey: "trade-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ journalEntryId: "journal-1", created: false });
    expect(mocks.createJournalEntryFromClosedTrade).toHaveBeenCalledWith("trade-1", {});
  });

  it("returns current review version details when the bridge detects a changed review", async () => {
    const currentReviewUpdatedAt = new Date("2026-06-26T00:05:00.000Z");
    mocks.createJournalEntryFromClosedTrade.mockRejectedValue(
      new mocks.ClosedTradeJournalBridgeError(
        "CLOSED_TRADE_REVIEW_CHANGED",
        "Closed-trade review changed in another tab. Reload before creating a journal review.",
        409,
        { currentReviewUpdatedAt },
      ),
    );
    const { POST } = await import("./route");

    const response = await POST(
      journalRequest({ expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z" }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "CLOSED_TRADE_REVIEW_CHANGED",
      currentReviewUpdatedAt: currentReviewUpdatedAt.toISOString(),
    });
  });

  it("returns 400 for malformed JSON before creating a journal", async () => {
    const { POST } = await import("./route");

    const response = await POST(journalRequest("{not-json"), { params: Promise.resolve({ groupKey: "trade-1" }) });

    expect(response.status).toBe(400);
    expect(mocks.createJournalEntryFromClosedTrade).not.toHaveBeenCalled();
  });

  it("rejects stale first-time journal creation before the bridge mutates data", async () => {
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: true,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    const { POST } = await import("./route");

    const response = await POST(
      journalRequest({ expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z" }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "STALE_CLOSED_TRADE", isStale: true });
    expect(mocks.createJournalEntryFromClosedTrade).not.toHaveBeenCalled();
  });

  it("returns stale conflicts detected by the bridge after the route preflight", async () => {
    mocks.createJournalEntryFromClosedTrade.mockRejectedValue(
      new mocks.ClosedTradeJournalBridgeError(
        "STALE_CLOSED_TRADE",
        "Cannot create a journal review for a stale closed trade.",
        409,
      ),
    );
    const { POST } = await import("./route");

    const response = await POST(
      journalRequest({ expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z" }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "STALE_CLOSED_TRADE",
      error: "Cannot create a journal review for a stale closed trade.",
    });
    expect(mocks.createJournalEntryFromClosedTrade).toHaveBeenCalledWith("trade-1", {
      expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z",
    });
  });

  it("short-circuits unauthenticated requests before reading closed trades", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { POST } = await import("./route");

    const response = await POST(
      journalRequest({ expectedReviewUpdatedAt: "2026-06-26T00:00:00.000Z" }),
      { params: Promise.resolve({ groupKey: "trade-1" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.closedTradeFindUnique).not.toHaveBeenCalled();
    expect(mocks.createJournalEntryFromClosedTrade).not.toHaveBeenCalled();
  });
});
