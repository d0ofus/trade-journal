import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  dayNoteCreate: vi.fn(),
  dayNoteFindUnique: vi.fn(),
  dayNoteFindUniqueOrThrow: vi.fn(),
  dayNoteUpdateMany: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: mocks.accountFindUnique,
    },
    dayNote: {
      create: mocks.dayNoteCreate,
      findUnique: mocks.dayNoteFindUnique,
      findUniqueOrThrow: mocks.dayNoteFindUniqueOrThrow,
      updateMany: mocks.dayNoteUpdateMany,
    },
  },
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

const existingUpdatedAt = new Date("2026-06-26T00:00:00.000Z");
const savedUpdatedAt = new Date("2026-06-26T00:05:00.000Z");

function dayNoteRequest(body: Record<string, unknown> | string) {
  return new NextRequest("http://localhost/api/notes/day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    date: "2026-06-26",
    content: "Stayed disciplined through the close.",
    ...overrides,
  };
}

describe("day note route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.accountFindUnique.mockResolvedValue({ id: "account-1" });
    mocks.dayNoteFindUnique.mockResolvedValue(null);
    mocks.dayNoteCreate.mockResolvedValue({ updatedAt: savedUpdatedAt });
    mocks.dayNoteUpdateMany.mockResolvedValue({ count: 1 });
    mocks.dayNoteFindUniqueOrThrow.mockResolvedValue({ updatedAt: savedUpdatedAt });
  });

  it("rejects unauthenticated writes before touching Prisma", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest(validBody()));

    expect(response.status).toBe(401);
    expect(mocks.accountFindUnique).not.toHaveBeenCalled();
    expect(mocks.dayNoteCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON before touching Prisma", async () => {
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest("{not-json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid JSON body." });
    expect(mocks.accountFindUnique).not.toHaveBeenCalled();
  });

  it("creates a new day note when no updatedAt guard is present", async () => {
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, updatedAt: savedUpdatedAt.toISOString() });
    expect(mocks.dayNoteCreate).toHaveBeenCalledWith({
      data: {
        accountId: "account-1",
        date: new Date("2026-06-26T00:00:00.000Z"),
        content: "Stayed disciplined through the close.",
      },
      select: { updatedAt: true },
    });
  });

  it("requires an updatedAt guard before replacing an existing note", async () => {
    mocks.dayNoteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest(validBody()));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "DAY_NOTE_CONFLICT",
      currentUpdatedAt: existingUpdatedAt.toISOString(),
    });
    expect(mocks.dayNoteUpdateMany).not.toHaveBeenCalled();
  });

  it("updates an existing note only when the updatedAt guard matches", async () => {
    mocks.dayNoteFindUnique.mockResolvedValue({ updatedAt: existingUpdatedAt });
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest(validBody({ updatedAt: existingUpdatedAt.toISOString() })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, updatedAt: savedUpdatedAt.toISOString() });
    expect(mocks.dayNoteUpdateMany).toHaveBeenCalledWith({
      where: {
        accountId: "account-1",
        date: new Date("2026-06-26T00:00:00.000Z"),
        updatedAt: existingUpdatedAt,
      },
      data: { content: "Stayed disciplined through the close." },
    });
  });

  it("does not overwrite when the updatedAt guard loses the race", async () => {
    const currentUpdatedAt = new Date("2026-06-26T00:10:00.000Z");
    mocks.dayNoteFindUnique
      .mockResolvedValueOnce({ updatedAt: existingUpdatedAt })
      .mockResolvedValueOnce({ updatedAt: currentUpdatedAt });
    mocks.dayNoteUpdateMany.mockResolvedValue({ count: 0 });
    const { POST } = await import("./route");

    const response = await POST(dayNoteRequest(validBody({ updatedAt: existingUpdatedAt.toISOString() })));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "DAY_NOTE_CONFLICT",
      currentUpdatedAt: currentUpdatedAt.toISOString(),
    });
    expect(mocks.dayNoteFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});
