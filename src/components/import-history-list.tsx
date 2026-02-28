"use client";

import { useMemo, useState } from "react";

type ImportBatchItem = {
  id: string;
  filename: string;
  fileType: string;
  rowsSeen: number;
  rowsImported: number;
  rowsSkipped: number;
  importedAt: string;
};

const ZONES = [
  { value: "local", label: "Local Device Time" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "Australia/Melbourne", label: "Melbourne (AET/AEDT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
] as const;

function formatTimestamp(input: string, zone: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;

  const formatter = new Intl.DateTimeFormat(undefined, {
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
  const [selectedZone, setSelectedZone] = useState<string>("local");

  const zoneLabel = useMemo(
    () => ZONES.find((zone) => zone.value === selectedZone)?.label ?? "Local Device Time",
    [selectedZone],
  );

  if (batches.length === 0) {
    return <p className="text-slate-500">No imports yet.</p>;
  }

  return (
    <div className="space-y-2">
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
        <div key={batch.id} className="rounded border border-slate-200 px-3 py-2">
          <p className="font-medium">{batch.filename}</p>
          <p className="text-slate-600">
            {batch.fileType} | seen {batch.rowsSeen}, imported {batch.rowsImported}, skipped {batch.rowsSkipped}
          </p>
          <p className="text-xs text-slate-500">{formatTimestamp(batch.importedAt, selectedZone)}</p>
        </div>
      ))}
    </div>
  );
}
