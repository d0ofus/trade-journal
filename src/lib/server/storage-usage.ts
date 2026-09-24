import { prisma } from "@/lib/prisma";
import type { StorageUsage } from "@/lib/storage-usage";
import { parseR2AccountMetrics } from "./evidence-usage";

/** Aggregate in PostgreSQL: image contents, trade identities and credentials never leave this service. */
export async function loadStorageUsage(): Promise<StorageUsage> {
  const [database, payloads] = await Promise.allSettled([
    prisma.$queryRaw<{ currentBytes: bigint; branchBytes: bigint; cacheBytes: bigint; metricCacheBytes: bigint }[]>`
      SELECT pg_database_size(current_database())::bigint AS "currentBytes",
        (SELECT sum(pg_database_size(oid)) FROM pg_database WHERE NOT datistemplate)::bigint AS "branchBytes",
        (SELECT coalesce(sum(pg_total_relation_size(to_regclass(quote_ident(name)))),0) FROM unnest(ARRAY[
          'WorkstationCandleChunk','WorkstationCandleCoverage','WorkstationCandleJob','WorkstationCandleLease','WorkstationMetricCache'
        ]) name)::bigint AS "cacheBytes",
        coalesce(pg_total_relation_size(to_regclass('"WorkstationMetricCache"')),0)::bigint AS "metricCacheBytes"`,
    prisma.$queryRaw<({ [K in keyof NonNullable<StorageUsage["payloads"]>]: bigint })[]>`
      WITH reviews AS (
        SELECT CASE WHEN "workstationJson" IS JSON OBJECT THEN "workstationJson"::jsonb ELSE '{}'::jsonb END AS doc,
          ("workstationJson" IS NOT NULL AND NOT ("workstationJson" IS JSON OBJECT)) AS invalid
        FROM "ClosedTradeNote"
      ), images AS (
        SELECT "screenshotUrl" AS image, false AS workstation FROM "JournalChart" WHERE "screenshotUrl" IS NOT NULL
        UNION ALL
        SELECT e->>'image', true FROM reviews CROSS JOIN LATERAL
          jsonb_array_elements(CASE WHEN jsonb_typeof(doc->'evidence')='array' THEN doc->'evidence' ELSE '[]'::jsonb END) e
      ) SELECT
        coalesce(sum(octet_length(image)) FILTER (WHERE image LIKE 'data:image/%'),0)::bigint AS "inlineBytes",
        count(*) FILTER (WHERE image LIKE 'data:image/%')::bigint AS "inlineCount",
        coalesce(sum(octet_length(image)) FILTER (WHERE workstation AND image LIKE 'data:image/%'),0)::bigint AS "workstationInlineBytes",
        count(*) FILTER (WHERE workstation AND image LIKE 'data:image/%')::bigint AS "workstationInlineCount",
        count(*) FILTER (WHERE image ~ '^https?://')::bigint AS "externalCount",
        count(*) FILTER (WHERE image LIKE '/journal-screenshots/%')::bigint AS "localCount",
        (SELECT count(*) FROM reviews WHERE invalid)::bigint AS "invalidReviews",
        (SELECT coalesce(sum(octet_length(content)),0) FROM "ImportArtifact")::bigint AS "importBytes",
        (SELECT count(*) FROM "ImportArtifact")::bigint AS "importCount"
      FROM images`,
  ]);
  const issues: string[] = [];
  const numeric = <T extends Record<string, bigint>>(row: T) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  if (database.status === "rejected") issues.push("Database size measurements are unavailable.");
  if (payloads.status === "rejected") issues.push("Attachment and import measurements are unavailable.");
  if (database.status === "rejected" && payloads.status === "rejected") throw new Error("Storage measurements unavailable.");
  const result: StorageUsage = {
    measuredAt: new Date().toISOString(),
    database: database.status === "fulfilled" ? numeric(database.value[0]) as StorageUsage["database"] : null,
    payloads: payloads.status === "fulfilled" ? numeric(payloads.value[0]) as StorageUsage["payloads"] : null,
    issues,
  };
  if (result.payloads?.invalidReviews) issues.push(`${result.payloads.invalidReviews} unreadable review documents were excluded from attachment totals.`);
  try {
    const [assets, pending, snapshot] = await Promise.all([
      prisma.evidenceAsset.aggregate({ where: { state: "ready" }, _sum: { bytes: true, thumbnailBytes: true }, _count: true }),
      prisma.evidenceUploadSession.aggregate({ where: { state: { in: ["pending", "verifying"] } }, _sum: { expectedBytes: true } }),
      prisma.evidenceMaintenanceState.findUnique({ where: { key: "r2-account-usage" } }),
    ]);
    const saved = snapshot?.payload as { measuredAt?: string; metrics?: unknown } | undefined;
    const counters = parseR2AccountMetrics(saved?.metrics), measuredAt = saved?.measuredAt && Number.isFinite(Date.parse(saved.measuredAt)) ? saved.measuredAt : null;
    const standardBytes = counters?.standardBytes ?? 0;
    result.evidence = { originals: assets._sum.bytes ?? 0, thumbnails: assets._sum.thumbnailBytes ?? 0, assets: assets._count, pending: pending._sum.expectedBytes ?? 0, account: measuredAt && counters ? { measuredAt, standardBytes, otherClassBytes: counters.otherClassBytes, stale: Date.now() - Date.parse(measuredAt) > 36 * 3600_000, warning: standardBytes >= 10e9 ? "Above 10 GB: additional Standard storage is metered; uploads continue." : standardBytes >= 9e9 ? "Above 9 GB account-wide usage." : standardBytes >= 8e9 ? "Above 8 GB account-wide usage." : null, estimatedMonthlyStorageUsd: Math.max(0, Math.ceil(standardBytes / 1e9) - 10) * .015 } : null };
  } catch { issues.push("Private image storage measurements are unavailable; no zero-usage assumption was made."); }
  return result;
}
