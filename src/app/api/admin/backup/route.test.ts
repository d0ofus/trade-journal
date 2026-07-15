import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBackupTableManifest } from "@/lib/server/backup-contract";

const mocks = vi.hoisted(() => {
  const modelNames = [
    "account",
    "instrument",
    "position",
    "positionSnapshot",
    "dailySnapshot",
    "execution",
    "executionTag",
    "executionAnalytics",
    "tradeNote",
    "dayNote",
    "dayNoteTag",
    "symbolNote",
    "symbolNoteTag",
    "closedTrade",
    "closedTradeExecution",
    "closedTradeNote",
    "closedTradeChartLayout",
    "closedTradeAnnotationState",
    "closedTradeAnnotation",
    "closedTradeTag",
    "marketCandle",
    "journalEntry",
    "journalEntryTag",
    "journalChart",
    "journalChartMarker",
    "journalContextSnapshot",
    "journalLink",
    "journalEntryRuleCheck",
    "journalReview",
    "journalReviewAction",
    "journalPlaybook",
    "journalPlaybookRule",
    "journalPlaybookExample",
    "journalSavedView",
    "journalNotionRelationTag",
    "journalEntryNotionRelation",
    "tag",
    "importBatch",
    "importRowError",
    "importArtifact",
    "materializationWatermark",
    "backupAudit",
  ] as const;
  const models = Object.fromEntries(modelNames.map((name) => [name, { findMany: vi.fn() }]));
  const transactionClient = { ...models };
  return {
    models,
    transactionClient,
    transaction: vi.fn(),
    requireApiSession: vi.fn(),
    validateBackupRestoreDryRun: vi.fn(),
    getLatestBackupRelevantUpdateAt: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...mocks.models,
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/server/backup-restore-validator", () => ({
  validateBackupRestoreDryRun: mocks.validateBackupRestoreDryRun,
}));

vi.mock("@/lib/server/queries", () => ({
  getLatestBackupRelevantUpdateAt: mocks.getLatestBackupRelevantUpdateAt,
}));

describe("admin backup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const model of Object.values(mocks.models)) {
      model.findMany.mockResolvedValue([]);
    }
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.transactionClient) => Promise<unknown>) =>
      callback(mocks.transactionClient),
    );
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.getLatestBackupRelevantUpdateAt.mockResolvedValue(new Date("2026-06-26T00:00:00.000Z"));
    mocks.validateBackupRestoreDryRun.mockImplementation((payload) => ({
      ok: true,
      errors: [],
      warnings: [],
      tableManifest: buildBackupTableManifest(payload),
    }));
  });

  it("validates the serialized downloadable payload before exporting", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(1);
    expect(body.manifest.source).toMatchObject({
      latestDataChangeAt: "2026-06-26T00:00:00.000Z",
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(body.manifest.source.rowCounts.backupAudits).toBeUndefined();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 30_000,
      maxWait: 10_000,
    });
    expect(mocks.getLatestBackupRelevantUpdateAt).toHaveBeenCalledWith(mocks.transactionClient);
    expect(mocks.validateBackupRestoreDryRun).toHaveBeenCalledTimes(2);
    expect(mocks.validateBackupRestoreDryRun.mock.calls[0][0]).toEqual(body);
    expect(mocks.validateBackupRestoreDryRun.mock.calls[1][0]).toEqual(body);
  });

  it("rejects unauthenticated backup export before reading database rows", async () => {
    mocks.requireApiSession.mockResolvedValue({
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    for (const model of Object.values(mocks.models)) {
      expect(model.findMany).not.toHaveBeenCalled();
    }
  });

  it("refuses to export when restore dry-run validation fails", async () => {
    mocks.validateBackupRestoreDryRun.mockReturnValue({
      ok: false,
      errors: [{ code: "TABLE_ROW_COUNT_MISMATCH", message: "bad count" }],
      warnings: [],
      tableManifest: null,
    });
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Backup restore dry-run failed");
    expect(body.errors).toEqual([expect.objectContaining({ code: "TABLE_ROW_COUNT_MISMATCH" })]);
  });

  it("refuses to export when restore planning cannot produce Prisma-ready rows", async () => {
    mocks.models.closedTrade.findMany.mockResolvedValue([
      {
        groupKey: "closed-trade-1",
        accountId: "account-1",
        instrumentId: "instrument-1",
        symbol: "DEMOA",
        direction: "LONG",
        openTime: "not-a-date",
        closeTime: "2026-06-26T00:05:00.000Z",
        tradeDate: "2026-06-26T00:00:00.000Z",
        totalQuantity: 100,
        avgEntryPrice: 10,
        avgExitPrice: 10.2,
        grossRealizedPnl: 20,
        openingQuantity: 100,
        closingQuantity: 100,
        realizedPnl: 18.75,
        totalCommission: 1.25,
      },
    ]);
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("Backup restore plan failed");
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "INVALID_RESTORE_DATE", path: "closedTrades.0.openTime" })]));
  });
});
