"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackupActions } from "./backup-actions";
import { useStorageMetrics } from "./use-storage-metrics";
import { exactStorageBytes, formatStorageBytes, formatStorageTime } from "@/lib/storage-format";
import { measurementIsStale, storageGuard, R2_STALE_MS, type StorageGroupKey } from "@/lib/storage-usage";

function Metric({ label, value, bytes = false, detail, testId }: { label: string; value: number | string | null | undefined; bytes?: boolean; detail?: string; testId?: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 p-3" data-testid={testId}>
    <dt className="text-xs font-semibold text-slate-600">{label}</dt>
    <dd className="mt-1 break-words font-mono text-base">{value == null ? "Unavailable" : bytes && typeof value === "number" ? formatStorageBytes(value) : typeof value === "number" ? value.toLocaleString() : value}</dd>
    {bytes && typeof value === "number" && <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">Exact bytes</summary>{exactStorageBytes(value)}</details>}
    {detail && <p className="mt-1 text-xs text-slate-600">{detail}</p>}
  </div>;
}
const Grid = ({ children }: { children: ReactNode }) => <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</dl>;
function Guard({ value, kind, label }: { value: number; kind: "cache" | "branch"; label: string }) {
  const guard = storageGuard(value, kind);
  return <div className="rounded-xl border p-3"><h4 className="font-medium">{label}</h4>
    <p className="my-2 font-mono">{formatStorageBytes(value)} / {formatStorageBytes(guard.limit)} · {guard.status}</p>
    <details className="mb-2 text-xs"><summary>Exact bytes</summary>{exactStorageBytes(value)}</details>
    <div role="progressbar" aria-label={label} aria-valuenow={guard.percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded bg-slate-100">
      <div className="h-full" style={{ width: `${guard.percent}%`, backgroundColor: guard.status === "Paused" ? "#dc2626" : guard.status === "Warning" ? "#d97706" : "#059669" }} />
    </div><p className="mt-2 text-xs text-slate-600">{formatStorageBytes(guard.remaining)} headroom · Warning at {formatStorageBytes(guard.warningAt)} · Cache persistence pauses at {formatStorageBytes(guard.pauseAt)}</p>
  </div>;
}

export function StorageMonitor() {
  const { usage, error, providerError, now, busy, refresh } = useStorageMetrics();
  const status = (key: StorageGroupKey) => {
    const state = usage?.groups?.[key] ?? (usage?.[key] != null ? { measuredAt: usage.measuredAt, complete: true, error: null } : undefined);
    return <div className="mt-1 text-xs text-slate-600" data-testid={`metrics-status-${key}`}>
      {usage?.[key] == null ? "Unavailable" : <>{error || measurementIsStale(state, now) || state?.error && !state.complete ? "Stale or incomplete reading" : "Measured"} · {formatStorageTime(state?.measuredAt)}</>}
      {state?.error && <p role="status" className="text-amber-800">{state.error}</p>}
    </div>;
  };
  const a = usage?.activity, w = usage?.workstation, l = usage?.legacy, d = usage?.database, e = usage?.evidence, c = usage?.candles, p = usage?.payloads, b = usage?.backup;
  const account = e?.account, accountIssue = providerError || e?.accountError || account?.error;
  const freshness = !b ? "Unavailable" : b.databaseFreshness === "current" ? "Current" : b.databaseFreshness === "needs-backup" ? "Needs backup" : "No verified database backup";

  return <div className="space-y-6" data-testid="settings-storage-health">
    <Card id="cloud-storage">
      <CardHeader><CardTitle>Storage &amp; Data Health</CardTitle></CardHeader>
      <CardContent className="space-y-6 text-sm" data-testid="cloud-storage-monitor" aria-busy={busy}>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-slate-600">Application metrics refresh every minute while this page is visible.</p>
          <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh metrics"}</button>
        </div>
        {error && <p role="alert" className="text-amber-800">{error}</p>}
        <section aria-label="Trade activity"><h3 className="font-semibold">Trade activity</h3>{status("activity")}
          <Grid>
            <Metric label="Executions" value={a?.executions} /><Metric label="Active closed trades" value={a?.activeTrades} />
            <Metric label="All closed trades" value={a?.allTrades} /><Metric label="Stale trades" value={a?.staleTrades} />
            <Metric label="Failed imports" value={a?.failedImports} detail="Import batches with FAILED status." />
            <Metric label="Post-import processing failures" value={a?.processingFailures} />
            <Metric label="Imports with skipped rows" value={a?.importsWithSkippedRows} detail="Applied or processed batches reporting rowsSkipped > 0; not necessarily unresolved trades." />
            <Metric label="Parser row errors" value={a?.parserErrors} />
            <Metric label="Reported raw import bytes" value={a?.rawImportBytes} bytes detail="Sum across import batches; repeated imports may reference the same archive." />
            <Metric label="Archived raw bytes" value={a?.archivedRawBytes} bytes /><Metric label="Import artifacts" value={a?.importArtifacts} />
            <Metric label="Missing raw archive references" value={a?.missingRawArchives} detail="A raw hash exists but the batch has no storage key." />
            <Metric label="Legacy imports without a raw hash" value={a?.legacyRawImports} />
            <Metric label="Latest stale-trade timestamp" value={a ? formatStorageTime(a.latestStaleTradeAt) : null} />
          </Grid>
        </section>
        <section aria-label="Workstation reviews"><h3 className="font-semibold">Workstation reviews</h3>{status("workstation")}
          <Grid>
            <Metric label="Saved review documents" value={w?.reviews} /><Metric label="Workspace drawings" value={w?.drawings} detail="Includes individually hidden drawings." />
            <Metric label="Comparison drawings" value={w?.comparisonDrawings} /><Metric label="Evidence entries" value={w?.evidenceEntries} detail="Section reuse does not add evidence entries." />
            <Metric label="Entries linked to ready R2 assets" value={w?.r2EvidenceEntries} /><Metric label="Remaining inline images" value={w?.inlineImages} />
            <Metric label="Unreadable review documents" value={w?.invalidReviews} /><Metric label="Broken asset references" value={w?.brokenAssetReferences} />
            <Metric label="Saved review JSON payload" value={w?.jsonBytes} bytes />
          </Grid><p className="mt-2 text-xs text-slate-600">Saved documents only, including reviews of stale trades; unsaved drafts are not counted. Invalid documents are excluded from content counts, not deleted.</p>
        </section>
        <section aria-label="Standalone and legacy journals"><h3 className="font-semibold">Standalone / legacy journals</h3>{status("legacy")}
          <Grid><Metric label="Standalone journal entries" value={l?.journalEntries} /><Metric label="Standalone journal charts" value={l?.journalCharts} />
            <Metric label="Legacy drawings" value={l?.drawings} /><Metric label="Standalone inline screenshots" value={l?.inlineImages} />
            <Metric label="Inline encoded payload" value={l?.inlineEncodedBytes} bytes /><Metric label="Malformed inline references" value={l?.invalidInlineImages} detail="Encoding checks only, not full image decoding." />
            <Metric label="Local screenshot references" value={l?.localImages} /><Metric label="External screenshot references" value={l?.externalImages} detail="Legacy locations only; excludes private R2 assets. Storage bytes not measured." />
          </Grid>
        </section>
        <section aria-label="Storage"><h3 className="font-semibold">Storage</h3>
          <h4 className="mt-3 font-medium">Neon database and cache</h4>{status("database")}
          <Grid><Metric label="Current database physical storage" value={d?.currentBytes} bytes testId="storage-health-db-size" /></Grid>
          {d && <div className="mt-3 grid gap-3 md:grid-cols-2"><Guard value={d.branchBytes} kind="branch" label="Databases on this branch" /><Guard value={d.cacheBytes} kind="cache" label="Chart and metric cache" /></div>}
          <p className="mt-2 text-xs text-slate-600">Application growth guards, not Neon plan quotas. Cache and indexes are already included in physical database usage. Metric cache ({formatStorageBytes(d?.metricCacheBytes)}) is a subset of chart/cache totals. Freed PostgreSQL space can remain allocated for reuse.</p>
          {status("candles")}<Grid><Metric label="Legacy candle rows" value={c?.legacyRows} /><Metric label="Cached candle chunks" value={c?.chunks} /><Metric label="Bars stored in cached chunks" value={c?.storedBars} /></Grid>
          <p className="mt-2 text-xs text-slate-600">Stored records, not unique candles across sources, timeframes or sessions. Peer candles remain transient.</p>
          {status("payloads")}<Grid><Metric label="All inline image payloads" value={p?.inlineBytes} bytes /><Metric label="Inline image references" value={p?.inlineCount} /><Metric label="Archived import text payload" value={p?.importBytes} bytes /></Grid>
          <p className="mt-2 text-xs text-slate-600">Logical text bytes include base64 encoding, before database compression. They are not additional physical storage and must not be added to Neon totals.</p>
          <h4 className="mt-5 font-medium">Private R2 evidence · Standard storage</h4>{status("evidence")}
          <Grid><Metric label="Unique ready original assets" value={e?.assets} /><Metric label="Original image bytes" value={e?.originals} bytes />
            <Metric label="Thumbnail bytes" value={e?.thumbnails} bytes /><Metric label="Retained assets not attached to reviews" value={e?.retainedAssets} detail="Already included in ready assets; publication/backup pins and retention may keep them." />
            <Metric label="Retained original bytes (subset)" value={e?.retainedOriginalBytes} bytes />
            <Metric label="Active upload reservations" value={e?.pendingCount} /><Metric label="Reserved upload bytes" value={e?.pending} bytes detail="Expected bytes, not confirmation that an object has been uploaded." />
            <Metric label="Expired upload sessions awaiting cleanup" value={e?.expiredUploads} /><Metric label="Assets undergoing deletion" value={e?.deletingAssets} />
            <Metric label="Recorded backup parts" value={e?.backupParts} /><Metric label="Recorded backup-part bytes" value={e?.backupPartBytes} bytes detail="Database parts only; referenced originals are not counted twice." />
          </Grid>
          <p className="mt-2 text-xs text-slate-600">Database-tracked objects, not a complete bucket inventory. Temporary/redundant uploads and unregistered objects are not measured. Backup-part records may include expired sessions awaiting cleanup. Publishing to Notion does not remove originals.</p>
          <div className="mt-4 rounded-xl border p-3" aria-label="Cloudflare account usage">
            <h4 className="font-medium">Cloudflare account-wide usage · all applications</h4>
            {account ? <><Grid><Metric label="Account Standard storage" value={account.standardBytes} bytes /><Metric label="Other storage classes" value={account.otherClassBytes} bytes /></Grid>
              <p className="mt-2">Last successful fetch: {formatStorageTime(account.measuredAt)}{now - Date.parse(account.measuredAt) >= R2_STALE_MS ? " · Stale account reading" : ""}</p>
              {account.warning && <p role="status" className="text-amber-800">{account.warning}</p>}
              <p>Estimated Standard storage: US${account.estimatedMonthlyStorageUsd.toFixed(3)}/month at this level.</p>
            </> : <p>Account-wide R2 usage: Unavailable</p>}
            <p className="text-xs">Next permitted refresh: {e?.accountNextRefreshAt || account?.nextRefreshAt ? formatStorageTime(e?.accountNextRefreshAt ?? account?.nextRefreshAt) : "On the next refresh"}.</p>
            {accountIssue && <p role="status" className="text-amber-800">{accountIssue}</p>}
            <p className="mt-2 text-xs text-slate-600">Requested at most every 15 minutes while viewing Settings, plus the daily fallback. Fetch time is not the provider&apos;s measurement time; Cloudflare counters may be delayed. This includes other applications, not just Trade Journal. Estimates are not invoices: average monthly usage, operations, other classes and taxes may differ. Workers charges are separate; 8/9/10 GB warnings do not stop uploads.</p>
          </div>
        </section>
      </CardContent>
    </Card>
    <Card id="storage-backup"><CardHeader><CardTitle>Backup status &amp; downloads</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
      {status("backup")}
      <div data-testid="backup-readiness"><Grid>
        <Metric label="Database backup freshness" value={freshness} testId="backup-freshness-status" />
        <Metric label="Latest tracked data change" value={b ? formatStorageTime(b.latestDataChangeAt) : null} testId="storage-health-latest-change" />
        <Metric label="Last database verification" value={b ? formatStorageTime(b.latestAudit?.verifiedAt) : null} />
        <Metric label="Last verified database SHA-256" value={b ? b.latestAudit?.sha256 ?? "—" : null} />
        <Metric label="Last verified database payload" value={b?.latestAudit?.payloadBytes} bytes />
        <Metric label="Authoritative backup tables" value={b?.tableCount} /><Metric label="Current backup record count" value={b?.totalRows} />
        <Metric label="R2 originals required by complete backup" value={b?.requiredR2Originals} />
      </Grid></div>
      <p className="text-xs text-slate-600">These are metadata checks, not verification of R2 image bytes. Database-only verification does not certify a complete image backup. Complete downloads verify original bytes/checksums; a restore test is a separate operation. Standalone external screenshots retain their existing backup requirements.</p>
      <BackupActions />
    </CardContent></Card>
  </div>;
}
