import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STORAGE_GROUPS, type StorageGroupKey, type StorageUsage } from "@/lib/storage-usage";
import { BACKUP_TABLES, type BackupTableKey } from "./backup-contract";
import { BACKUP_RELEVANT_TIMESTAMP_SOURCES, buildBackupSourceMetadata } from "./backup-freshness";
import { readR2AccountUsage } from "./r2-account-metrics";
import { readPhysicalStorage } from "./storage-physical";

type ContentSnapshot = Pick<StorageUsage, "activity" | "workstation" | "legacy" | "candles" | "payloads" | "evidence"> & { measuredAt: Date };

/** One SQL statement gives related review/asset counts one MVCC snapshot. No contents leave PostgreSQL. */
async function contentSnapshot(): Promise<ContentSnapshot> {
  const rows = await prisma.$queryRaw<ContentSnapshot[]>`
    WITH raw_reviews AS MATERIALIZED (
      SELECT "groupKey", "workstationJson", CASE WHEN "workstationJson" IS JSON OBJECT THEN "workstationJson"::jsonb END doc
      FROM "ClosedTradeNote" WHERE "workstationJson" IS NOT NULL
    ), inspected AS MATERIALIZED (
      SELECT *, coalesce(doc IS NOT NULL
        AND (doc->'drawings' IS NULL OR jsonb_typeof(doc->'drawings')='array')
        AND (doc->'evidence' IS NULL OR jsonb_typeof(doc->'evidence')='array')
        AND (doc->'comparison' IS NULL OR jsonb_typeof(doc->'comparison')='object')
        AND (doc#>'{comparison,drawings}' IS NULL OR jsonb_typeof(doc#>'{comparison,drawings}')='object')
        AND NOT EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(doc#>'{comparison,drawings}')='object' THEN doc#>'{comparison,drawings}' ELSE '{}'::jsonb END) d WHERE jsonb_typeof(d.value)<>'array')
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(doc->'evidence')='array' THEN doc->'evidence' ELSE '[]'::jsonb END) e WHERE jsonb_typeof(e)<>'object')
      ,false) valid FROM raw_reviews
    ), reviews AS MATERIALIZED (SELECT * FROM inspected WHERE valid), evidence AS MATERIALIZED (
      SELECT r."groupKey", e FROM reviews r CROSS JOIN LATERAL jsonb_array_elements(coalesce(doc->'evidence','[]'::jsonb)) e
    ), asset_links AS MATERIALIZED (
      SELECT e.*, a.id matched FROM evidence e LEFT JOIN "EvidenceAsset" a
        ON e.e#>>'{asset,id}'=a.id AND a."tradeId"=e."groupKey" AND a.state='ready' AND e.e#>>'{asset,storage}'='r2'
      WHERE e.e->'asset' IS NOT NULL AND e.e->'asset'<>'null'::jsonb
    ), images AS MATERIALIZED (
      SELECT "screenshotUrl" image, "screenshotKey" key, false workstation FROM "JournalChart"
      UNION ALL SELECT e->>'image', NULL, true FROM evidence
    ), backup_parts AS MATERIALIZED (
      SELECT part FROM "EvidenceBackupSession" s CROSS JOIN LATERAL
        jsonb_array_elements(CASE WHEN jsonb_typeof(s.manifest->'parts')='array' THEN s.manifest->'parts' ELSE '[]'::jsonb END) part
    ), backup_part_sizes AS (
      SELECT CASE WHEN jsonb_typeof(part->'bytes')='number' AND (part->>'bytes') ~ '^[0-9]{1,15}$' THEN (part->>'bytes')::bigint END bytes FROM backup_parts
    ) SELECT statement_timestamp() AS "measuredAt",
    jsonb_build_object(
      'executions',(SELECT count(*) FROM "Execution"),
      'activeTrades',(SELECT count(*) FROM "ClosedTrade" WHERE NOT "isStale"),
      'allTrades',(SELECT count(*) FROM "ClosedTrade"),
      'staleTrades',(SELECT count(*) FROM "ClosedTrade" WHERE "isStale"),
      'latestStaleTradeAt',(SELECT max("staleAt") AT TIME ZONE 'UTC' FROM "ClosedTrade"),
      'failedImports',(SELECT count(*) FROM "ImportBatch" WHERE status='FAILED'),
      'processingFailures',(SELECT count(*) FROM "ImportBatch" WHERE status='MATERIALIZATION_FAILED'),
      'importsWithSkippedRows',(SELECT count(*) FROM "ImportBatch" WHERE "rowsSkipped">0 AND status IN ('SUCCEEDED','ROWS_APPLIED','MATERIALIZED','MATERIALIZATION_FAILED')),
      'parserErrors',(SELECT count(*) FROM "ImportRowError"),
      'rawImportBytes',(SELECT coalesce(sum("rawBytes"),0) FROM "ImportBatch"),
      'archivedRawBytes',(SELECT coalesce(sum("rawBytes"),0) FROM "ImportArtifact"),
      'importArtifacts',(SELECT count(*) FROM "ImportArtifact"),
      'missingRawArchives',(SELECT count(*) FROM "ImportBatch" WHERE "rawSha256" IS NOT NULL AND "rawStorageKey" IS NULL),
      'legacyRawImports',(SELECT count(*) FROM "ImportBatch" WHERE "rawSha256" IS NULL)
    ) activity,
    jsonb_build_object(
      'reviews',(SELECT count(*) FROM reviews),
      'drawings',(SELECT coalesce(sum(jsonb_array_length(coalesce(doc->'drawings','[]'::jsonb))),0) FROM reviews),
      'comparisonDrawings',(SELECT coalesce(sum(jsonb_array_length(d.value)),0) FROM reviews CROSS JOIN LATERAL jsonb_each(coalesce(doc#>'{comparison,drawings}','{}'::jsonb)) d),
      'evidenceEntries',(SELECT count(*) FROM evidence),
      'r2EvidenceEntries',(SELECT count(*) FROM asset_links WHERE matched IS NOT NULL),
      'inlineImages',(SELECT count(*) FROM evidence WHERE e->>'image' LIKE 'data:image/%'),
      'invalidReviews',(SELECT count(*) FROM inspected WHERE NOT valid),
      'brokenAssetReferences',(SELECT count(*) FROM asset_links WHERE matched IS NULL),
      'jsonBytes',(SELECT coalesce(sum(octet_length("workstationJson")),0) FROM raw_reviews)
    ) workstation,
    jsonb_build_object(
      'journalEntries',(SELECT count(*) FROM "JournalEntry"), 'journalCharts',(SELECT count(*) FROM "JournalChart"),
      'drawings',(SELECT count(*) FROM "ClosedTradeAnnotation"),
      'inlineImages',(SELECT count(*) FROM images WHERE NOT workstation AND image LIKE 'data:%'),
      'inlineEncodedBytes',(SELECT coalesce(sum(octet_length(image)),0) FROM images WHERE NOT workstation AND image LIKE 'data:%'),
      'localImages',(SELECT count(*) FROM images WHERE NOT workstation AND (key LIKE 'local:%' OR image LIKE '/journal-screenshots/%')),
      'externalImages',(SELECT count(*) FROM images WHERE NOT workstation AND coalesce(image,'') NOT LIKE 'data:%' AND coalesce(key,'') NOT LIKE 'local:%' AND coalesce(image,'') NOT LIKE '/journal-screenshots/%' AND (coalesce(key,'')<>'' OR coalesce(image,'')<>'')),
      'invalidInlineImages',(SELECT count(*) FROM images WHERE NOT workstation AND image LIKE 'data:%' AND (image !~ '^data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$' OR length(split_part(image,',',2)) % 4 <> 0))
    ) legacy,
    jsonb_build_object(
      'legacyRows',(SELECT count(*) FROM "MarketCandle"), 'chunks',(SELECT count(*) FROM "WorkstationCandleChunk"),
      'storedBars',(SELECT coalesce(sum("barCount"),0) FROM "WorkstationCandleChunk")
    ) candles,
    jsonb_build_object(
      'inlineBytes',(SELECT coalesce(sum(octet_length(image)),0) FROM images WHERE image LIKE 'data:image/%'),
      'inlineCount',(SELECT count(*) FROM images WHERE image LIKE 'data:image/%'),
      'workstationInlineBytes',(SELECT coalesce(sum(octet_length(image)),0) FROM images WHERE workstation AND image LIKE 'data:image/%'),
      'workstationInlineCount',(SELECT count(*) FROM images WHERE workstation AND image LIKE 'data:image/%'),
      'externalCount',(SELECT count(*) FROM images WHERE image ~ '^https?://'),
      'localCount',(SELECT count(*) FROM images WHERE image LIKE '/journal-screenshots/%' OR key LIKE 'local:%'),
      'invalidReviews',(SELECT count(*) FROM inspected WHERE NOT valid),
      'importBytes',(SELECT coalesce(sum(octet_length(content)),0) FROM "ImportArtifact"),
      'importCount',(SELECT count(*) FROM "ImportArtifact")
    ) payloads,
    jsonb_build_object(
      'assets',(SELECT count(*) FROM "EvidenceAsset" WHERE state='ready'),
      'originals',(SELECT coalesce(sum(bytes),0) FROM "EvidenceAsset" WHERE state='ready'),
      'thumbnails',(SELECT coalesce(sum("thumbnailBytes"),0) FROM "EvidenceAsset" WHERE state='ready'),
      'retainedAssets',(SELECT count(*) FROM "EvidenceAsset" a WHERE state='ready' AND NOT EXISTS (SELECT 1 FROM asset_links l WHERE l.matched=a.id)),
      'retainedOriginalBytes',(SELECT coalesce(sum(bytes),0) FROM "EvidenceAsset" a WHERE state='ready' AND NOT EXISTS (SELECT 1 FROM asset_links l WHERE l.matched=a.id)),
      'deletingAssets',(SELECT count(*) FROM "EvidenceAsset" WHERE state='deleting'),
      'pending',(SELECT coalesce(sum("expectedBytes"),0) FROM "EvidenceUploadSession" WHERE state IN ('pending','verifying') AND "expiresAt">(statement_timestamp() AT TIME ZONE 'UTC')),
      'pendingCount',(SELECT count(*) FROM "EvidenceUploadSession" WHERE state IN ('pending','verifying') AND "expiresAt">(statement_timestamp() AT TIME ZONE 'UTC')),
      'expiredUploads',(SELECT count(*) FROM "EvidenceUploadSession" WHERE "expiresAt"<=(statement_timestamp() AT TIME ZONE 'UTC')),
      'backupPartBytes',(SELECT coalesce(sum(bytes),0) FROM backup_part_sizes),
      'backupParts',(SELECT count(*) FROM backup_part_sizes WHERE bytes IS NOT NULL),
      'invalidBackupManifests',(SELECT count(*) FROM "EvidenceBackupSession" WHERE jsonb_typeof(manifest->'parts') IS DISTINCT FROM 'array') + (SELECT count(*) FROM backup_part_sizes WHERE bytes IS NULL),
      'account',NULL
    ) evidence`;
  return rows[0];
}

// Identifiers below come only from the checked-in backup contract, never from request input.
const identifier = (value: string) => Prisma.raw('"' + value.replaceAll('"', '""') + '"');
async function backupSnapshot() {
  const counts = BACKUP_TABLES.map(table => {
    const where = table.key === "evidenceAssets" || table.key === "evidenceUploadSessions" ? Prisma.sql`WHERE state='ready'`
      : table.key === "evidenceAssetReferences" ? Prisma.sql`WHERE kind<>'backup'` : Prisma.empty;
    // MarketCandle is intentionally excluded from portable backups.
    return table.key === "marketCandles" ? Prisma.sql`SELECT ${table.key}::text key, 0::bigint count`
      : Prisma.sql`SELECT ${table.key}::text key, count(*)::bigint count FROM ${identifier(table.prismaModel)} ${where}`;
  });
  const timestamps = BACKUP_RELEVANT_TIMESTAMP_SOURCES.flatMap(source => source.timestampFields.map(field =>
    Prisma.sql`SELECT max(${identifier(field)}) AS value FROM ${identifier(source.prismaModel)}`));
  const [row] = await prisma.$queryRaw<{ measuredAt: Date; latestDataChangeAt: Date | null; counts: Record<BackupTableKey, number>; audit: (NonNullable<StorageUsage["backup"]>["latestAudit"] & { sourceSignature: string | null; sourceLatestDataChangeAt: string | null }) | null }[]>(Prisma.sql`
    SELECT statement_timestamp() AS "measuredAt", (SELECT max(value) FROM (${Prisma.join(timestamps, " UNION ALL ")}) t) AS "latestDataChangeAt",
      (SELECT jsonb_object_agg(key,count) FROM (${Prisma.join(counts, " UNION ALL ")}) c) counts,
      (SELECT jsonb_build_object('sha256',"sha256",'exportedAt',"exportedAt" AT TIME ZONE 'UTC','verifiedAt',"verifiedAt" AT TIME ZONE 'UTC','payloadBytes',"payloadBytes",'totalRows',"totalRows",'tableCount',"tableCount",'warningCount',"warningCount",'errorCount',"errorCount",'sourceSignature',"sourceSignature",'sourceLatestDataChangeAt',"sourceLatestDataChangeAt" AT TIME ZONE 'UTC') FROM "BackupAudit" ORDER BY "verifiedAt" DESC LIMIT 1) audit`);
  const latest = row.latestDataChangeAt?.toISOString() ?? null;
  const signature = buildBackupSourceMetadata({ latestDataChangeAt: latest, rowCounts: row.counts }).signature;
  const current = row.audit && !row.audit.errorCount && (row.audit.sourceSignature ? row.audit.sourceSignature === signature
    : !latest || Date.parse(row.audit.exportedAt) >= Date.parse(latest));
  const audit = row.audit && { sha256: row.audit.sha256, exportedAt: row.audit.exportedAt, verifiedAt: row.audit.verifiedAt,
    payloadBytes: row.audit.payloadBytes, totalRows: row.audit.totalRows, tableCount: row.audit.tableCount, warningCount: row.audit.warningCount, errorCount: row.audit.errorCount };
  return { measuredAt: row.measuredAt.toISOString(), value: { latestDataChangeAt: latest, tableCount: BACKUP_TABLES.length,
    totalRows: Object.values(row.counts).reduce((sum, count) => sum + count, 0), requiredR2Originals: row.counts.evidenceAssets ?? 0,
    databaseFreshness: !row.audit ? "unverified" : current ? "current" : "needs-backup", latestAudit: audit,
  } satisfies NonNullable<StorageUsage["backup"]> };
}

/** Read-only aggregates. Cloudflare network requests and destructive maintenance never run here. */
export async function loadStorageUsage(): Promise<StorageUsage> {
  const [database, content, backup, account] = await Promise.allSettled([
    readPhysicalStorage(),
    contentSnapshot(), backupSnapshot(), readR2AccountUsage(),
  ]);
  const result: StorageUsage = { measuredAt: new Date().toISOString(), database: null, payloads: null, groups: {}, issues: [] };
  const success = (key: StorageGroupKey, measuredAt: string, error: string | null = null) => {
    result.groups![key] = { measuredAt, complete: !error, error };
    if (error) result.issues.push(error);
  };
  if (database.status === "fulfilled") {
    const { measuredAt, ...sizes } = database.value;
    result.database = Object.fromEntries(Object.entries(sizes).map(([key, value]) => [key, Number(value)])) as NonNullable<StorageUsage["database"]>;
    success("database", measuredAt.toISOString());
  }
  if (content.status === "fulfilled") {
    const { measuredAt, ...values } = content.value;
    Object.assign(result, values);
    for (const key of ["activity", "workstation", "legacy", "candles", "payloads", "evidence"] as const) success(key, measuredAt.toISOString());
    const invalid = result.workstation!.invalidReviews, broken = result.workstation!.brokenAssetReferences;
    if (invalid || broken) {
      const issue = `${invalid} unreadable review document(s) excluded; ${broken} broken asset reference(s). Review-linked totals may be incomplete.`;
      for (const key of ["workstation", "payloads", "evidence"] as const) success(key, measuredAt.toISOString(), issue);
    }
    if (result.evidence!.invalidBackupManifests) success("evidence", measuredAt.toISOString(), "Some backup-part sizes are unreadable and were excluded.");
    if (account.status === "fulfilled") Object.assign(result.evidence!, { account: account.value.account, accountError: account.value.error, accountNextRefreshAt: account.value.nextRefreshAt });
    else result.evidence!.accountError = "Cloudflare's stored reading is unavailable.";
  }
  if (backup.status === "fulfilled") { result.backup = backup.value.value; success("backup", backup.value.measuredAt); }
  for (const key of STORAGE_GROUPS) if (!result.groups![key]) {
    const error = `${key === "database" ? "Database size" : key[0].toUpperCase() + key.slice(1)} measurements are unavailable.`;
    result.groups![key] = { measuredAt: null, complete: false, error }; result.issues.push(error);
  }
  result.issues = [...new Set(result.issues)];
  if (!STORAGE_GROUPS.some(key => result[key] != null)) throw new Error("Storage measurements unavailable.");
  return result;
}
