"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  deriveImportHistoryPresentation,
  importHistoryCohortSummary,
  importHistoryPaginationLabel,
  type ImportHistoryBatchItem,
  type ImportHistoryPage,
} from "@/lib/import/import-history";

function formatBytes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function statusClassName(tone: ReturnType<typeof deriveImportHistoryPresentation>["tone"]) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 text-slate-600";
  }
}

function positionSnapshotModeLabel(mode: ImportHistoryBatchItem["positionSnapshotMode"]) {
  if (mode === "FULL") return "Full position snapshot";
  if (mode === "PARTIAL") return "Partial position update";
  return null;
}

const ZONES = [
  { value: "UTC", label: "UTC" },
  { value: "local", label: "Local Device Time" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "Australia/Melbourne", label: "Melbourne (AET/AEDT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
] as const;

function formatTimestamp(input: string, zone: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;

  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    ...(zone === "local" ? {} : { timeZone: zone }),
    timeZoneName: "short",
  });

  return formatter.format(date);
}

function BatchHistoryItem({ batch, selectedZone }: { batch: ImportHistoryBatchItem; selectedZone: string }) {
  const presentation = deriveImportHistoryPresentation(batch);
  const isFailedOutcome = presentation.kind === "failed" || presentation.kind === "rolled-back";
  const snapshotLabel = positionSnapshotModeLabel(batch.positionSnapshotMode);

  return (
    <div
      data-testid={`import-history-batch-${batch.id}`}
      className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{batch.filename}</p>
        <div className="flex min-w-0 max-w-full flex-wrap gap-1">
          {snapshotLabel ? (
            <span className="max-w-full whitespace-normal rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-sky-700 [overflow-wrap:anywhere]">
              {snapshotLabel}
            </span>
          ) : null}
          <span
            data-testid={`import-history-status-${batch.id}`}
            className={`max-w-full whitespace-normal rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase [overflow-wrap:anywhere] ${statusClassName(presentation.tone)}`}
          >
            {presentation.label}
          </span>
        </div>
      </div>
      <p className="text-slate-600 [overflow-wrap:anywhere]">
        {batch.fileType} | seen {batch.rowsSeen}, applied {batch.rowsImported}, not applied {batch.rowsSkipped}
      </p>
      {batch.sourceFilename ? (
        <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">
          Source: {batch.sourceFilename}
          {batch.sourceSection ? ` | Section: ${batch.sourceSection}` : ""}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Legacy source provenance unavailable.</p>
      )}
      {batch.sourceId ? (
        <p className="break-all font-mono text-[11px] text-slate-500">Source ID: {batch.sourceId}</p>
      ) : null}
      {presentation.kind === "failed" && (batch.rowsSeen > 0 || batch.rowErrorCount > 0) ? (
        <p className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 [overflow-wrap:anywhere]">
          {batch.rowErrorCount.toLocaleString()} row error(s) recorded. All {batch.rowsSeen.toLocaleString()} seen
          row(s) remained unapplied.
        </p>
      ) : !isFailedOutcome && (batch.rowsSkipped > 0 || batch.rowErrorCount > 0) ? (
        <p className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 [overflow-wrap:anywhere]">
          {batch.rowErrorCount.toLocaleString()} parser row error(s) recorded. The disposition counts below explain
          every row that was not applied.
        </p>
      ) : null}
      {presentation.outcomes.length > 0 ? (
        <div className="flex min-w-0 max-w-full flex-wrap gap-1.5" data-testid={`import-history-outcomes-${batch.id}`}>
          {presentation.outcomes.map((outcome) => (
            <span
              key={outcome.key}
              className="max-w-full whitespace-normal rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 [overflow-wrap:anywhere]"
            >
              {outcome.count.toLocaleString()} {outcome.label}
            </span>
          ))}
        </div>
      ) : null}
      {batch.rowErrors.length > 0 ? (
        <div className="min-w-0 space-y-1 rounded-[14px] border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {batch.rowErrors.map((error) => (
            <p key={error.id} className="[overflow-wrap:anywhere]">
              row {error.rowNumber ?? "?"} {error.code}: {error.message}
            </p>
          ))}
          {batch.rowErrorCount > batch.rowErrors.length ? (
            <p className="text-red-600">
              Showing {batch.rowErrors.length.toLocaleString()} of {batch.rowErrorCount.toLocaleString()} row errors.
            </p>
          ) : null}
        </div>
      ) : null}
      {batch.rawSha256 ? (
        <div className="min-w-0 space-y-0.5">
          <p className="font-mono text-[11px] text-slate-500 [overflow-wrap:anywhere]">
            sha256 {batch.rawSha256.slice(0, 16)}... | {formatBytes(batch.rawBytes)}
          </p>
          <p className="break-all font-mono text-[11px] text-slate-500">
            {batch.rawStorageKey ? `archive ${batch.rawStorageKey}` : "archive metadata incomplete"}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          {batch.cohortId ? "Archive metadata unavailable." : "Legacy archive metadata unavailable."}
        </p>
      )}
      <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">
        Parser: {batch.parserVersion ?? "Unknown"}
      </p>
      {presentation.visibleNotes ? (
        <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">{presentation.visibleNotes}</p>
      ) : null}
      {batch.errorMessage ? (
        <p className="text-xs text-red-600 [overflow-wrap:anywhere]">{batch.errorMessage}</p>
      ) : null}
      <p className="text-xs text-slate-500">{formatTimestamp(batch.importedAt, selectedZone)}</p>
    </div>
  );
}

export function ImportHistoryList({
  page,
  olderHref,
  newestHref,
}: {
  page: ImportHistoryPage;
  olderHref: string | null;
  newestHref: string | null;
}) {
  const [selectedZone, setSelectedZone] = useState<string>("UTC");
  const zoneLabel = useMemo(
    () => ZONES.find((zone) => zone.value === selectedZone)?.label ?? "UTC",
    [selectedZone],
  );

  if (page.cohorts.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-slate-500">No imports on this page.</p>
        {newestHref ? (
          <Link href={newestHref} className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-950">
            <ChevronLeft className="size-4" aria-hidden="true" />
            Newest imports
          </Link>
        ) : null}
      </div>
    );
  }

  const recordCount = page.cohorts.reduce((sum, cohort) => sum + cohort.batches.length, 0);
  const olderLabel = importHistoryPaginationLabel(page.pageInfo.hasNextPage);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="import-timezone" className="text-xs text-slate-600">
          Timezone
        </label>
        <select
          id="import-timezone"
          value={selectedZone}
          onChange={(event) => setSelectedZone(event.target.value)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {ZONES.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">Showing {zoneLabel}</span>
        <span className="text-xs text-slate-500">
          {page.cohorts.length.toLocaleString()} attempts | {recordCount.toLocaleString()} records
        </span>
      </div>

      {page.cohorts.map((cohort) => (
        <section key={cohort.key} data-testid={`import-history-cohort-${cohort.key}`} className="min-w-0 space-y-2 border-l-2 border-slate-200 pl-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase text-slate-500 [overflow-wrap:anywhere]">
              {cohort.cohortId ? `Attempt ${cohort.cohortId}` : `Legacy record ${cohort.batches[0]?.id ?? cohort.key}`}
            </p>
            <p className="text-xs text-slate-500">{importHistoryCohortSummary(cohort)}</p>
          </div>
          {cohort.batches.map((batch) => (
            <BatchHistoryItem key={batch.id} batch={batch} selectedZone={selectedZone} />
          ))}
        </section>
      ))}

      <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4" aria-label="Import history pages">
        {newestHref ? (
          <Link href={newestHref} className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-950">
            <ChevronLeft className="size-4" aria-hidden="true" />
            Newest imports
          </Link>
        ) : (
          <span />
        )}
        {olderHref && olderLabel ? (
          <Link
            href={olderHref}
            data-testid="import-history-older"
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-950"
          >
            {olderLabel}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
