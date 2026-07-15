import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { inspectInlineDataUrl, type JournalScreenshotBackupAsset } from "@/lib/server/backup-assets";
import { BACKUP_TABLES, buildBackupTableManifest, type BackupTableKey } from "@/lib/server/backup-contract";

type JsonRecord = Record<string, unknown>;

export type BackupRestoreDryRunIssue = {
  code: string;
  message: string;
  path?: string;
};

export type BackupRestoreDryRunResult = {
  ok: boolean;
  errors: BackupRestoreDryRunIssue[];
  warnings: BackupRestoreDryRunIssue[];
  tableManifest: ReturnType<typeof buildBackupTableManifest> | null;
};

type KeySpec = {
  table: BackupTableKey;
  fields: string[];
};

type ForeignKeySpec = {
  table: BackupTableKey;
  field: string;
  targetTable: BackupTableKey;
  targetField?: string;
  optional?: boolean;
};

const RESTORE_KEYS: KeySpec[] = [
  { table: "accounts", fields: ["id"] },
  { table: "instruments", fields: ["id"] },
  { table: "tags", fields: ["id"] },
  { table: "importArtifacts", fields: ["storageKey"] },
  { table: "materializationWatermarks", fields: ["key"] },
  { table: "importBatches", fields: ["id"] },
  { table: "importRowErrors", fields: ["id"] },
  { table: "executions", fields: ["id"] },
  { table: "positions", fields: ["id"] },
  { table: "positionSnapshots", fields: ["id"] },
  { table: "dailySnapshots", fields: ["id"] },
  { table: "executionAnalytics", fields: ["executionId"] },
  { table: "executionTags", fields: ["executionId", "tagId"] },
  { table: "tradeNotes", fields: ["id"] },
  { table: "dayNotes", fields: ["id"] },
  { table: "dayNoteTags", fields: ["dayNoteId", "tagId"] },
  { table: "symbolNotes", fields: ["id"] },
  { table: "symbolNoteTags", fields: ["symbolNoteId", "tagId"] },
  { table: "closedTrades", fields: ["groupKey"] },
  { table: "closedTradeNotes", fields: ["id"] },
  { table: "closedTradeLayouts", fields: ["id"] },
  { table: "closedTradeAnnotationStates", fields: ["closedTradeGroupKey"] },
  { table: "closedTradeAnnotations", fields: ["id"] },
  { table: "closedTradeTags", fields: ["closedTradeGroupKey", "tagId"] },
  { table: "closedTradeExecutions", fields: ["id"] },
  { table: "marketCandles", fields: ["id"] },
  { table: "playbooks", fields: ["id"] },
  { table: "playbookRules", fields: ["id"] },
  { table: "journalEntries", fields: ["id"] },
  { table: "journalNotionRelationTags", fields: ["id"] },
  { table: "journalEntryTags", fields: ["journalEntryId", "tagId", "category"] },
  { table: "journalCharts", fields: ["id"] },
  { table: "journalChartMarkers", fields: ["id"] },
  { table: "journalContextSnapshots", fields: ["id"] },
  { table: "journalLinks", fields: ["id"] },
  { table: "journalEntryNotionRelations", fields: ["journalEntryId", "relationTagId"] },
  { table: "journalRuleChecks", fields: ["id"] },
  { table: "journalReviews", fields: ["id"] },
  { table: "journalReviewActions", fields: ["id"] },
  { table: "journalSavedViews", fields: ["id"] },
  { table: "playbookExamples", fields: ["id"] },
];

const FOREIGN_KEYS: ForeignKeySpec[] = [
  { table: "importBatches", field: "accountId", targetTable: "accounts", optional: true },
  { table: "importBatches", field: "rawStorageKey", targetTable: "importArtifacts", targetField: "storageKey", optional: true },
  { table: "importRowErrors", field: "importBatchId", targetTable: "importBatches" },
  { table: "executions", field: "accountId", targetTable: "accounts" },
  { table: "executions", field: "instrumentId", targetTable: "instruments" },
  { table: "executions", field: "importBatchId", targetTable: "importBatches", optional: true },
  { table: "positions", field: "accountId", targetTable: "accounts" },
  { table: "positions", field: "instrumentId", targetTable: "instruments" },
  { table: "positionSnapshots", field: "accountId", targetTable: "accounts" },
  { table: "positionSnapshots", field: "instrumentId", targetTable: "instruments" },
  { table: "dailySnapshots", field: "accountId", targetTable: "accounts" },
  { table: "executionAnalytics", field: "executionId", targetTable: "executions" },
  { table: "executionTags", field: "executionId", targetTable: "executions" },
  { table: "executionTags", field: "tagId", targetTable: "tags" },
  { table: "tradeNotes", field: "executionId", targetTable: "executions" },
  { table: "dayNotes", field: "accountId", targetTable: "accounts" },
  { table: "dayNoteTags", field: "dayNoteId", targetTable: "dayNotes" },
  { table: "dayNoteTags", field: "tagId", targetTable: "tags" },
  { table: "symbolNotes", field: "accountId", targetTable: "accounts" },
  { table: "symbolNotes", field: "instrumentId", targetTable: "instruments" },
  { table: "symbolNoteTags", field: "symbolNoteId", targetTable: "symbolNotes" },
  { table: "symbolNoteTags", field: "tagId", targetTable: "tags" },
  { table: "closedTrades", field: "accountId", targetTable: "accounts" },
  { table: "closedTrades", field: "instrumentId", targetTable: "instruments" },
  { table: "closedTradeNotes", field: "groupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeLayouts", field: "closedTradeGroupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeAnnotationStates", field: "closedTradeGroupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeAnnotations", field: "closedTradeGroupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeTags", field: "closedTradeGroupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeTags", field: "tagId", targetTable: "tags" },
  { table: "closedTradeExecutions", field: "closedTradeGroupKey", targetTable: "closedTrades", targetField: "groupKey" },
  { table: "closedTradeExecutions", field: "executionId", targetTable: "executions" },
  { table: "journalEntries", field: "playbookId", targetTable: "playbooks", optional: true },
  { table: "playbookRules", field: "playbookId", targetTable: "playbooks" },
  { table: "journalEntryTags", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalEntryTags", field: "tagId", targetTable: "tags" },
  { table: "journalCharts", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalChartMarkers", field: "chartId", targetTable: "journalCharts" },
  { table: "journalContextSnapshots", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalLinks", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalEntryNotionRelations", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalEntryNotionRelations", field: "relationTagId", targetTable: "journalNotionRelationTags" },
  { table: "journalRuleChecks", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "journalRuleChecks", field: "playbookRuleId", targetTable: "playbookRules", optional: true },
  { table: "journalReviews", field: "bestIdeaEntryId", targetTable: "journalEntries", optional: true },
  { table: "journalReviews", field: "worstMissEntryId", targetTable: "journalEntries", optional: true },
  { table: "journalReviewActions", field: "reviewId", targetTable: "journalReviews" },
  { table: "journalReviewActions", field: "journalEntryId", targetTable: "journalEntries", optional: true },
  { table: "journalReviewActions", field: "playbookId", targetTable: "playbooks", optional: true },
  { table: "playbookExamples", field: "playbookId", targetTable: "playbooks" },
  { table: "playbookExamples", field: "journalEntryId", targetTable: "journalEntries" },
  { table: "playbookExamples", field: "chartId", targetTable: "journalCharts", optional: true },
];

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function tableRows(payload: JsonRecord, key: BackupTableKey) {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function scalarKey(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function compositeKey(row: JsonRecord, fields: string[]) {
  const values = fields.map((field) => scalarKey(row[field]));
  if (values.some((value) => value == null || value === "")) return null;
  return JSON.stringify(values);
}

function issue(code: string, message: string, path?: string): BackupRestoreDryRunIssue {
  return { code, message, path };
}

function manifestRowCounts(manifestTables: unknown) {
  if (!isRecord(manifestTables)) return null;
  const rowCounts = manifestTables.rowCounts;
  return isRecord(rowCounts) ? rowCounts : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateBackupManifest(payload: JsonRecord, tableManifest: ReturnType<typeof buildBackupTableManifest>) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const manifest = payload.manifest;

  if (!isRecord(manifest)) {
    return [issue("MISSING_MANIFEST", "Backup manifest is missing or invalid.", "manifest")];
  }

  if (payload.version !== 1) {
    errors.push(issue("UNSUPPORTED_BACKUP_VERSION", "Backup version must be 1.", "version"));
  }
  if (manifest.schema !== "trade-journal-backup") {
    errors.push(issue("INVALID_MANIFEST_SCHEMA", "Backup manifest schema must be trade-journal-backup.", "manifest.schema"));
  }
  if (manifest.version !== 1) {
    errors.push(issue("UNSUPPORTED_MANIFEST_VERSION", "Backup manifest version must be 1.", "manifest.version"));
  }

  const rowCounts = manifestRowCounts(manifest.tables);
  if (!rowCounts) {
    errors.push(issue("MISSING_TABLE_MANIFEST", "Backup manifest is missing table row counts.", "manifest.tables.rowCounts"));
    return errors;
  }

  for (const table of BACKUP_TABLES) {
    const expected = tableManifest.rowCounts[table.key];
    const actual = numberValue(rowCounts[table.key]);
    if (actual !== expected) {
      errors.push(
        issue(
          "TABLE_ROW_COUNT_MISMATCH",
          `${table.key} manifest row count ${actual ?? "missing"} does not match payload row count ${expected}.`,
          `manifest.tables.rowCounts.${table.key}`,
        ),
      );
    }
  }

  const totalRows = numberValue((manifest.tables as JsonRecord).totalRows);
  if (totalRows != null && totalRows !== tableManifest.totalRows) {
    errors.push(issue("TABLE_TOTAL_ROW_COUNT_MISMATCH", "Manifest totalRows does not match payload table rows.", "manifest.tables.totalRows"));
  }

  return errors;
}

function validateRestoreKeys(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const keySets = new Map<BackupTableKey, Set<string>>();

  for (const spec of RESTORE_KEYS) {
    const seen = new Set<string>();
    keySets.set(spec.table, seen);

    tableRows(payload, spec.table).forEach((row, index) => {
      if (!isRecord(row)) {
        errors.push(issue("INVALID_TABLE_ROW", `${spec.table} row ${index} is not an object.`, `${spec.table}.${index}`));
        return;
      }
      const key = compositeKey(row, spec.fields);
      if (!key) {
        errors.push(
          issue(
            "MISSING_RESTORE_KEY",
            `${spec.table} row ${index} is missing restore key ${spec.fields.join(", ")}.`,
            `${spec.table}.${index}`,
          ),
        );
        return;
      }
      if (seen.has(key)) {
        errors.push(issue("DUPLICATE_RESTORE_KEY", `${spec.table} contains duplicate restore key ${key}.`, `${spec.table}.${index}`));
      }
      seen.add(key);
    });
  }

  return { errors, keySets };
}

function validateForeignKeys(payload: JsonRecord, keySets: Map<BackupTableKey, Set<string>>) {
  const errors: BackupRestoreDryRunIssue[] = [];

  for (const spec of FOREIGN_KEYS) {
    const targetSpec = RESTORE_KEYS.find((keySpec) => keySpec.table === spec.targetTable);
    const targetFields = spec.targetField ? [spec.targetField] : targetSpec?.fields;
    const targetKeys = keySets.get(spec.targetTable);
    if (!targetFields || !targetKeys) continue;

    tableRows(payload, spec.table).forEach((row, index) => {
      if (!isRecord(row)) return;
      const value = row[spec.field];
      if (value == null || value === "") {
        if (!spec.optional) {
          errors.push(issue("MISSING_FOREIGN_KEY", `${spec.table}.${spec.field} is required.`, `${spec.table}.${index}.${spec.field}`));
        }
        return;
      }
      const normalized = scalarKey(value);
      if (normalized == null) {
        errors.push(issue("INVALID_FOREIGN_KEY", `${spec.table}.${spec.field} is not a scalar value.`, `${spec.table}.${index}.${spec.field}`));
        return;
      }
      const key = JSON.stringify([normalized]);
      if (!targetKeys.has(key)) {
        errors.push(
          issue(
            "BROKEN_FOREIGN_KEY",
            `${spec.table}.${spec.field} references missing ${spec.targetTable}.${targetFields.join(", ")} ${normalized}.`,
            `${spec.table}.${index}.${spec.field}`,
          ),
        );
      }
    });
  }

  return errors;
}

function validateImportArtifacts(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const artifactsByStorageKey = new Map<string, JsonRecord>();

  tableRows(payload, "importArtifacts").forEach((row, index) => {
    if (!isRecord(row)) return;
    const storageKey = scalarKey(row.storageKey);
    if (storageKey) artifactsByStorageKey.set(storageKey, row);
    if (typeof row.content !== "string") {
      errors.push(issue("INVALID_IMPORT_ARTIFACT_CONTENT", "Import artifact content must be a string.", `importArtifacts.${index}.content`));
      return;
    }
    const computed = rawImportArchiveIdentity(row.content);
    const rawSha256 = scalarKey(row.rawSha256);
    const rawBytes = numberValue(row.rawBytes);
    const mismatches = [
      storageKey !== computed.rawStorageKey ? "storageKey" : "",
      rawSha256 !== computed.rawSha256 ? "rawSha256" : "",
      rawBytes !== computed.rawBytes ? "rawBytes" : "",
    ].filter(Boolean);

    if (mismatches.length > 0) {
      errors.push(
        issue(
          "IMPORT_ARTIFACT_CONTENT_MISMATCH",
          `Import artifact content-address metadata does not match content: ${mismatches.join(", ")}.`,
          `importArtifacts.${index}`,
        ),
      );
    }
  });

  tableRows(payload, "importBatches").forEach((row, index) => {
    if (!isRecord(row)) return;
    const rawStorageKey = scalarKey(row.rawStorageKey);
    const batchRawSha256 = row.rawSha256 == null ? null : scalarKey(row.rawSha256);
    const batchRawBytes = row.rawBytes == null ? null : numberValue(row.rawBytes);
    if (batchRawSha256 && !rawStorageKey) {
      errors.push(
        issue(
          "MISSING_IMPORT_ARTIFACT_REFERENCE",
          "Import batch has raw archive metadata but no rawStorageKey.",
          `importBatches.${index}.rawStorageKey`,
        ),
      );
      return;
    }
    if (!rawStorageKey) return;
    const artifact = artifactsByStorageKey.get(rawStorageKey);
    if (!artifact) {
      errors.push(
        issue(
          "MISSING_IMPORT_ARTIFACT",
          "Import batch rawStorageKey does not have a matching archived import artifact.",
          `importBatches.${index}.rawStorageKey`,
        ),
      );
      return;
    }
    if (batchRawSha256 && batchRawSha256 !== artifact.rawSha256) {
      errors.push(issue("IMPORT_BATCH_ARTIFACT_MISMATCH", "Import batch rawSha256 does not match its archived artifact.", `importBatches.${index}.rawSha256`));
    }
    if (batchRawBytes != null && batchRawBytes !== artifact.rawBytes) {
      errors.push(issue("IMPORT_BATCH_ARTIFACT_MISMATCH", "Import batch rawBytes does not match its archived artifact.", `importBatches.${index}.rawBytes`));
    }
  });

  return errors;
}

function validateJournalScreenshotAssets(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const warnings: BackupRestoreDryRunIssue[] = [];
  const assets = isRecord(payload.assets) ? payload.assets.journalScreenshots : undefined;
  const journalCharts = tableRows(payload, "journalCharts").filter(isRecord);
  const chartRowsById = new Map(
    journalCharts
      .map((row) => [scalarKey(row.id), row] as const)
      .filter((entry): entry is [string, JsonRecord] => Boolean(entry[0])),
  );

  if (!Array.isArray(assets)) {
    errors.push(issue("MISSING_SCREENSHOT_ASSETS", "Backup assets.journalScreenshots must be an array.", "assets.journalScreenshots"));
    return { errors, warnings };
  }

  assets.forEach((asset, index) => {
    if (!isRecord(asset)) {
      errors.push(issue("INVALID_SCREENSHOT_ASSET", "Screenshot asset is not an object.", `assets.journalScreenshots.${index}`));
      return;
    }

    const screenshot = asset as JournalScreenshotBackupAsset;
    const chart = chartRowsById.get(screenshot.chartId);
    if (!chart) {
      errors.push(
        issue(
          "SCREENSHOT_CHART_MISSING",
          `Screenshot asset references missing journal chart ${screenshot.chartId}.`,
          `assets.journalScreenshots.${index}.chartId`,
        ),
      );
    }
    const chartJournalEntryId = chart ? scalarKey(chart.journalEntryId) : null;
    if (chartJournalEntryId && screenshot.journalEntryId !== chartJournalEntryId) {
      errors.push(
        issue(
          "SCREENSHOT_JOURNAL_ENTRY_MISMATCH",
          "Screenshot asset journalEntryId does not match its chart.",
          `assets.journalScreenshots.${index}.journalEntryId`,
        ),
      );
    }

    if (!screenshot.embedded) {
      errors.push(
        issue(
          "SCREENSHOT_NOT_EMBEDDED",
          screenshot.reason ?? "Screenshot asset is referenced but not embedded.",
          `assets.journalScreenshots.${index}`,
        ),
      );
      return;
    }

    if (typeof screenshot.dataUrl !== "string") {
      errors.push(issue("SCREENSHOT_DATA_URL_MISSING", "Embedded screenshot asset is missing dataUrl.", `assets.journalScreenshots.${index}.dataUrl`));
      return;
    }

    const parsed = inspectInlineDataUrl(screenshot.dataUrl);
    if (!parsed) {
      errors.push(issue("SCREENSHOT_DATA_URL_INVALID", "Embedded screenshot dataUrl is invalid.", `assets.journalScreenshots.${index}.dataUrl`));
      return;
    }

    if (screenshot.bytes !== parsed.bytes) {
      errors.push(issue("SCREENSHOT_BYTES_MISMATCH", "Embedded screenshot byte count does not match dataUrl.", `assets.journalScreenshots.${index}.bytes`));
    }
    if (screenshot.sha256 !== parsed.sha256) {
      errors.push(issue("SCREENSHOT_SHA256_MISMATCH", "Embedded screenshot sha256 does not match dataUrl.", `assets.journalScreenshots.${index}.sha256`));
    }
    if (screenshot.mimeType && screenshot.mimeType !== parsed.mimeType) {
      errors.push(issue("SCREENSHOT_MIME_MISMATCH", "Embedded screenshot MIME type does not match dataUrl.", `assets.journalScreenshots.${index}.mimeType`));
    }
  });

  journalCharts.forEach((chart, index) => {
    const chartId = scalarKey(chart.id);
    if (!chartId) return;
    const hasScreenshotReference = Boolean(scalarKey(chart.screenshotKey) || scalarKey(chart.screenshotUrl));
    if (!hasScreenshotReference) return;
    const matchingAssets = assets.filter((asset) => isRecord(asset) && scalarKey(asset.chartId) === chartId);
    if (matchingAssets.length === 0) {
      errors.push(
        issue(
          "SCREENSHOT_ASSET_MISSING",
          "Journal chart references a screenshot but no backup screenshot asset was exported.",
          `journalCharts.${index}`,
        ),
      );
    }
    if (matchingAssets.length > 1) {
      errors.push(
        issue(
          "SCREENSHOT_ASSET_DUPLICATE",
          "Journal chart has multiple screenshot backup assets.",
          `journalCharts.${index}`,
        ),
      );
    }
  });

  const manifestScreenshots = isRecord(payload.manifest) && isRecord(payload.manifest.assets) ? payload.manifest.assets.journalScreenshots : undefined;
  if (isRecord(manifestScreenshots)) {
    const total = numberValue(manifestScreenshots.total);
    const embedded = numberValue(manifestScreenshots.embedded);
    const actualEmbedded = assets.filter((asset) => isRecord(asset) && asset.embedded === true && typeof asset.dataUrl === "string").length;
    if (total != null && total !== assets.length) {
      errors.push(issue("SCREENSHOT_MANIFEST_TOTAL_MISMATCH", "Screenshot manifest total does not match assets.", "manifest.assets.journalScreenshots.total"));
    }
    if (embedded != null && embedded !== actualEmbedded) {
      errors.push(issue("SCREENSHOT_MANIFEST_EMBEDDED_MISMATCH", "Screenshot manifest embedded count does not match assets.", "manifest.assets.journalScreenshots.embedded"));
    }
  }

  return { errors, warnings };
}

function validateUniqueDomainKeys(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const specs: Array<{ table: BackupTableKey; fields: string[]; label: string }> = [
    { table: "closedTradeNotes", fields: ["groupKey"], label: "closed-trade note groupKey" },
    { table: "closedTradeLayouts", fields: ["closedTradeGroupKey"], label: "closed-trade chart layout groupKey" },
  ];

  for (const spec of specs) {
    const seen = new Set<string>();
    tableRows(payload, spec.table).forEach((row, index) => {
      if (!isRecord(row)) return;
      const key = compositeKey(row, spec.fields);
      if (!key) return;
      if (seen.has(key)) {
        errors.push(
          issue(
            "DUPLICATE_DOMAIN_KEY",
            `${spec.table} contains duplicate ${spec.label}.`,
            `${spec.table}.${index}`,
          ),
        );
      }
      seen.add(key);
    });
  }

  return errors;
}

function parseJsonField(value: unknown) {
  if (value == null || value === "") return { valid: true as const, parsed: null };
  if (typeof value !== "string") return { valid: false as const, parsed: null };
  try {
    return { valid: true as const, parsed: JSON.parse(value) as unknown };
  } catch {
    return { valid: false as const, parsed: null };
  }
}

function validateJsonStateFields(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const specs: Array<{ table: BackupTableKey; field: string; shape: "array" | "object" }> = [
    { table: "closedTradeLayouts", field: "panelsJson", shape: "array" },
    { table: "closedTradeAnnotations", field: "pointsJson", shape: "array" },
    { table: "closedTradeAnnotations", field: "styleJson", shape: "object" },
    { table: "journalCharts", field: "tradingViewLayoutJson", shape: "object" },
  ];

  for (const spec of specs) {
    tableRows(payload, spec.table).forEach((row, index) => {
      if (!isRecord(row)) return;
      const parsed = parseJsonField(row[spec.field]);
      if (!parsed.valid) {
        errors.push(issue("INVALID_JSON_STATE", `${spec.table}.${spec.field} must be valid JSON.`, `${spec.table}.${index}.${spec.field}`));
        return;
      }
      if (parsed.parsed == null) return;
      const hasExpectedShape = spec.shape === "array" ? Array.isArray(parsed.parsed) : isRecord(parsed.parsed);
      if (!hasExpectedShape) {
        errors.push(
          issue(
            "INVALID_JSON_STATE_SHAPE",
            `${spec.table}.${spec.field} must be a JSON ${spec.shape}.`,
            `${spec.table}.${index}.${spec.field}`,
          ),
        );
      }
    });
  }

  return errors;
}

function validateClosedTradeJournalLinks(payload: JsonRecord) {
  const errors: BackupRestoreDryRunIssue[] = [];
  const closedTradeKeys = new Set(
    tableRows(payload, "closedTrades")
      .filter(isRecord)
      .map((row) => scalarKey(row.groupKey))
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  );
  const seenReviewLinks = new Set<string>();

  tableRows(payload, "journalLinks").forEach((row, index) => {
    if (!isRecord(row)) return;
    const targetType = scalarKey(row.targetType);
    if (targetType !== "CLOSED_TRADE") return;
    const targetId = scalarKey(row.targetId);
    if (!targetId) {
      errors.push(issue("MISSING_CLOSED_TRADE_LINK_TARGET", "Closed-trade journal link requires targetId.", `journalLinks.${index}.targetId`));
      return;
    }
    if (!closedTradeKeys.has(targetId)) {
      errors.push(issue("BROKEN_CLOSED_TRADE_JOURNAL_LINK", "Closed-trade journal link references a missing closed trade.", `journalLinks.${index}.targetId`));
    }
    if (scalarKey(row.linkType) === "REVIEW_SOURCE") {
      if (seenReviewLinks.has(targetId)) {
        errors.push(
          issue(
            "DUPLICATE_CLOSED_TRADE_REVIEW_LINK",
            "Only one REVIEW_SOURCE journal link is allowed per closed trade.",
            `journalLinks.${index}.targetId`,
          ),
        );
      }
      seenReviewLinks.add(targetId);
    }
  });

  return errors;
}

function validateNonCanonicalRows(payload: JsonRecord) {
  return BACKUP_TABLES.filter((table) => !table.canonicalRows && tableRows(payload, table.key).length > 0).map((table) =>
    issue(
      "NON_CANONICAL_TABLE_ROWS",
      `${table.key} includes relation-expanded rows; restore should use canonical child tables as the source of truth.`,
      table.key,
    ),
  );
}

export function validateBackupRestoreDryRun(payload: unknown): BackupRestoreDryRunResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      errors: [issue("INVALID_BACKUP_PAYLOAD", "Backup payload must be an object.")],
      warnings: [],
      tableManifest: null,
    };
  }

  const tableManifest = buildBackupTableManifest(payload);
  const errors: BackupRestoreDryRunIssue[] = [];
  const warnings: BackupRestoreDryRunIssue[] = [];

  if (!tableManifest.complete) {
    for (const table of tableManifest.missingTables) {
      errors.push(issue("MISSING_BACKUP_TABLE", `Backup table ${table} is missing.`, table));
    }
    for (const key of tableManifest.extraArrayKeys) {
      errors.push(issue("EXTRA_BACKUP_ARRAY", `Unexpected top-level array ${key} is not part of the backup contract.`, key));
    }
  }

  errors.push(...validateBackupManifest(payload, tableManifest));

  const { errors: keyErrors, keySets } = validateRestoreKeys(payload);
  errors.push(...keyErrors);
  errors.push(...validateForeignKeys(payload, keySets));
  errors.push(...validateUniqueDomainKeys(payload));
  errors.push(...validateClosedTradeJournalLinks(payload));
  errors.push(...validateJsonStateFields(payload));
  errors.push(...validateImportArtifacts(payload));

  const screenshotValidation = validateJournalScreenshotAssets(payload);
  errors.push(...screenshotValidation.errors);
  warnings.push(...screenshotValidation.warnings);
  warnings.push(...validateNonCanonicalRows(payload));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    tableManifest,
  };
}
