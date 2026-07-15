import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class JournalStaleWriteError extends Error {
    currentUpdatedAt: string | null;

    constructor(resource: string, currentUpdatedAt: Date | null) {
      super(`${resource} changed in another tab. Refresh before saving again.`);
      this.name = "JournalStaleWriteError";
      this.currentUpdatedAt = currentUpdatedAt?.toISOString() ?? null;
    }
  }

  return {
    deleteJournalEntry: vi.fn(),
    getJournalEntry: vi.fn(),
    JournalStaleWriteError,
    mapJournalPayloadToData: vi.fn((payload) => payload),
    requireApiSession: vi.fn(),
    updateJournalEntry: vi.fn(),
  };
});

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/server/journal", () => ({
  deleteJournalEntry: mocks.deleteJournalEntry,
  getJournalEntry: mocks.getJournalEntry,
  JournalStaleWriteError: mocks.JournalStaleWriteError,
  mapJournalPayloadToData: mocks.mapJournalPayloadToData,
  updateJournalEntry: mocks.updateJournalEntry,
}));

function deleteRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/journal/entry-1", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("journal entry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.deleteJournalEntry.mockResolvedValue(undefined);
  });

  it("requires expectedUpdatedAt before deleting an entry", async () => {
    const { DELETE } = await import("./route");

    const response = await DELETE(deleteRequest({}), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "expectedUpdatedAt is required for journal entry deletes." });
    expect(mocks.deleteJournalEntry).not.toHaveBeenCalled();
  });

  it("deletes with a parent entry version claim", async () => {
    const { DELETE } = await import("./route");

    const response = await DELETE(deleteRequest({ expectedUpdatedAt: "2026-06-26T00:00:00.000Z" }), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.deleteJournalEntry).toHaveBeenCalledWith("entry-1", {
      expectedUpdatedAt: "2026-06-26T00:00:00.000Z",
    });
  });

  it("returns a stale-write conflict when delete loses the version claim", async () => {
    mocks.deleteJournalEntry.mockRejectedValue(
      new mocks.JournalStaleWriteError("Journal entry", new Date("2026-06-26T00:10:00.000Z")),
    );
    const { DELETE } = await import("./route");

    const response = await DELETE(deleteRequest({ expectedUpdatedAt: "2026-06-26T00:00:00.000Z" }), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "Journal entry changed in another tab. Refresh before saving again.",
      currentUpdatedAt: "2026-06-26T00:10:00.000Z",
    });
  });
});
