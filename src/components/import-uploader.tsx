"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { importAccountingOutcomes } from "@/lib/import/import-history";
import type { ImportAccounting } from "@/lib/import/import-accounting";

type Preview = {
  filename: string;
  kind: "executions" | "positions" | "snapshots" | "unknown" | "commissions";
  headers: string[];
  mapping: Record<string, string | null>;
  rows: Record<string, string>[];
  errors: string[];
  totalRows?: number;
  positionSnapshotSafety?: {
    accounts: Array<{
      account: string;
      snapshotDates: string[];
      latestKnownSnapshotDate: string | null;
      missingReportDateRows: number;
      blockedFullSnapshot: boolean;
      blockReason: string | null;
    }>;
    blockedFullSnapshot: boolean;
    blockReason: string | null;
  };
};

type ImportResult = {
  filename: string;
  rowsSeen: number;
  rowsImported: number;
  rowsSkipped: number;
  rowErrors: number;
  durationMs: number;
  rowsPerSecond: number;
  positionSnapshotMode?: PositionSnapshotMode | null;
  accounting?: ImportAccounting;
};

type PositionSnapshotMode = "partial" | "full";

function formatDurationMs(durationMs: number) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatRate(rowsPerSecond: number) {
  return `${rowsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 2 })} rows/s`;
}

function positionSnapshotModeLabel(mode: PositionSnapshotMode | null | undefined) {
  if (mode === "full") return "Full snapshot";
  if (mode === "partial") return "Partial update";
  return "";
}

export function ImportUploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [positionSnapshotModes, setPositionSnapshotModes] = useState<Record<string, PositionSnapshotMode>>({});
  const [fullSnapshotConfirmations, setFullSnapshotConfirmations] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const hasImportablePreviews = previews.some(
    (preview) => preview.kind === "executions" || preview.kind === "positions" || preview.kind === "snapshots",
  );
  const hasBlockingPreviewErrors = previews.some((preview) => preview.kind === "unknown" || preview.errors.length > 0);
  const hasBlockedFullSnapshot = previews.some(
    (preview) =>
      preview.kind === "positions" &&
      (positionSnapshotModes[preview.filename] ?? "partial") === "full" &&
      preview.positionSnapshotSafety?.blockedFullSnapshot,
  );
  const blockedFullSnapshotReasons = previews.flatMap((preview) => {
    if (
      preview.kind !== "positions" ||
      (positionSnapshotModes[preview.filename] ?? "partial") !== "full" ||
      !preview.positionSnapshotSafety?.blockedFullSnapshot
    ) {
      return [];
    }
    return preview.positionSnapshotSafety.blockReason
      ? [`${preview.filename}: ${preview.positionSnapshotSafety.blockReason}`]
      : [];
  });
  const hasUnconfirmedFullSnapshot = previews.some(
    (preview) =>
      preview.kind === "positions" &&
      (positionSnapshotModes[preview.filename] ?? "partial") === "full" &&
      !preview.positionSnapshotSafety?.blockedFullSnapshot &&
      !fullSnapshotConfirmations[preview.filename],
  );

  const mappingByFile = useMemo(() => {
    const mapped: Record<string, Record<string, string | null>> = {};
    for (const preview of previews) mapped[preview.filename] = preview.mapping;
    return mapped;
  }, [previews]);

  const kindByFile = useMemo(() => {
    const mapped: Record<string, "executions" | "positions" | "snapshots"> = {};
    for (const preview of previews) {
      if (preview.kind === "executions" || preview.kind === "positions" || preview.kind === "snapshots") {
        mapped[preview.filename] = preview.kind;
      }
    }
    return mapped;
  }, [previews]);

  async function readApiPayload(res: Response) {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return res.json();
    }

    const text = await res.text();
    return { error: text.slice(0, 300) || "Request failed with a non-JSON response." };
  }

  async function previewUpload() {
    if (!files.length) return;
    try {
      const formData = new FormData();
      formData.set("action", "preview");
      files.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await readApiPayload(res);
      if (!res.ok) {
        setMessage(data.error ?? "Preview failed.");
        setPreviews([]);
        setImportResults([]);
        return;
      }

      const nextPreviews = (data.previews ?? []) as Preview[];
      setImportResults([]);
      setPreviews(nextPreviews);
      setPositionSnapshotModes((current) =>
        Object.fromEntries(
          nextPreviews
            .filter((preview) => preview.kind === "positions")
            .map((preview) => [preview.filename, current[preview.filename] ?? "partial"]),
        ),
      );
      setFullSnapshotConfirmations({});
      setMessage("Preview loaded. Adjust mappings if needed, then import.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed due to a network or server error.");
      setPreviews([]);
      setImportResults([]);
    }
  }

  async function commitImport() {
    if (
      !files.length ||
      !previews.length ||
      hasBlockingPreviewErrors ||
      !hasImportablePreviews ||
      hasBlockedFullSnapshot ||
      hasUnconfirmedFullSnapshot
    ) return;
    try {
      const formData = new FormData();
      formData.set("action", "commit");
      formData.set("mappingByFile", JSON.stringify(mappingByFile));
      formData.set("kindByFile", JSON.stringify(kindByFile));
      formData.set("positionSnapshotModeByFile", JSON.stringify(positionSnapshotModes));
      files.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await readApiPayload(res);
      if (!res.ok) {
        setMessage(data.error ?? "Import failed.");
        setImportResults([]);
        router.refresh();
        return;
      }

      const results = (data.results ?? []) as ImportResult[];
      setImportResults(results);

      const summary = data.summary as
        | {
            totalRowsSeen: number;
            totalRowsImported: number;
            totalRowsSkipped: number;
            totalDurationMs: number;
            totalRowsPerSecond: number;
          }
        | undefined;
      if (summary) {
        setMessage(
          `Import complete. Seen ${summary.totalRowsSeen}, applied ${summary.totalRowsImported}, not applied ${summary.totalRowsSkipped}. Duration ${formatDurationMs(summary.totalDurationMs)} at ${formatRate(summary.totalRowsPerSecond)}.`,
        );
      } else {
        setMessage("Import complete.");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed due to a network or server error.");
      setImportResults([]);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-200/80">
          <CardTitle>Upload IBKR CSV Files</CardTitle>
          <CardDescription>Upload Activity Statement exports for trades, positions, and daily metrics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <Input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setPreviews([]);
              setImportResults([]);
              setPositionSnapshotModes({});
              setFullSnapshotConfirmations({});
              setMessage("");
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startTransition(previewUpload)} disabled={pending || files.length === 0}>
              {pending ? "Working..." : "Preview"}
            </Button>
            <Button
              variant="outline"
              onClick={() => startTransition(commitImport)}
              disabled={
                pending ||
                previews.length === 0 ||
                hasBlockingPreviewErrors ||
                !hasImportablePreviews ||
                hasBlockedFullSnapshot ||
                hasUnconfirmedFullSnapshot
              }
            >
              Validate & Import
            </Button>
          </div>
          {previews.length > 0 && (hasBlockingPreviewErrors || !hasImportablePreviews) ? (
            <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Resolve preview errors or upload a trade, position, or snapshot file before importing.
            </div>
          ) : null}
          {hasBlockedFullSnapshot ? (
            <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {blockedFullSnapshotReasons.length > 0
                ? blockedFullSnapshotReasons.join(" ")
                : "A selected full snapshot is older than existing position history or lacks required report dates. Use partial update or upload a current complete export."}
            </div>
          ) : null}
          {hasUnconfirmedFullSnapshot ? (
            <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Confirm each full snapshot before importing so missing positions can be safely pruned.
            </div>
          ) : null}
          {message ? (
            <p className="rounded-[18px] border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-600">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {previews.map((preview) => {
        const selectedPositionMode = positionSnapshotModes[preview.filename] ?? "partial";
        const safety = preview.positionSnapshotSafety;
        const blockedFullSnapshot = preview.kind === "positions" && selectedPositionMode === "full" && Boolean(safety?.blockedFullSnapshot);
        const confirmationText =
          safety?.accounts.length === 1
            ? `I confirm this is the complete open-position list for ${safety.accounts[0].account} as of ${safety.accounts[0].snapshotDates[0] ?? "the uploaded report date"}.`
            : "I confirm this is the complete open-position list for every account shown in this file.";

        return (
          <Card key={preview.filename} className="overflow-hidden">
          <CardHeader className="border-b border-slate-200/80">
            <CardTitle className="text-base">{preview.filename}</CardTitle>
            <CardDescription>
              Detected type: {preview.kind}
              {typeof preview.totalRows === "number" ? ` | Rows detected: ${preview.totalRows}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {preview.errors.length > 0 ? (
              <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {preview.errors.join(" | ")}
              </div>
            ) : null}
            {preview.kind === "positions" ? (
              <div className="space-y-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Position import mode</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Choose whether this file updates listed positions only or represents the complete open-position list.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                    {(["partial", "full"] as PositionSnapshotMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={selectedPositionMode === mode}
                        className={`h-8 rounded-md px-3 text-xs font-semibold ${
                          selectedPositionMode === mode
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => {
                          setPositionSnapshotModes((current) => ({
                            ...current,
                            [preview.filename]: mode,
                          }));
                          setFullSnapshotConfirmations((current) => ({ ...current, [preview.filename]: false }));
                        }}
                      >
                        {mode === "partial" ? "Partial update" : "Full snapshot"}
                      </button>
                    ))}
                  </div>
                </div>
                {selectedPositionMode === "full" ? (
                  <div className="space-y-2">
                    <p className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Use full snapshot only with a complete IBKR position export. Missing positions for accounts in this file will be removed from current open positions.
                    </p>
                    {safety?.accounts.map((account) => (
                      <p
                        key={account.account}
                        className={`rounded-[14px] border px-3 py-2 text-xs ${
                          account.blockedFullSnapshot
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-sky-200 bg-sky-50 text-sky-800"
                        }`}
                      >
                        {account.blockReason ??
                          `${account.account} snapshot date ${account.snapshotDates[0] ?? "unknown"}; latest known position date ${account.latestKnownSnapshotDate ?? "none"}.`}
                      </p>
                    ))}
                    {safety?.blockReason ? (
                      <p className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {safety.blockReason}
                      </p>
                    ) : null}
                    {blockedFullSnapshot ? null : (
                      <label className="flex items-start gap-2 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={Boolean(fullSnapshotConfirmations[preview.filename])}
                          onChange={(event) =>
                            setFullSnapshotConfirmations((current) => ({
                              ...current,
                              [preview.filename]: event.target.checked,
                            }))
                          }
                        />
                        <span>{confirmationText}</span>
                      </label>
                    )}
                  </div>
                ) : (
                  <p className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Partial update will update positions in this file and keep other open positions unchanged.
                  </p>
                )}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(preview.mapping).map(([field, column]) => (
                <label key={field} className="text-sm">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {field}
                  </span>
                  <Input
                    value={column ?? ""}
                    onChange={(event) => {
                      setPreviews((current) =>
                        current.map((item) =>
                          item.filename === preview.filename
                            ? { ...item, mapping: { ...item.mapping, [field]: event.target.value || null } }
                            : item,
                        ),
                      );
                    }}
                    placeholder="Column name"
                  />
                </label>
              ))}
            </div>
            <div className="overflow-auto rounded-[20px] border border-slate-200/80 bg-white/80">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-900/[0.035]">
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className="px-2 py-2 text-left font-semibold text-slate-700">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-200/80">
                      {preview.headers.map((header) => (
                        <td key={header} className="px-2 py-1.5 text-slate-700">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        );
      })}

      {importResults.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-200/80">
            <CardTitle className="text-base">Latest Import Performance</CardTitle>
            <CardDescription>Per-file throughput from the most recent import run.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-auto rounded-[20px] border border-slate-200/80 bg-white/80">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-900/[0.035]">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">File</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Seen</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Applied</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Not Applied</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Disposition</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Row Errors</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Mode</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Duration</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Throughput</th>
                  </tr>
                </thead>
                <tbody>
                  {importResults.map((result) => (
                    <tr key={result.filename} className="border-t border-slate-200/80">
                      <td className="px-2 py-1.5 text-slate-700">{result.filename}</td>
                      <td className="px-2 py-1.5 text-slate-700">{result.rowsSeen.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-slate-700">{result.rowsImported.toLocaleString()}</td>
                      <td className={result.rowsSkipped > 0 ? "px-2 py-1.5 font-medium text-amber-700" : "px-2 py-1.5 text-slate-700"}>
                        {result.rowsSkipped.toLocaleString()}
                      </td>
                      <td className="min-w-48 px-2 py-1.5 text-slate-700 [overflow-wrap:anywhere]">
                        {importAccountingOutcomes(result.accounting ?? null)
                          .map((outcome) => `${outcome.count} ${outcome.label}`)
                          .join(", ") || "-"}
                      </td>
                      <td className={result.rowErrors > 0 ? "px-2 py-1.5 font-medium text-red-700" : "px-2 py-1.5 text-slate-700"}>
                        {result.rowErrors.toLocaleString()}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">{positionSnapshotModeLabel(result.positionSnapshotMode) || "-"}</td>
                      <td className="px-2 py-1.5 text-slate-700">{formatDurationMs(result.durationMs)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{formatRate(result.rowsPerSecond)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importResults.some((result) => result.rowsSkipped > 0 || result.rowErrors > 0) ? (
              <p className="mt-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Not-applied rows are itemized by parser rejection, intentional exclusion, unresolved reference, or unchanged duplicate. Row errors remain stored with the import batch.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
