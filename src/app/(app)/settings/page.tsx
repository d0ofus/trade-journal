import { FlexRunButton } from "@/components/flex-run-button";
import { ImportHistoryList } from "@/components/import-history-list";
import { BackupActions } from "@/components/backup-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getSettingsData } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatOptionalBytes(value: number | null) {
  return value == null ? "Unavailable" : formatBytes(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function HealthItem({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3" data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReadinessItem({ label, value, complete, testId }: { label: string; value: string; complete: boolean; testId?: string }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${complete ? "border-emerald-200 bg-emerald-50/80" : "border-amber-200 bg-amber-50/80"}`}
      data-testid={testId}
    >
      <p className={`text-xs font-semibold uppercase ${complete ? "text-emerald-700" : "text-amber-700"}`}>{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export default async function SettingsPage() {
  const { accounts, batches, backupReadiness, health } = await getSettingsData({ includeBackupReadiness: true });
  const flexConfigured = Boolean(process.env.IBKR_FLEX_TOKEN && process.env.IBKR_FLEX_QUERY_ID);
  const screenshotReadiness = backupReadiness?.assets.journalScreenshots;
  const importReadiness = backupReadiness?.assets.importArtifacts;
  const tableReadiness = backupReadiness?.tables;
  const backupComplete = Boolean(screenshotReadiness?.complete && importReadiness?.complete && tableReadiness?.complete);
  const latestBackupAudit = health.latestBackupAudit;
  const latestDataChangeTime = timestamp(health.latestBackupRelevantUpdateAt);
  const latestBackupExportTime = timestamp(latestBackupAudit?.exportedAt);
  const backupSourceMatches = Boolean(
    latestBackupAudit?.sourceSignature &&
      health.backupSourceSignature &&
      latestBackupAudit.sourceSignature === health.backupSourceSignature,
  );
  const backupTimestampCoversData = latestDataChangeTime == null || (latestBackupExportTime != null && latestBackupExportTime >= latestDataChangeTime);
  const backupFreshnessCurrent = Boolean(
    latestBackupAudit &&
      (backupSourceMatches || (!latestBackupAudit.sourceSignature && backupTimestampCoversData)),
  );
  const backupFreshnessLabel = latestBackupAudit ? (backupFreshnessCurrent ? "Current" : "Needs Backup") : "No Verified Backup";
  const backupFreshnessDetail = latestBackupAudit
    ? backupFreshnessCurrent
      ? "Last verified backup covers the latest tracked data change."
      : "Data changed after the last verified backup export."
    : "Run Download & Verify to record backup freshness.";
  const reviewArtifactCounts = [
    { label: "Review Notes", value: tableReadiness?.rowCounts.closedTradeNotes ?? 0 },
    { label: "Chart Layouts", value: tableReadiness?.rowCounts.closedTradeLayouts ?? 0 },
    { label: "Drawing States", value: tableReadiness?.rowCounts.closedTradeAnnotationStates ?? 0 },
    { label: "Drawings", value: tableReadiness?.rowCounts.closedTradeAnnotations ?? 0 },
    { label: "Review Tags", value: tableReadiness?.rowCounts.closedTradeTags ?? 0 },
    { label: "Linked Executions", value: tableReadiness?.rowCounts.closedTradeExecutions ?? 0 },
    { label: "Journal Links", value: tableReadiness?.rowCounts.journalLinks ?? 0 },
  ];
  const backupWarnings = [
    ...(screenshotReadiness?.warnings.map((warning) => `Screenshot ${warning.chartId}: ${warning.reason}`) ?? []),
    ...(importReadiness?.warnings.map((warning) => {
      const subject = warning.filename ?? warning.storageKey ?? warning.batchId ?? "import artifact";
      return `${warning.type.replaceAll("_", " ")}: ${subject}`;
    }) ?? []),
    ...(tableReadiness?.missingTables.map((table) => `Missing backup table: ${table}`) ?? []),
    ...(tableReadiness?.extraArrayKeys.map((key) => `Unexpected backup array: ${key}`) ?? []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Configuration and import controls in one polished workspace."
        description="Account references, Flex automation, and import history remain backed by the same data sources and routes."
      />

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6 text-sm">
          {accounts.length === 0 && <p className="text-slate-500">No accounts imported yet.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              <p className="font-medium text-slate-900">{account.name}</p>
              <p className="text-slate-600">{account.ibkrAccount}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">IBKR Flex Auto Import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-6 text-sm">
          <p className="text-slate-700">
            Status: {flexConfigured ? "Configured" : "Missing IBKR_FLEX_TOKEN / IBKR_FLEX_QUERY_ID env vars"}
          </p>
          <p className="text-slate-600">
            Scheduled endpoint: <code>/api/cron/flex-import</code> (protect with <code>CRON_SECRET</code>).
          </p>
          <FlexRunButton />
        </CardContent>
      </Card>

      <Card className="overflow-hidden" data-testid="settings-storage-health">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Storage Health & Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-6 text-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HealthItem label="Database Size" value={formatOptionalBytes(health.databaseSizeBytes)} testId="storage-health-db-size" />
            <HealthItem label="Executions" value={health.executionCount.toLocaleString()} />
            <HealthItem label="Closed Trades" value={health.activeClosedTradeCount.toLocaleString()} />
            <HealthItem label="All Closed Trades" value={health.allClosedTradeCount.toLocaleString()} />
            <HealthItem label="Stale Trades" value={health.staleClosedTradeCount.toLocaleString()} testId="storage-health-stale-closed-trades" />
            <HealthItem label="Drawings" value={health.annotationCount.toLocaleString()} />
            <HealthItem label="Journal Entries" value={health.journalEntryCount.toLocaleString()} />
            <HealthItem label="Journal Charts" value={health.journalChartCount.toLocaleString()} />
            <HealthItem label="Candle Rows" value={health.marketCandleCount.toLocaleString()} testId="storage-health-candle-rows" />
            <HealthItem label="Failed / Rolled Back Imports" value={health.failedImportBatchCount.toLocaleString()} />
            <HealthItem label="Materialization Failures" value={health.materializationFailedImportBatchCount.toLocaleString()} />
            <HealthItem label="Imports With Unapplied Rows" value={health.skippedImportBatchCount.toLocaleString()} />
            <HealthItem label="Parser Row Errors" value={health.importRowErrorCount.toLocaleString()} />
            <HealthItem label="Inline Screenshots" value={health.inlineScreenshotCount.toLocaleString()} />
            <HealthItem label="Invalid Inline Images" value={health.invalidInlineScreenshotCount.toLocaleString()} />
            <HealthItem label="Local Screenshots" value={health.localScreenshotCount.toLocaleString()} />
            <HealthItem label="External Screenshots" value={health.externalScreenshotCount.toLocaleString()} />
            <HealthItem label="Inline Image Bytes" value={formatBytes(health.inlineScreenshotBytes)} testId="storage-health-inline-screenshot-bytes" />
            <HealthItem label="Raw Import Bytes" value={formatBytes(health.rawImportBytes)} />
            <HealthItem label="Archived Raw Bytes" value={formatBytes(health.rawArchivedBytes)} testId="storage-health-import-artifact-bytes" />
            <HealthItem label="Import Artifacts" value={health.importArtifactCount.toLocaleString()} />
            <HealthItem label="Missing Raw Archives" value={health.missingRawArchiveCount.toLocaleString()} />
            <HealthItem label="Legacy Raw Imports" value={health.legacyRawArchiveCount.toLocaleString()} />
            <HealthItem label="Latest Data Change" value={formatDateTime(health.latestBackupRelevantUpdateAt)} testId="storage-health-latest-change" />
            <HealthItem label="Latest Stale Trade" value={formatDateTime(health.latestStaleClosedTradeAt)} testId="storage-health-latest-stale" />
          </div>
          {backupReadiness && screenshotReadiness && importReadiness ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" data-testid="backup-readiness">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Backup Readiness</p>
                  <p className="text-xs text-slate-600">
                    {backupComplete ? "Ready for export with all referenced assets verified." : "Export warnings need review before relying on this backup."}
                  </p>
                </div>
                <p className={`text-sm font-semibold ${backupComplete ? "text-emerald-700" : "text-amber-700"}`}>
                  {backupComplete ? "Complete" : "Warnings"}
                </p>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ReadinessItem label="Backup Status" value={backupComplete ? "Complete" : "Warnings"} complete={backupComplete} testId="backup-readiness-status" />
                <ReadinessItem label="Readiness Generated" value={formatDateTime(backupReadiness.generatedAt)} complete={backupComplete} testId="backup-readiness-freshness" />
                <ReadinessItem
                  label="Backup Freshness"
                  value={backupFreshnessLabel}
                  complete={backupFreshnessCurrent}
                  testId="backup-freshness-status"
                />
                <ReadinessItem
                  label="Latest Verified Backup"
                  value={formatDateTime(latestBackupAudit?.verifiedAt)}
                  complete={backupFreshnessCurrent}
                  testId="backup-latest-verified"
                />
                <ReadinessItem
                  label="Latest Verified SHA"
                  value={latestBackupAudit?.sha256 ? latestBackupAudit.sha256.slice(0, 12) : "-"}
                  complete={backupFreshnessCurrent}
                  testId="backup-latest-sha"
                />
                <ReadinessItem
                  label="Latest Backup Size"
                  value={latestBackupAudit ? formatBytes(latestBackupAudit.payloadBytes) : "-"}
                  complete={backupFreshnessCurrent}
                  testId="backup-latest-payload-bytes"
                />
                <ReadinessItem
                  label="Backup Covers Through"
                  value={formatDateTime(latestBackupAudit?.exportedAt)}
                  complete={backupFreshnessCurrent}
                  testId="backup-covers-through"
                />
                <ReadinessItem
                  label="Backup Tables"
                  value={tableReadiness ? `${tableReadiness.totalTables} tables` : "-"}
                  complete={tableReadiness?.complete ?? false}
                />
                <ReadinessItem
                  label="Backup Rows"
                  value={tableReadiness ? tableReadiness.totalRows.toLocaleString() : "-"}
                  complete={tableReadiness?.complete ?? false}
                />
                <ReadinessItem
                  label="Screenshot Assets"
                  value={`${screenshotReadiness.embedded}/${screenshotReadiness.total}`}
                  complete={screenshotReadiness.complete}
                />
                <ReadinessItem
                  label="Import Archives"
                  value={`${importReadiness.total} files`}
                  complete={importReadiness.complete}
                />
                <ReadinessItem label="Manifest Warnings" value={backupWarnings.length.toLocaleString()} complete={backupWarnings.length === 0} testId="backup-readiness-warnings" />
              </div>
              <p className={`mt-3 text-xs ${backupFreshnessCurrent ? "text-emerald-700" : "text-amber-700"}`} data-testid="backup-freshness-detail">
                {backupFreshnessDetail}
              </p>
              <div className="mt-4" data-testid="backup-review-artifacts">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Closed-Trade Review Artifacts</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {reviewArtifactCounts.map((item) => (
                    <ReadinessItem
                      key={item.label}
                      label={item.label}
                      value={item.value.toLocaleString()}
                      complete={tableReadiness?.complete ?? false}
                    />
                  ))}
                </div>
              </div>
              {backupWarnings.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-800">
                  {backupWarnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {backupWarnings.length > 4 ? <li>{backupWarnings.length - 4} more warning(s)</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          <BackupActions />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle className="text-base">Import History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-6 text-sm">
          <ImportHistoryList
            batches={batches.map((batch) => ({
              id: batch.id,
              filename: batch.filename,
              fileType: batch.fileType,
              rowsSeen: batch.rowsSeen,
              rowsImported: batch.rowsImported,
              rowsSkipped: batch.rowsSkipped,
              status: batch.status,
              errorMessage: batch.errorMessage ?? undefined,
              rawSha256: batch.rawSha256 ?? undefined,
              rawBytes: batch.rawBytes ?? undefined,
              rawStorageKey: batch.rawStorageKey ?? undefined,
              parserVersion: batch.parserVersion ?? undefined,
              positionSnapshotMode: batch.positionSnapshotMode ?? undefined,
              importedAt: batch.importedAt.toISOString(),
              notes: batch.notes ?? undefined,
              rowErrorCount: batch._count.rowErrors,
              rowErrors: batch.rowErrors,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
