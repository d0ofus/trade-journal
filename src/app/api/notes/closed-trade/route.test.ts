import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closedTradeFindUnique: vi.fn(),
  closedTradeTagCreate: vi.fn(),
  closedTradeTagDeleteMany: vi.fn(),
  getServerSession: vi.fn(),
  lockClosedTrade: vi.fn(),
  noteCreate: vi.fn(),
  noteFindUnique: vi.fn(),
  noteFindUniqueOrThrow: vi.fn(),
  noteUpdateMany: vi.fn(),
  rejectE2eNonDemoClosedTrade: vi.fn(),
  tagUpsert: vi.fn(),
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
    closedTradeNote: {
      findUnique: mocks.noteFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eNonDemoClosedTrade: mocks.rejectE2eNonDemoClosedTrade,
}));

const existingUpdatedAt = new Date("2026-06-26T00:00:00.000Z");
const savedUpdatedAt = new Date("2026-06-26T00:05:00.000Z");

function noteRequest(body: Record<string, unknown> | string) {
  return new NextRequest("http://localhost/api/notes/closed-trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    groupKey: "trade-1",
    content: "General note",
    setup: "Opening drive",
    thesis: "Thesis",
    entryReview: "Entry review",
    exitReview: "Exit review",
    mistake: "Mistake",
    lesson: "Lesson",
    followUp: "Follow up",
    tags: ["reviewed"],
    ...overrides,
  };
}

function transactionClient() {
  return {
    $queryRaw: mocks.lockClosedTrade,
    closedTradeNote: {
      create: mocks.noteCreate,
      findUnique: mocks.noteFindUnique,
      findUniqueOrThrow: mocks.noteFindUniqueOrThrow,
      updateMany: mocks.noteUpdateMany,
    },
    closedTradeTag: {
      create: mocks.closedTradeTagCreate,
      deleteMany: mocks.closedTradeTagDeleteMany,
    },
    tag: {
      upsert: mocks.tagUpsert,
    },
  };
}

describe("closed trade note route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.rejectE2eNonDemoClosedTrade.mockReturnValue(null);
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: false,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: false }]);
    mocks.noteFindUnique.mockResolvedValue(null);
    mocks.noteCreate.mockResolvedValue({ updatedAt: savedUpdatedAt });
    mocks.noteFindUniqueOrThrow.mockResolvedValue({ updatedAt: savedUpdatedAt });
    mocks.noteUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tagUpsert.mockResolvedValue({ id: "tag-1" });
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  });

  it("rejects unauthenticated note writes before reading or mutating data", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody()));

    expect(response.status).toBe(401);
    expect(mocks.closedTradeFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON before touching Prisma", async () => {
    const { POST } = await import("./route");

    const response = await POST(noteRequest("{not-json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid JSON body." });
    expect(mocks.closedTradeFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for schema-invalid payloads", async () => {
    const { POST } = await import("./route");

    const response = await POST(noteRequest({ groupKey: "trade-1" }));

    expect(response.status).toBe(400);
    expect(mocks.closedTradeFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when the closed trade does not exist", async () => {
    mocks.closedTradeFindUnique.mockResolvedValue(null);
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody()));

    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects stale closed trades before opening the note transaction", async () => {
    mocks.closedTradeFindUnique.mockResolvedValue({
      groupKey: "trade-1",
      isStale: true,
      account: { ibkrAccount: "DEMO-WORKSTATION" },
    });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "STALE_CLOSED_TRADE", isStale: true });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rechecks stale closed-trade state inside the note transaction", async () => {
    mocks.lockClosedTrade.mockResolvedValue([{ groupKey: "trade-1", isStale: true }]);
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody({ updatedAt: existingUpdatedAt.toISOString() })));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: "STALE_CLOSED_TRADE", isStale: true });
    expect(mocks.noteUpdateMany).not.toHaveBeenCalled();
    expect(mocks.closedTradeTagDeleteMany).not.toHaveBeenCalled();
  });

  it("returns a conflict for existing notes without an updatedAt guard and leaves tags alone", async () => {
    mocks.noteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody({ updatedAt: null })));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "CLOSED_TRADE_REVIEW_CONFLICT",
      currentUpdatedAt: existingUpdatedAt.toISOString(),
    });
    expect(mocks.noteUpdateMany).not.toHaveBeenCalled();
    expect(mocks.closedTradeTagDeleteMany).not.toHaveBeenCalled();
  });

  it("does not replace tags when the optimistic updatedAt claim loses", async () => {
    const currentUpdatedAt = new Date("2026-06-26T00:10:00.000Z");
    mocks.noteFindUnique
      .mockResolvedValueOnce({ updatedAt: existingUpdatedAt })
      .mockResolvedValueOnce({ updatedAt: currentUpdatedAt });
    mocks.noteUpdateMany.mockResolvedValue({ count: 0 });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody({ updatedAt: existingUpdatedAt.toISOString(), tags: ["new-tag"] })));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "CLOSED_TRADE_REVIEW_CONFLICT",
      currentUpdatedAt: currentUpdatedAt.toISOString(),
    });
    expect(mocks.closedTradeTagDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tagUpsert).not.toHaveBeenCalled();
    expect(mocks.closedTradeTagCreate).not.toHaveBeenCalled();
  });

  it("preserves existing tags when the tags field is omitted", async () => {
    mocks.noteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody({ tags: undefined, updatedAt: existingUpdatedAt.toISOString() })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, updatedAt: savedUpdatedAt.toISOString() });
    expect(mocks.closedTradeTagDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tagUpsert).not.toHaveBeenCalled();
    expect(mocks.closedTradeTagCreate).not.toHaveBeenCalled();
  });

  it("claims existing notes by group key and updatedAt before replacing tags", async () => {
    mocks.noteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    mocks.tagUpsert.mockResolvedValueOnce({ id: "tag-a" }).mockResolvedValueOnce({ id: "tag-b" });
    const { POST } = await import("./route");

    const response = await POST(
      noteRequest(validBody({ tags: ["#A", "a", "B"], updatedAt: existingUpdatedAt.toISOString() })),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, tags: ["a", "b"], updatedAt: savedUpdatedAt.toISOString() });
    expect(mocks.noteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupKey: "trade-1", updatedAt: existingUpdatedAt },
    }));
    expect(mocks.closedTradeTagDeleteMany).toHaveBeenCalledWith({ where: { closedTradeGroupKey: "trade-1" } });
    expect(mocks.tagUpsert).toHaveBeenNthCalledWith(1, { where: { name: "a" }, update: {}, create: { name: "a" } });
    expect(mocks.tagUpsert).toHaveBeenNthCalledWith(2, { where: { name: "b" }, update: {}, create: { name: "b" } });
    expect(mocks.closedTradeTagCreate).toHaveBeenNthCalledWith(1, {
      data: { closedTradeGroupKey: "trade-1", tagId: "tag-a" },
    });
    expect(mocks.closedTradeTagCreate).toHaveBeenNthCalledWith(2, {
      data: { closedTradeGroupKey: "trade-1", tagId: "tag-b" },
    });
  });

  it("allows explicit empty tags to clear existing tags", async () => {
    mocks.noteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody({ tags: [], updatedAt: existingUpdatedAt.toISOString() })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, tags: [] });
    expect(mocks.closedTradeTagDeleteMany).toHaveBeenCalledWith({ where: { closedTradeGroupKey: "trade-1" } });
    expect(mocks.tagUpsert).not.toHaveBeenCalled();
    expect(mocks.closedTradeTagCreate).not.toHaveBeenCalled();
  });

  it("returns the current updatedAt when a concurrent note insert wins the unique key", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2002" });
    mocks.noteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(noteRequest(validBody()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "CLOSED_TRADE_REVIEW_CONFLICT",
      currentUpdatedAt: existingUpdatedAt.toISOString(),
    });
  });
});
