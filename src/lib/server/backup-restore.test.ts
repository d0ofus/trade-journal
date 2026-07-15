import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { buildBackupReadinessManifest, buildImportArtifactBackupManifest } from "@/lib/server/backup-assets";
import { BACKUP_TABLES, buildBackupTableManifest, type BackupTableKey } from "@/lib/server/backup-contract";
import { BackupRestorePlanError, buildBackupRestorePlan } from "@/lib/server/backup-restore";

function emptyTablePayload() {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, []])) as Record<BackupTableKey, unknown[]>;
}

function buildPayload(tables: Partial<Record<BackupTableKey, unknown[]>> = {}) {
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
      journalScreenshotAssets: [],
      importArtifactManifest,
      tableManifest,
    }),
    ...tablePayload,
    assets: { journalScreenshots: [] },
  };
}

function compactGraphPayload() {
  const importedAt = "2026-06-26T00:00:00.000Z";
  const later = "2026-06-26T00:05:00.000Z";
  const artifact = rawImportArchiveIdentity("account,symbol\nDU123,DEMOA\n");

  return buildPayload({
    accounts: [{ id: "account-1", name: "Demo Account", ibkrAccount: "DU123", createdAt: importedAt, updatedAt: later }],
    instruments: [{ id: "instrument-1", symbol: "DEMOA", exchange: "NASDAQ", assetType: "STOCK", currency: "USD" }],
    tags: [{ id: "tag-1", name: "restore-ready", createdAt: importedAt }],
    importArtifacts: [{ storageKey: artifact.rawStorageKey, rawSha256: artifact.rawSha256, rawBytes: artifact.rawBytes, content: "account,symbol\nDU123,DEMOA\n", createdAt: importedAt }],
    materializationWatermarks: [{ key: "closed-trades", sourceSignature: "sig", sourceCountsJson: "{}", refreshedAt: importedAt, createdAt: importedAt, updatedAt: later }],
    backupAudits: [{ id: "backup-audit-1", sha256: "hash", exportedAt: importedAt, verifiedAt: later, payloadBytes: 100, totalRows: 1, tableCount: BACKUP_TABLES.length, strippedFieldCount: 0, warningCount: 0, errorCount: 0, sourceCountsJson: "{}", createdAt: later }],
    importBatches: [
      {
        id: "batch-1",
        filename: "activity.csv",
        fileType: "activity",
        status: "MATERIALIZED",
        importedAt,
        accountId: "account-1",
        rowsSeen: 1,
        rowsImported: 1,
        rowsSkipped: 0,
        rawSha256: artifact.rawSha256,
        rawBytes: artifact.rawBytes,
        rawStorageKey: artifact.rawStorageKey,
        parserVersion: "test",
        positionSnapshotMode: "PARTIAL",
      },
    ],
    importRowErrors: [{ id: "row-error-1", importBatchId: "batch-1", rowNumber: 2, severity: "WARNING", code: "SKIPPED", message: "Skipped row", rawJson: "{}", createdAt: importedAt }],
    executions: [
      {
        id: "execution-1",
        dedupeKey: "dedupe-1",
        accountId: "account-1",
        instrumentId: "instrument-1",
        importBatchId: "batch-1",
        executedAt: importedAt,
        side: "BUY",
        quantity: 100,
        price: 10,
        commission: 1,
        fees: 0.25,
        currency: "USD",
        createdAt: importedAt,
        updatedAt: later,
        account: { id: "account-1" },
      },
    ],
    positions: [{ id: "position-1", accountId: "account-1", instrumentId: "instrument-1", quantity: 100, avgCost: 10, unrealizedPnl: 15, currency: "USD", updatedAt: later }],
    positionSnapshots: [{ id: "snapshot-1", accountId: "account-1", instrumentId: "instrument-1", date: importedAt, quantity: 100, avgCost: 10, currency: "USD", createdAt: importedAt, updatedAt: later }],
    dailySnapshots: [{ id: "daily-1", accountId: "account-1", date: importedAt, equity: 10000, realizedPnl: 20, unrealizedPnl: 15, currency: "USD", createdAt: importedAt }],
    executionAnalytics: [{ executionId: "execution-1", realizedPnl: 20, grossRealizedPnl: 21, cumulativePnl: 20, matchedQuantity: 100, avgHoldTimeMs: 300000, createdAt: importedAt, updatedAt: later }],
    executionTags: [{ executionId: "execution-1", tagId: "tag-1" }],
    tradeNotes: [{ id: "trade-note-1", executionId: "execution-1", content: "Execution note", createdAt: importedAt, updatedAt: later }],
    dayNotes: [{ id: "day-note-1", accountId: "account-1", date: importedAt, content: "Day note", createdAt: importedAt, updatedAt: later }],
    dayNoteTags: [{ dayNoteId: "day-note-1", tagId: "tag-1" }],
    symbolNotes: [{ id: "symbol-note-1", accountId: "account-1", instrumentId: "instrument-1", thesis: "Symbol thesis", createdAt: importedAt, updatedAt: later }],
    symbolNoteTags: [{ symbolNoteId: "symbol-note-1", tagId: "tag-1" }],
    closedTrades: [
      {
        groupKey: "closed-trade-1",
        accountId: "account-1",
        instrumentId: "instrument-1",
        symbol: "DEMOA",
        direction: "LONG",
        openTime: importedAt,
        closeTime: later,
        tradeDate: importedAt,
        totalQuantity: 100,
        avgEntryPrice: 10,
        avgExitPrice: 10.2,
        grossRealizedPnl: 20,
        openingQuantity: 100,
        closingQuantity: 100,
        realizedPnl: 18.75,
        totalCommission: 1.25,
        isStale: false,
        createdAt: importedAt,
        updatedAt: later,
      },
    ],
    closedTradeNotes: [{ id: "closed-note-1", groupKey: "closed-trade-1", content: "Review", setup: "Setup", thesis: "Thesis", entryReview: "Entry", exitReview: "Exit", mistake: "", lesson: "Lesson", followUp: "", createdAt: importedAt, updatedAt: later }],
    closedTradeLayouts: [{ id: "layout-1", closedTradeGroupKey: "closed-trade-1", layoutMode: "triple", panelsJson: "[]", version: 3, createdAt: importedAt, updatedAt: later }],
    closedTradeAnnotationStates: [{ closedTradeGroupKey: "closed-trade-1", version: 4, createdAt: importedAt, updatedAt: later }],
    closedTradeAnnotations: [{ id: "annotation-1", closedTradeGroupKey: "closed-trade-1", panelId: "panel-1", symbol: "DEMOA", timeframe: "5m", scope: "TRADE", type: "horizontal", pointsJson: "[]", price: 10.2, text: "Exit", styleJson: "{}", createdAt: importedAt, updatedAt: later }],
    closedTradeTags: [{ closedTradeGroupKey: "closed-trade-1", tagId: "tag-1", tag: { id: "tag-1", name: "restore-ready" } }],
    closedTradeExecutions: [{ id: "closed-execution-1", closedTradeGroupKey: "closed-trade-1", executionId: "execution-1", sortOrder: 0, executedAt: importedAt, side: "BUY", quantity: 100, price: 10, commission: 1, fees: 0.25 }],
    marketCandles: [{ id: "candle-1", symbol: "DEMOA", timeframe: "5m", time: importedAt, open: 10, high: 10.3, low: 9.9, close: 10.2, volume: 1000, source: "demo", createdAt: importedAt, updatedAt: later }],
    playbooks: [{ id: "playbook-1", name: "Opening Drive", description: "A+ setup", idealConditions: "", invalidationRules: "", marketRegimeFit: "", archived: false, createdAt: importedAt, updatedAt: later, rules: [{ id: "rule-1" }], examples: [{ id: "example-1" }] }],
    playbookRules: [{ id: "rule-1", playbookId: "playbook-1", text: "Hold above VWAP", category: "SETUP", required: true, sortOrder: 0, createdAt: importedAt, updatedAt: later }],
    journalEntries: [{ id: "journal-1", symbol: "DEMOA", tradeTitle: "Opening drive", ideaDate: importedAt, direction: "LONG", status: "DRAFT", playbookId: "playbook-1", timeframe: "5m", macroSentiment: "NEUTRAL", thesis: "Thesis", trigger: "Trigger", riskPlan: "Risk", idealExecutionPlan: "Plan", missedReason: "", marketContext: "", peerContext: "", lessonLearned: "", exitMarked: false, highAvat: true, indexSupportive: true, idealExecutionOptions: [], idealStopLossOptions: [], outcomeStatus: "UNREVIEWED", outcomeNotes: "", marketRegime: "UNKNOWN", spyTrend: "UNKNOWN", qqqTrend: "UNKNOWN", iwmTrend: "UNKNOWN", sectorTrend: "UNKNOWN", breadthNotes: "", catalystNotes: "", relativeStrengthNotes: "", autoDraft: false, outcomeCalculationJson: "{}", createdAt: importedAt, updatedAt: later, tags: [{ tagId: "tag-1" }], ruleChecks: [{ id: "rule-check-1" }], contextSnapshots: [{ id: "context-1" }], links: [{ id: "link-1" }], notionRelations: [{ relationTagId: "relation-1" }] }],
    journalNotionRelationTags: [{ id: "relation-1", kind: "TYPE_OF_TRADE", name: "Momentum", normalizedName: "momentum", createdAt: importedAt, updatedAt: later }],
    journalEntryTags: [{ journalEntryId: "journal-1", tagId: "tag-1", category: "CUSTOM" }],
    journalCharts: [{ id: "chart-1", journalEntryId: "journal-1", symbol: "DEMOA", timeframe: "5m", purpose: "REVIEW", tradingViewLayoutJson: "{}", caption: "Review chart", createdAt: importedAt, updatedAt: later, markers: [{ id: "marker-1" }] }],
    journalChartMarkers: [{ id: "marker-1", chartId: "chart-1", markerType: "IDEAL_ENTRY", time: importedAt, price: 10, label: "Entry", metadataJson: "{}", createdAt: importedAt }],
    journalContextSnapshots: [{ id: "context-1", journalEntryId: "journal-1", provider: "demo", kind: "market", payloadJson: "{}", createdAt: importedAt }],
    journalLinks: [{ id: "link-1", journalEntryId: "journal-1", linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: "closed-trade-1", label: "Closed trade", createdAt: importedAt }],
    journalEntryNotionRelations: [{ journalEntryId: "journal-1", relationTagId: "relation-1" }],
    journalRuleChecks: [{ id: "rule-check-1", journalEntryId: "journal-1", playbookRuleId: "rule-1", status: "PASS", notes: "Followed", createdAt: importedAt, updatedAt: later }],
    journalReviews: [{ id: "review-1", period: "WEEKLY", startDate: importedAt, endDate: later, summary: "Review", bestIdea: "DEMOA", worstMiss: "", recurringLesson: "Wait", nextFocus: "Quality", createdAt: importedAt, updatedAt: later, actions: [{ id: "action-1" }] }],
    journalReviewActions: [{ id: "action-1", reviewId: "review-1", label: "Size down", status: "OPEN", journalEntryId: "journal-1", playbookId: "playbook-1", dueDate: later, createdAt: importedAt, updatedAt: later }],
    journalSavedViews: [{ id: "saved-view-1", name: "Needs review", viewType: "journal", filtersJson: "{}", sortKey: "ideaDate", sortDirection: "desc", createdAt: importedAt, updatedAt: later }],
    playbookExamples: [{ id: "example-1", playbookId: "playbook-1", journalEntryId: "journal-1", chartId: "chart-1", note: "Good example", sortOrder: 0, createdAt: importedAt }],
  });
}

function planTable(plan: ReturnType<typeof buildBackupRestorePlan>, key: BackupTableKey) {
  const table = plan.tables.find((candidate) => candidate.key === key);
  if (!table) throw new Error(`Missing plan table ${key}`);
  return table;
}

describe("backup restore planning", () => {
  it("converts a validated backup graph into ordered Prisma-ready restore rows", () => {
    const plan = buildBackupRestorePlan(compactGraphPayload());

    expect(plan.ok).toBe(true);
    expect(plan.tableCount).toBe(BACKUP_TABLES.length);
    expect(plan.totalRows).toBe(BACKUP_TABLES.length);
    expect(plan.dateFieldCount).toBeGreaterThan(10);
    expect(plan.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NON_CANONICAL_TABLE_ROWS" })]));

    const order = plan.tables.map((table) => table.key);
    expect(order).toEqual(plan.validation.tableManifest?.importOrder);
    expect(order.indexOf("accounts")).toBeLessThan(order.indexOf("executions"));
    expect(order.indexOf("journalCharts")).toBeLessThan(order.indexOf("playbookExamples"));

    expect(planTable(plan, "closedTradeTags").strippedFields).toEqual(["tag"]);
    expect(planTable(plan, "journalEntries").strippedFields).toEqual(["contextSnapshots", "links", "notionRelations", "ruleChecks", "tags"]);
    expect(planTable(plan, "journalCharts").strippedFields).toEqual(["markers"]);
    expect(planTable(plan, "journalReviews").strippedFields).toEqual(["actions"]);
    expect(planTable(plan, "playbooks").strippedFields).toEqual(["examples", "rules"]);

    expect(planTable(plan, "closedTradeTags").rows[0]).toEqual({ closedTradeGroupKey: "closed-trade-1", tagId: "tag-1" });
    expect(planTable(plan, "journalEntries").rows[0]).not.toHaveProperty("tags");
    expect(planTable(plan, "journalCharts").rows[0]).not.toHaveProperty("markers");
    expect(planTable(plan, "closedTrades").rows[0].openTime).toBeInstanceOf(Date);
    expect(planTable(plan, "marketCandles").rows[0].time).toBeInstanceOf(Date);
  });

  it("rejects payloads that cannot be converted into valid restore rows", () => {
    const payload = compactGraphPayload();
    (payload.closedTrades[0] as Record<string, unknown>).openTime = "not-a-date";

    expect(() => buildBackupRestorePlan(payload)).toThrow(BackupRestorePlanError);
    try {
      buildBackupRestorePlan(payload);
    } catch (error) {
      expect(error).toBeInstanceOf(BackupRestorePlanError);
      expect((error as BackupRestorePlanError).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "INVALID_RESTORE_DATE", path: "closedTrades.0.openTime" })]),
      );
    }
  });

  it("rejects structurally invalid backups before preparing restore rows", () => {
    const payload = buildPayload();
    delete (payload as Record<string, unknown>).accounts;

    expect(() => buildBackupRestorePlan(payload)).toThrow(BackupRestorePlanError);
  });
});
