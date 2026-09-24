export type StorageUsage = {
  evidence?: { originals: number; thumbnails: number; assets: number; pending: number; account: { measuredAt: string; standardBytes: number; otherClassBytes: number | null; stale: boolean; warning: string | null; estimatedMonthlyStorageUsd: number } | null };
  measuredAt: string;
  database: { currentBytes: number; branchBytes: number; cacheBytes: number; metricCacheBytes: number } | null;
  payloads: { inlineBytes: number; inlineCount: number; workstationInlineBytes: number; workstationInlineCount: number; externalCount: number; localCount: number; invalidReviews: number; importBytes: number; importCount: number } | null;
  issues: string[];
};
export function storageGuard(bytes: number, kind: "cache" | "branch") {
  const limit = kind === "cache" ? 100_000_000 : 400_000_000;
  const warningAt = kind === "cache" ? 80_000_000 : 350_000_000;
  const pauseAt = limit - 1_000_000;
  return { limit, warningAt, pauseAt, remaining: Math.max(0, limit - bytes), percent: Math.min(100, bytes / limit * 100), status: bytes >= pauseAt ? "Paused" : bytes >= warningAt ? "Warning" : "Within guard" };
}
