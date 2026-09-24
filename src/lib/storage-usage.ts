export const STORAGE_REFRESH_MS = 60_000;
export const STORAGE_STALE_MS = 120_000;
export const R2_REFRESH_MS = 15 * 60_000;
export const R2_STALE_MS = 30 * 60_000;
export const STORAGE_CHANGED_EVENT = "trade-journal:storage-changed";

export type R2AccountUsage = {
  measuredAt: string; standardBytes: number; otherClassBytes: number | null;
  stale: boolean; warning: string | null; estimatedMonthlyStorageUsd: number;
  nextRefreshAt?: string; lastAttemptAt?: string | null; error?: string | null;
};
export type StorageGroupKey = "database" | "payloads" | "activity" | "workstation" | "legacy" | "candles" | "evidence" | "backup";
export type MeasurementState = { measuredAt: string | null; complete: boolean; error: string | null };
export type StorageUsage = {
  evidence?: { originals: number; thumbnails: number; assets: number; pending: number; account: R2AccountUsage | null;
    retainedAssets?: number; retainedOriginalBytes?: number; pendingCount?: number; expiredUploads?: number;
    deletingAssets?: number; backupPartBytes?: number; backupParts?: number; invalidBackupManifests?: number;
    accountError?: string | null; accountNextRefreshAt?: string | null;
  } | null;
  measuredAt: string;
  database: { currentBytes: number; branchBytes: number; cacheBytes: number; metricCacheBytes: number } | null;
  payloads: { inlineBytes: number; inlineCount: number; workstationInlineBytes: number; workstationInlineCount: number; externalCount: number; localCount: number; invalidReviews: number; importBytes: number; importCount: number } | null;
  activity?: { executions: number; activeTrades: number; allTrades: number; staleTrades: number; failedImports: number;
    processingFailures: number; importsWithSkippedRows: number; parserErrors: number; rawImportBytes: number;
    archivedRawBytes: number; importArtifacts: number; missingRawArchives: number; legacyRawImports: number; latestStaleTradeAt: string | null;
  } | null;
  workstation?: { reviews: number; drawings: number; comparisonDrawings: number; evidenceEntries: number; r2EvidenceEntries: number;
    inlineImages: number; invalidReviews: number; brokenAssetReferences: number; jsonBytes: number;
  } | null;
  legacy?: { journalEntries: number; journalCharts: number; drawings: number; inlineImages: number;
    inlineEncodedBytes: number; localImages: number; externalImages: number; invalidInlineImages: number;
  } | null;
  candles?: { legacyRows: number; chunks: number; storedBars: number } | null;
  backup?: { latestDataChangeAt: string | null; tableCount: number; totalRows: number; requiredR2Originals: number;
    databaseFreshness: "current" | "needs-backup" | "unverified";
    latestAudit: { sha256: string; exportedAt: string; verifiedAt: string; payloadBytes: number; totalRows: number; tableCount: number; warningCount: number; errorCount: number } | null;
  } | null;
  groups?: Partial<Record<StorageGroupKey, MeasurementState>>;
  issues: string[];
};

export const STORAGE_GROUPS: StorageGroupKey[] = ["database", "payloads", "activity", "workstation", "legacy", "candles", "evidence", "backup"];

/** A partial failure must not erase a group's last good values or move its timestamp forward. */
export function mergeStorageUsage(previous: StorageUsage | null, next: StorageUsage): StorageUsage {
  if (!previous) return next;
  const merged = { ...next, groups: { ...next.groups } };
  for (const key of STORAGE_GROUPS) {
    if (next[key] == null && previous[key] != null) {
      Object.assign(merged, { [key]: previous[key] });
      merged.groups[key] = {
        measuredAt: previous.groups?.[key]?.measuredAt ?? previous.measuredAt,
        complete: false,
        error: next.groups?.[key]?.error ?? "Refresh failed; showing the previous reading.",
      };
    }
  }
  if (merged.evidence && !merged.evidence.account && previous.evidence?.account && merged.evidence.accountError) {
    merged.evidence = { ...merged.evidence, account: previous.evidence.account,
      accountNextRefreshAt: merged.evidence.accountNextRefreshAt ?? previous.evidence.accountNextRefreshAt };
  }
  return merged;
}

export function measurementIsStale(state: MeasurementState | undefined, now: number) {
  return !state?.measuredAt || !Number.isFinite(Date.parse(state.measuredAt)) || now - Date.parse(state.measuredAt) >= STORAGE_STALE_MS;
}
export function storageGuard(bytes: number, kind: "cache" | "branch") {
  const limit = kind === "cache" ? 100_000_000 : 400_000_000;
  const warningAt = kind === "cache" ? 80_000_000 : 350_000_000;
  const pauseAt = limit - 1_000_000;
  return { limit, warningAt, pauseAt, remaining: Math.max(0, limit - bytes), percent: Math.min(100, bytes / limit * 100), status: bytes >= pauseAt ? "Paused" : bytes >= warningAt ? "Warning" : "Within guard" };
}
