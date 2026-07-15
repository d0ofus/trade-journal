import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockJournalStaleWriteError extends Error {
    currentUpdatedAt: string | null;

    constructor(resource: string, currentUpdatedAt: Date | null) {
      super(`${resource} changed in another tab. Refresh before saving again.`);
      this.name = "JournalStaleWriteError";
      this.currentUpdatedAt = currentUpdatedAt?.toISOString() ?? null;
    }
  }

  return {
    getServerSession: vi.fn(),
    JournalStaleWriteError: MockJournalStaleWriteError,
    syncJournalRuleChecks: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/server/journal", () => ({
  JournalStaleWriteError: mocks.JournalStaleWriteError,
  syncJournalRuleChecks: mocks.syncJournalRuleChecks,
}));

function ruleChecksRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/journal/entry-1/rule-checks", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRuleChecks(overrides: Record<string, unknown> = {}) {
  return {
    expectedUpdatedAt: "2026-06-26T00:00:00.000Z",
    checks: [
      {
        playbookRuleId: "rule-1",
        status: "PASS",
        notes: "Followed the setup rule.",
      },
    ],
    ...overrides,
  };
}

describe("journal rule-check route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.syncJournalRuleChecks.mockResolvedValue({
      id: "entry-1",
      updatedAt: "2026-06-26T00:01:00.000Z",
      ruleChecks: [],
    });
  });

  it("requires expectedUpdatedAt before mutating rule checks", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(ruleChecksRequest(validRuleChecks({ expectedUpdatedAt: undefined })), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "expectedUpdatedAt is required for rule check updates." });
    expect(mocks.syncJournalRuleChecks).not.toHaveBeenCalled();
  });

  it("passes the parent journal version to rule-check sync", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(ruleChecksRequest(validRuleChecks()), {
      params: Promise.resolve({ id: "entry-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.syncJournalRuleChecks).toHaveBeenCalledWith(
      "entry-1",
      [
        {
          playbookRuleId: "rule-1",
          status: "PASS",
          notes: "Followed the setup rule.",
        },
      ],
      { expectedUpdatedAt: "2026-06-26T00:00:00.000Z" },
    );
  });

  it("maps stale rule-check saves to a conflict response", async () => {
    mocks.syncJournalRuleChecks.mockRejectedValue(
      new mocks.JournalStaleWriteError("Journal entry", new Date("2026-06-26T00:10:00.000Z")),
    );
    const { PATCH } = await import("./route");

    const response = await PATCH(ruleChecksRequest(validRuleChecks()), {
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
