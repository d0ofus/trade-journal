export type BackupTableContract = {
  key: string;
  prismaModel: string;
  dependencies: string[];
  restoreOrder: number;
  canonicalRows: boolean;
  notes?: string;
};

export const BACKUP_TABLES = [
  { key: "accounts", prismaModel: "Account", dependencies: [], restoreOrder: 10, canonicalRows: true },
  { key: "instruments", prismaModel: "Instrument", dependencies: [], restoreOrder: 20, canonicalRows: true },
  { key: "tags", prismaModel: "Tag", dependencies: [], restoreOrder: 30, canonicalRows: true },
  { key: "importArtifacts", prismaModel: "ImportArtifact", dependencies: [], restoreOrder: 40, canonicalRows: true },
  { key: "materializationWatermarks", prismaModel: "MaterializationWatermark", dependencies: [], restoreOrder: 50, canonicalRows: true },
  { key: "backupAudits", prismaModel: "BackupAudit", dependencies: [], restoreOrder: 60, canonicalRows: true },
  { key: "importBatches", prismaModel: "ImportBatch", dependencies: ["accounts", "importArtifacts"], restoreOrder: 70, canonicalRows: true },
  { key: "importRowErrors", prismaModel: "ImportRowError", dependencies: ["importBatches"], restoreOrder: 80, canonicalRows: true },
  { key: "executions", prismaModel: "Execution", dependencies: ["accounts", "instruments", "importBatches"], restoreOrder: 90, canonicalRows: true },
  { key: "positions", prismaModel: "Position", dependencies: ["accounts", "instruments"], restoreOrder: 100, canonicalRows: true },
  { key: "positionSnapshots", prismaModel: "PositionSnapshot", dependencies: ["accounts", "instruments"], restoreOrder: 110, canonicalRows: true },
  { key: "dailySnapshots", prismaModel: "DailySnapshot", dependencies: ["accounts"], restoreOrder: 120, canonicalRows: true },
  { key: "executionAnalytics", prismaModel: "ExecutionAnalytics", dependencies: ["executions"], restoreOrder: 130, canonicalRows: true },
  { key: "executionTags", prismaModel: "ExecutionTag", dependencies: ["executions", "tags"], restoreOrder: 140, canonicalRows: true },
  { key: "tradeNotes", prismaModel: "TradeNote", dependencies: ["executions"], restoreOrder: 150, canonicalRows: true },
  { key: "dayNotes", prismaModel: "DayNote", dependencies: ["accounts"], restoreOrder: 160, canonicalRows: true },
  { key: "dayNoteTags", prismaModel: "DayNoteTag", dependencies: ["dayNotes", "tags"], restoreOrder: 170, canonicalRows: true },
  { key: "symbolNotes", prismaModel: "SymbolNote", dependencies: ["accounts", "instruments"], restoreOrder: 180, canonicalRows: true },
  { key: "symbolNoteTags", prismaModel: "SymbolNoteTag", dependencies: ["symbolNotes", "tags"], restoreOrder: 190, canonicalRows: true },
  { key: "closedTrades", prismaModel: "ClosedTrade", dependencies: ["accounts", "instruments"], restoreOrder: 200, canonicalRows: true },
  { key: "closedTradeNotes", prismaModel: "ClosedTradeNote", dependencies: ["closedTrades"], restoreOrder: 210, canonicalRows: true },
  { key: "closedTradeLayouts", prismaModel: "ClosedTradeChartLayout", dependencies: ["closedTrades"], restoreOrder: 220, canonicalRows: true },
  { key: "closedTradeAnnotationStates", prismaModel: "ClosedTradeAnnotationState", dependencies: ["closedTrades"], restoreOrder: 230, canonicalRows: true },
  { key: "closedTradeAnnotations", prismaModel: "ClosedTradeAnnotation", dependencies: ["closedTrades"], restoreOrder: 240, canonicalRows: true },
  { key: "closedTradeTags", prismaModel: "ClosedTradeTag", dependencies: ["closedTrades", "tags"], restoreOrder: 250, canonicalRows: false, notes: "Rows include tag relation data in the export payload." },
  { key: "closedTradeExecutions", prismaModel: "ClosedTradeExecution", dependencies: ["closedTrades", "executions"], restoreOrder: 260, canonicalRows: true },
  { key: "marketCandles", prismaModel: "MarketCandle", dependencies: [], restoreOrder: 270, canonicalRows: true },
  { key: "playbooks", prismaModel: "JournalPlaybook", dependencies: [], restoreOrder: 280, canonicalRows: false, notes: "Rows include rules and examples relation data in the export payload." },
  { key: "playbookRules", prismaModel: "JournalPlaybookRule", dependencies: ["playbooks"], restoreOrder: 290, canonicalRows: true },
  { key: "journalEntries", prismaModel: "JournalEntry", dependencies: ["playbooks"], restoreOrder: 300, canonicalRows: false, notes: "Rows include tags, rule checks, context snapshots, links, and notion relation data in the export payload." },
  { key: "journalNotionRelationTags", prismaModel: "JournalNotionRelationTag", dependencies: [], restoreOrder: 310, canonicalRows: true },
  { key: "journalEntryTags", prismaModel: "JournalEntryTag", dependencies: ["journalEntries", "tags"], restoreOrder: 320, canonicalRows: true },
  { key: "journalCharts", prismaModel: "JournalChart", dependencies: ["journalEntries"], restoreOrder: 330, canonicalRows: false, notes: "Rows include marker relation data in the export payload." },
  { key: "journalChartMarkers", prismaModel: "JournalChartMarker", dependencies: ["journalCharts"], restoreOrder: 340, canonicalRows: true },
  { key: "journalContextSnapshots", prismaModel: "JournalContextSnapshot", dependencies: ["journalEntries"], restoreOrder: 350, canonicalRows: true },
  { key: "journalLinks", prismaModel: "JournalLink", dependencies: ["journalEntries"], restoreOrder: 360, canonicalRows: true },
  { key: "journalEntryNotionRelations", prismaModel: "JournalEntryNotionRelation", dependencies: ["journalEntries", "journalNotionRelationTags"], restoreOrder: 370, canonicalRows: true },
  { key: "journalRuleChecks", prismaModel: "JournalEntryRuleCheck", dependencies: ["journalEntries", "playbookRules"], restoreOrder: 380, canonicalRows: true },
  { key: "journalReviews", prismaModel: "JournalReview", dependencies: ["journalEntries"], restoreOrder: 390, canonicalRows: false, notes: "Rows include action relation data in the export payload." },
  { key: "journalReviewActions", prismaModel: "JournalReviewAction", dependencies: ["journalReviews", "journalEntries", "playbooks"], restoreOrder: 400, canonicalRows: true },
  { key: "journalSavedViews", prismaModel: "JournalSavedView", dependencies: [], restoreOrder: 410, canonicalRows: true },
  { key: "playbookExamples", prismaModel: "JournalPlaybookExample", dependencies: ["playbooks", "journalEntries", "journalCharts"], restoreOrder: 420, canonicalRows: true },
] as const satisfies readonly BackupTableContract[];

export type BackupTableKey = (typeof BACKUP_TABLES)[number]["key"];
type BackupRowCounts = Partial<Record<BackupTableKey, number>>;

function arrayKeys(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([, value]) => Array.isArray(value))
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

export function buildBackupTableManifestFromRowCounts(rowCountInput: BackupRowCounts, extraArrayKeys: string[] = []) {
  const rowCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table.key, rowCountInput[table.key] ?? 0]),
  ) as Record<BackupTableKey, number>;
  const missingTables = BACKUP_TABLES.filter((table) => rowCountInput[table.key] === undefined).map((table) => table.key);
  const tables = [...BACKUP_TABLES]
    .sort((left, right) => left.restoreOrder - right.restoreOrder)
    .map((table) => ({
      ...table,
      rowCount: rowCounts[table.key],
    }));

  return {
    totalTables: BACKUP_TABLES.length,
    totalRows: Object.values(rowCounts).reduce((sum, value) => sum + value, 0),
    complete: missingTables.length === 0 && extraArrayKeys.length === 0,
    rowCounts,
    importOrder: tables.map((table) => table.key),
    missingTables,
    extraArrayKeys,
    tables,
  };
}

export function buildBackupTableManifest(payload: Record<string, unknown>) {
  const tableKeys = new Set<string>(BACKUP_TABLES.map((table) => table.key));
  const payloadArrayKeys = arrayKeys(payload);
  const rowCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => {
      const value = payload[table.key];
      return [table.key, Array.isArray(value) ? value.length : undefined];
    }),
  ) as BackupRowCounts;
  const extraArrayKeys = payloadArrayKeys.filter((key) => !tableKeys.has(key));
  return buildBackupTableManifestFromRowCounts(rowCounts, extraArrayKeys);
}

export function validateBackupPayloadShape(payload: Record<string, unknown>) {
  const manifest = buildBackupTableManifest(payload);
  return {
    ok: manifest.complete,
    missingTables: manifest.missingTables,
    extraArrayKeys: manifest.extraArrayKeys,
  };
}
