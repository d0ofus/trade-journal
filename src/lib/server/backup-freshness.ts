import crypto from "node:crypto";
import { BACKUP_TABLES, type BackupTableKey } from "@/lib/server/backup-contract";

type BackupSourceRowCounts = Partial<Record<BackupTableKey, number>>;
type BackupRelevantTimestampSource = {
  key: Exclude<BackupTableKey, "backupAudits">;
  prismaModel: string;
  timestampFields: readonly string[];
};

const SOURCE_TABLE_KEYS = BACKUP_TABLES
  .map((table) => table.key)
  .filter((key) => key !== "backupAudits") as BackupTableKey[];

export const BACKUP_RELEVANT_TIMESTAMP_SOURCES = [
  { key: "accounts", prismaModel: "Account", timestampFields: ["createdAt", "updatedAt"] },
  { key: "importBatches", prismaModel: "ImportBatch", timestampFields: ["importedAt"] },
  { key: "importRowErrors", prismaModel: "ImportRowError", timestampFields: ["createdAt"] },
  { key: "importArtifacts", prismaModel: "ImportArtifact", timestampFields: ["createdAt"] },
  { key: "materializationWatermarks", prismaModel: "MaterializationWatermark", timestampFields: ["refreshedAt", "createdAt", "updatedAt"] },
  { key: "executions", prismaModel: "Execution", timestampFields: ["createdAt", "updatedAt"] },
  { key: "positions", prismaModel: "Position", timestampFields: ["updatedAt"] },
  { key: "positionSnapshots", prismaModel: "PositionSnapshot", timestampFields: ["createdAt", "updatedAt"] },
  { key: "dailySnapshots", prismaModel: "DailySnapshot", timestampFields: ["createdAt"] },
  { key: "tags", prismaModel: "Tag", timestampFields: ["createdAt"] },
  { key: "tradeNotes", prismaModel: "TradeNote", timestampFields: ["createdAt", "updatedAt"] },
  { key: "dayNotes", prismaModel: "DayNote", timestampFields: ["createdAt", "updatedAt"] },
  { key: "closedTradeNotes", prismaModel: "ClosedTradeNote", timestampFields: ["createdAt", "updatedAt"] },
  { key: "closedTrades", prismaModel: "ClosedTrade", timestampFields: ["createdAt", "updatedAt"] },
  { key: "closedTradeLayouts", prismaModel: "ClosedTradeChartLayout", timestampFields: ["createdAt", "updatedAt"] },
  { key: "closedTradeAnnotationStates", prismaModel: "ClosedTradeAnnotationState", timestampFields: ["createdAt", "updatedAt"] },
  { key: "closedTradeAnnotations", prismaModel: "ClosedTradeAnnotation", timestampFields: ["createdAt", "updatedAt"] },
  { key: "marketCandles", prismaModel: "MarketCandle", timestampFields: ["createdAt", "updatedAt"] },
  { key: "executionAnalytics", prismaModel: "ExecutionAnalytics", timestampFields: ["createdAt", "updatedAt"] },
  { key: "symbolNotes", prismaModel: "SymbolNote", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalEntries", prismaModel: "JournalEntry", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalCharts", prismaModel: "JournalChart", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalChartMarkers", prismaModel: "JournalChartMarker", timestampFields: ["createdAt"] },
  { key: "journalContextSnapshots", prismaModel: "JournalContextSnapshot", timestampFields: ["createdAt"] },
  { key: "journalLinks", prismaModel: "JournalLink", timestampFields: ["createdAt"] },
  { key: "playbooks", prismaModel: "JournalPlaybook", timestampFields: ["createdAt", "updatedAt"] },
  { key: "playbookRules", prismaModel: "JournalPlaybookRule", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalRuleChecks", prismaModel: "JournalEntryRuleCheck", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalReviews", prismaModel: "JournalReview", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalReviewActions", prismaModel: "JournalReviewAction", timestampFields: ["createdAt", "updatedAt"] },
  { key: "journalSavedViews", prismaModel: "JournalSavedView", timestampFields: ["createdAt", "updatedAt"] },
  { key: "playbookExamples", prismaModel: "JournalPlaybookExample", timestampFields: ["createdAt"] },
  { key: "journalNotionRelationTags", prismaModel: "JournalNotionRelationTag", timestampFields: ["createdAt", "updatedAt"] },
] as const satisfies readonly BackupRelevantTimestampSource[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeRowCounts(rowCounts: BackupSourceRowCounts) {
  return Object.fromEntries(SOURCE_TABLE_KEYS.map((key) => [key, rowCounts[key] ?? 0])) as Record<BackupTableKey, number>;
}

export function buildBackupSourceMetadata(input: {
  rowCounts: BackupSourceRowCounts;
  latestDataChangeAt: string | Date | null | undefined;
}) {
  const latestDataChangeAt = normalizeDate(input.latestDataChangeAt);
  const rowCounts = normalizeRowCounts(input.rowCounts);
  const signaturePayload = { latestDataChangeAt, rowCounts };
  const signature = crypto.createHash("sha256").update(JSON.stringify(signaturePayload)).digest("hex");

  return {
    latestDataChangeAt,
    rowCounts,
    signature,
  };
}

export function readBackupSourceMetadata(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.manifest) || !isRecord(payload.manifest.source)) {
    return null;
  }

  const source = payload.manifest.source;
  if (typeof source.signature !== "string" || !isRecord(source.rowCounts)) return null;

  const latestDataChangeAt = normalizeDate(typeof source.latestDataChangeAt === "string" ? source.latestDataChangeAt : null);
  const rowCounts = normalizeRowCounts(source.rowCounts as BackupSourceRowCounts);
  const expected = buildBackupSourceMetadata({ rowCounts, latestDataChangeAt });

  if (source.signature !== expected.signature) return null;

  return {
    latestDataChangeAt,
    rowCounts,
    signature: source.signature,
  };
}
