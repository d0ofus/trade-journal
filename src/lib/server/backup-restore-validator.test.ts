import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { buildImportArtifactBackupManifest, buildBackupReadinessManifest, type JournalScreenshotBackupAsset } from "@/lib/server/backup-assets";
import { BACKUP_TABLES, buildBackupTableManifest, type BackupTableKey } from "@/lib/server/backup-contract";
import { validateBackupRestoreDryRun } from "@/lib/server/backup-restore-validator";

function emptyTablePayload() {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, []])) as Record<BackupTableKey, unknown[]>;
}

function buildPayload(tables: Partial<Record<BackupTableKey, unknown[]>> = {}, journalScreenshotAssets: JournalScreenshotBackupAsset[] = []) {
  const tablePayload = {
    ...emptyTablePayload(),
    ...tables,
  };
  const tableManifest = buildBackupTableManifest(tablePayload);
  const importArtifactManifest = buildImportArtifactBackupManifest(
    tablePayload.importBatches as Parameters<typeof buildImportArtifactBackupManifest>[0],
    tablePayload.importArtifacts as Parameters<typeof buildImportArtifactBackupManifest>[1],
  );
  return {
    exportedAt: "2026-06-26T00:00:00.000Z",
    version: 1,
    manifest: buildBackupReadinessManifest({
      journalScreenshotAssets,
      importArtifactManifest,
      tableManifest,
    }),
    ...tablePayload,
    assets: {
      journalScreenshots: journalScreenshotAssets,
    },
  };
}

function importArtifact(content: string) {
  const identity = rawImportArchiveIdentity(content);
  return {
    storageKey: identity.rawStorageKey,
    rawSha256: identity.rawSha256,
    rawBytes: identity.rawBytes,
    content,
  };
}

const accountRow = { id: "account-1" };
const instrumentRow = { id: "instrument-1" };
const closedTradeRow = { groupKey: "closed-trade-1", accountId: "account-1", instrumentId: "instrument-1" };
const journalEntryRow = { id: "entry-1" };

describe("validateBackupRestoreDryRun", () => {
  it("accepts a valid minimal backup payload", () => {
    const result = validateBackupRestoreDryRun(buildPayload());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.tableManifest?.complete).toBe(true);
  });

  it("accepts legacy import batches without cohort provenance", () => {
    const result = validateBackupRestoreDryRun(
      buildPayload({
        importBatches: [{ id: "legacy-batch", filename: "legacy.csv", status: "FAILED" }],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("validates persisted import cohort roles and parent source identity", () => {
    const valid = validateBackupRestoreDryRun(
      buildPayload({
        importBatches: [
          {
            id: "direct",
            filename: "statement.csv::positions",
            status: "FAILED",
            cohortId: "cohort-1",
            sourceId: "source-1",
            sourceFilename: "statement.csv",
            sourceSection: "positions",
            cohortRole: "DIRECT_FAILURE",
          },
          {
            id: "sibling",
            filename: "statement.csv::trades",
            status: "FAILED",
            cohortId: "cohort-1",
            sourceId: "source-1",
            sourceFilename: "statement.csv",
            sourceSection: "trades",
            cohortRole: "ROLLED_BACK",
          },
        ],
      }),
    );
    const invalid = validateBackupRestoreDryRun(
      buildPayload({
        importBatches: [
          {
            id: "partial",
            filename: "partial.csv",
            status: "FAILED",
            cohortId: "cohort-2",
            cohortRole: "ROLLED_BACK",
          },
        ],
      }),
    );

    expect(valid.ok).toBe(true);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INCOMPLETE_IMPORT_COHORT_PROVENANCE" }),
      ]),
    );
  });

  it("rejects a backup missing a contracted table", () => {
    const payload = buildPayload();
    delete (payload as Record<string, unknown>).accounts;

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_BACKUP_TABLE", path: "accounts" })]));
  });

  it("rejects manifest row counts that drift from the payload", () => {
    const payload = buildPayload({ accounts: [{ id: "account-1" }] });
    payload.manifest.tables!.rowCounts.accounts = 2;

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TABLE_ROW_COUNT_MISMATCH", path: "manifest.tables.rowCounts.accounts" })]),
    );
  });

  it("rejects duplicate composite restore keys", () => {
    const payload = buildPayload({
      accounts: [{ id: "account-1" }],
      instruments: [{ id: "instrument-1" }],
      executions: [{ id: "execution-1", accountId: "account-1", instrumentId: "instrument-1" }],
      tags: [{ id: "tag-1" }],
      executionTags: [
        { executionId: "execution-1", tagId: "tag-1" },
        { executionId: "execution-1", tagId: "tag-1" },
      ],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_RESTORE_KEY", path: "executionTags.1" })]));
  });

  it("rejects broken foreign keys", () => {
    const payload = buildPayload({
      instruments: [{ id: "instrument-1" }],
      executions: [{ id: "execution-1", accountId: "missing-account", instrumentId: "instrument-1" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "BROKEN_FOREIGN_KEY", path: "executions.0.accountId" })]));
  });

  it("accepts journal review best and worst links that point at exported journal entries", () => {
    const payload = buildPayload({
      journalEntries: [journalEntryRow, { id: "entry-2" }],
      journalReviews: [{ id: "review-1", bestIdeaEntryId: "entry-1", worstMissEntryId: "entry-2" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects journal review best and worst links that point at missing entries", () => {
    const payload = buildPayload({
      journalEntries: [journalEntryRow],
      journalReviews: [{ id: "review-1", bestIdeaEntryId: "entry-1", worstMissEntryId: "missing-entry" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "BROKEN_FOREIGN_KEY", path: "journalReviews.0.worstMissEntryId" })]),
    );
  });

  it("rejects tampered import artifact content-address metadata", () => {
    const artifact = importArtifact("account,symbol\nDU1,AAPL\n");
    const payload = buildPayload({
      importArtifacts: [{ ...artifact, content: "account,symbol\nDU1,MSFT\n" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "IMPORT_ARTIFACT_CONTENT_MISMATCH" })]));
  });

  it("rejects embedded screenshot byte and hash mismatches", () => {
    const dataUrl = `data:image/png;base64,${Buffer.from("image").toString("base64")}`;
    const payload = buildPayload(
      {
        journalEntries: [{ id: "entry-1" }],
        journalCharts: [{ id: "chart-1", journalEntryId: "entry-1" }],
      },
      [
        {
          chartId: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "inline:chart-1.png",
          screenshotUrl: dataUrl,
          embedded: true,
          mimeType: "image/png",
          bytes: 999,
          sha256: "wrong",
          dataUrl,
        },
      ],
    );

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SCREENSHOT_BYTES_MISMATCH" })]));
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SCREENSHOT_SHA256_MISMATCH" })]));
  });

  it("rejects external screenshot assets that cannot be embedded", () => {
    const payload = buildPayload(
      {
        journalEntries: [journalEntryRow],
        journalCharts: [{ id: "chart-1", journalEntryId: "entry-1" }],
      },
      [
        {
          chartId: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "journal/entry-1/chart-1.png",
          screenshotUrl: "https://cdn.example.test/chart-1.png",
          embedded: false,
          mimeType: "image/png",
          bytes: null,
          reason: "External screenshot storage is referenced but not embedded.",
        },
      ],
    );

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SCREENSHOT_NOT_EMBEDDED" })]));
  });

  it("rejects journal charts that reference screenshots without an exported backup asset", () => {
    const payload = buildPayload({
      journalEntries: [journalEntryRow],
      journalCharts: [{ id: "chart-1", journalEntryId: "entry-1", screenshotUrl: "data:image/png;base64,aW1hZ2U=" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "SCREENSHOT_ASSET_MISSING", path: "journalCharts.0" })]));
  });

  it("rejects missing archived import artifacts for batches with raw archive metadata", () => {
    const payload = buildPayload({
      importBatches: [
        {
          id: "batch-1",
          filename: "activity.json",
          rawSha256: "sha256",
          rawBytes: 10,
          rawStorageKey: null,
        },
      ],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_IMPORT_ARTIFACT_REFERENCE" })]));
  });

  it("rejects closed-trade notes that cannot be tied back to a closed trade", () => {
    const payload = buildPayload({
      closedTradeNotes: [{ id: "note-1", groupKey: "missing-closed-trade" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "BROKEN_FOREIGN_KEY", path: "closedTradeNotes.0.groupKey" })]));
  });

  it("rejects duplicate closed-trade note and layout domain keys", () => {
    const payload = buildPayload({
      accounts: [accountRow],
      instruments: [instrumentRow],
      closedTrades: [closedTradeRow],
      closedTradeNotes: [
        { id: "note-1", groupKey: "closed-trade-1" },
        { id: "note-2", groupKey: "closed-trade-1" },
      ],
      closedTradeLayouts: [
        { id: "layout-1", closedTradeGroupKey: "closed-trade-1", panelsJson: "[]" },
        { id: "layout-2", closedTradeGroupKey: "closed-trade-1", panelsJson: "[]" },
      ],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_DOMAIN_KEY", path: "closedTradeNotes.1" }),
      expect.objectContaining({ code: "DUPLICATE_DOMAIN_KEY", path: "closedTradeLayouts.1" }),
    ]));
  });

  it("rejects closed-trade journal links that dangle or duplicate review sources", () => {
    const payload = buildPayload({
      accounts: [accountRow],
      instruments: [instrumentRow],
      closedTrades: [closedTradeRow],
      journalEntries: [journalEntryRow, { id: "entry-2" }],
      journalLinks: [
        { id: "link-1", journalEntryId: "entry-1", linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: "closed-trade-1" },
        { id: "link-2", journalEntryId: "entry-2", linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: "closed-trade-1" },
        { id: "link-3", journalEntryId: "entry-2", linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: "missing-closed-trade" },
      ],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_CLOSED_TRADE_REVIEW_LINK", path: "journalLinks.1.targetId" }),
      expect.objectContaining({ code: "BROKEN_CLOSED_TRADE_JOURNAL_LINK", path: "journalLinks.2.targetId" }),
    ]));
  });

  it("rejects corrupt JSON state fields needed to restore chart workspaces", () => {
    const payload = buildPayload({
      accounts: [accountRow],
      instruments: [instrumentRow],
      closedTrades: [closedTradeRow],
      closedTradeLayouts: [{ id: "layout-1", closedTradeGroupKey: "closed-trade-1", panelsJson: "{\"not\":\"an array\"}" }],
      closedTradeAnnotations: [
        {
          id: "annotation-1",
          closedTradeGroupKey: "closed-trade-1",
          pointsJson: "{\"not\":\"an array\"}",
          styleJson: "[]",
        },
      ],
      journalEntries: [journalEntryRow],
      journalCharts: [{ id: "chart-1", journalEntryId: "entry-1", tradingViewLayoutJson: "[1,2,3]" }],
    });

    const result = validateBackupRestoreDryRun(payload);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_JSON_STATE_SHAPE", path: "closedTradeLayouts.0.panelsJson" }),
      expect.objectContaining({ code: "INVALID_JSON_STATE_SHAPE", path: "closedTradeAnnotations.0.pointsJson" }),
      expect.objectContaining({ code: "INVALID_JSON_STATE_SHAPE", path: "closedTradeAnnotations.0.styleJson" }),
      expect.objectContaining({ code: "INVALID_JSON_STATE_SHAPE", path: "journalCharts.0.tradingViewLayoutJson" }),
    ]));
  });
});
