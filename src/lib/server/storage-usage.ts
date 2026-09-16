import { prisma } from "@/lib/prisma";
import type { StorageUsage } from "@/lib/storage-usage";

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
  return result;
}
