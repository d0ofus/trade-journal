"use client";

import { useMemo, useState } from "react";
import { deriveImportHistoryPresentation } from "@/lib/import/import-history";

type ImportBatchItem = {
  id: string;
  filename: string;
  fileType: string;
  rowsSeen: number;
  rowsImported: number;
  rowsSkipped: number;
  status: string;
  errorMessage?: string;
  rawSha256?: string;
  rawBytes?: number | null;
  rawStorageKey?: string;
  parserVersion?: string;
  positionSnapshotMode?: "PARTIAL" | "FULL" | null;
  importedAt: string;
  notes?: string;
  rowErrorCount?: number;
  rowErrors?: Array<{
    id: string;
    rowNumber: number | null;
    code: string;
    message: string;
  }>;
};

function formatBytes(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "0 B";
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

function positionSnapshotModeLabel(mode: ImportBatchItem["positionSnapshotMode"]) {
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

export function ImportHistoryList({ batches }: { batches: ImportBatchItem[] }) {
  const [selectedZone, setSelectedZone] = useState<string>("UTC");

  const zoneLabel = useMemo(
    () => ZONES.find((zone) => zone.value === selectedZone)?.label ?? "UTC",
    [selectedZone],
  );

  if (batches.length === 0) {
    return <p className="text-slate-500">No imports yet.</p>;
  }

  return (
    <div className="space-y-3">
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
      </div>

      {batches.map((batch) => {
        const presentation = deriveImportHistoryPresentation(batch);
        const isFailedOutcome = presentation.kind === "failed" || presentation.kind === "rolled-back";
        return (
          <div
            key={batch.id}
            data-testid={`import-history-batch-${batch.id}`}
            className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{batch.filename}</p>
              <div className="flex flex-wrap gap-1">
                {positionSnapshotModeLabel(batch.positionSnapshotMode) ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-sky-700">
                    {positionSnapshotModeLabel(batch.positionSnapshotMode)}
                  </span>
                ) : null}
                <span
                  data-testid={`import-history-status-${batch.id}`}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusClassName(presentation.tone)}`}
                >
                  {presentation.label}
                </span>
              </div>
            </div>
            <p className="text-slate-600">
              <span className="[overflow-wrap:anywhere]">{batch.fileType}</span> | seen {batch.rowsSeen}, applied{" "}
              {batch.rowsImported}, not applied {batch.rowsSkipped}
            </p>
            {presentation.kind === "failed" && (batch.rowsSeen > 0 || (batch.rowErrorCount ?? 0) > 0) ? (
              <p className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 [overflow-wrap:anywhere]">
                {batch.rowErrorCount?.toLocaleString() ?? "0"} row error(s) recorded. All{" "}
                {batch.rowsSeen.toLocaleString()} seen row(s) remained unapplied.
              </p>
            ) : !isFailedOutcome && (batch.rowsSkipped > 0 || (batch.rowErrorCount ?? 0) > 0) ? (
              <p className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {batch.rowErrorCount?.toLocaleString() ?? "0"} parser row error(s) recorded. The disposition counts
                below explain every row that was not applied.
              </p>
            ) : null}
            {presentation.outcomes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" data-testid={`import-history-outcomes-${batch.id}`}>
                {presentation.outcomes.map((outcome) => (
                  <span
                    key={outcome.key}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                  >
                    {outcome.count.toLocaleString()} {outcome.label}
                  </span>
                ))}
              </div>
            ) : null}
            {batch.rowErrors && batch.rowErrors.length > 0 ? (
              <div className="min-w-0 space-y-1 rounded-[14px] border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                {batch.rowErrors.map((error) => (
                  <p key={error.id} className="[overflow-wrap:anywhere]">
                    row {error.rowNumber ?? "?"} {error.code}: {error.message}
                  </p>
                ))}
                {(batch.rowErrorCount ?? 0) > batch.rowErrors.length ? (
                  <p className="text-red-600">
                    Showing {batch.rowErrors.length.toLocaleString()} of {batch.rowErrorCount?.toLocaleString()} row
                    errors.
                  </p>
                ) : null}
              </div>
            ) : null}
            {batch.rawSha256 ? (
              <div className="space-y-0.5">
                <p className="font-mono text-[11px] text-slate-500">
                  sha256 {batch.rawSha256.slice(0, 16)}... | {formatBytes(batch.rawBytes)}
                </p>
                <p className="break-all font-mono text-[11px] text-slate-500">
                  {batch.rawStorageKey ? `archive ${batch.rawStorageKey}` : "archive missing"}
                </p>
              </div>
            ) : null}
            {batch.parserVersion ? (
              <p className="text-xs text-slate-500 [overflow-wrap:anywhere]">Parser: {batch.parserVersion}</p>
            ) : null}
            {presentation.visibleNotes ? (
              <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">{presentation.visibleNotes}</p>
            ) : null}
            {batch.errorMessage && (
              <p className="text-xs text-red-600 [overflow-wrap:anywhere]">{batch.errorMessage}</p>
            )}
            <p className="text-xs text-slate-500">{formatTimestamp(batch.importedAt, selectedZone)}</p>
          </div>
        );
      })}
    </div>
  );
}
