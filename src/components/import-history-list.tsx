"use client";

import { useMemo, useState } from "react";

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

function statusLabel(status: string) {
  switch (status) {
    case "ROWS_APPLIED":
      return "Rows applied";
    case "MATERIALIZED":
    case "SUCCEEDED":
      return "Materialized";
    case "MATERIALIZATION_FAILED":
      return "Needs refresh";
    case "FAILED":
      return "Failed";
    case "STARTED":
      return "Started";
    default:
      return status;
  }
}

function statusClassName(status: string) {
  switch (status) {
    case "MATERIALIZED":
    case "SUCCEEDED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ROWS_APPLIED":
    case "STARTED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "MATERIALIZATION_FAILED":
    case "FAILED":
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

      {batches.map((batch) => (
        <div key={batch.id} className="rounded-[20px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium text-slate-900">{batch.filename}</p>
            <div className="flex flex-wrap gap-1">
              {positionSnapshotModeLabel(batch.positionSnapshotMode) ? (
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-sky-700">
                  {positionSnapshotModeLabel(batch.positionSnapshotMode)}
                </span>
              ) : null}
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusClassName(batch.status)}`}>
                {statusLabel(batch.status)}
              </span>
            </div>
          </div>
          <p className="text-slate-600">
            {batch.fileType} | seen {batch.rowsSeen}, imported {batch.rowsImported}, skipped {batch.rowsSkipped}
          </p>
          {batch.rowsSkipped > 0 || (batch.rowErrorCount ?? 0) > 0 ? (
            <p className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {batch.rowErrorCount?.toLocaleString() ?? "0"} parser row error(s) recorded. Skipped rows can also include duplicate-key skips.
            </p>
          ) : null}
          {batch.rowErrors && batch.rowErrors.length > 0 ? (
            <div className="space-y-1 rounded-[14px] border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {batch.rowErrors.map((error) => (
                <p key={error.id}>
                  row {error.rowNumber ?? "?"} {error.code}: {error.message}
                </p>
              ))}
            </div>
          ) : null}
          {batch.rawSha256 ? (
            <div className="space-y-0.5">
              <p className="font-mono text-[11px] text-slate-500">
                sha256 {batch.rawSha256.slice(0, 16)}... | {formatBytes(batch.rawBytes)}
              </p>
              <p className="font-mono text-[11px] text-slate-500">
                {batch.rawStorageKey ? `archive ${batch.rawStorageKey}` : "archive missing"}
              </p>
            </div>
          ) : null}
          {batch.parserVersion ? <p className="text-xs text-slate-500">Parser: {batch.parserVersion}</p> : null}
          {batch.notes && <p className="text-xs text-slate-600">{batch.notes}</p>}
          {batch.errorMessage && <p className="text-xs text-red-600">{batch.errorMessage}</p>}
          <p className="text-xs text-slate-500">{formatTimestamp(batch.importedAt, selectedZone)}</p>
        </div>
      ))}
    </div>
  );
}
