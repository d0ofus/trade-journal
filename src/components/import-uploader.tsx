"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Preview = {
  filename: string;
  kind: "executions" | "positions" | "snapshots" | "unknown" | "commissions";
  headers: string[];
  mapping: Record<string, string | null>;
  rows: Record<string, string>[];
  errors: string[];
  totalRows?: number;
};

type ImportResult = {
  filename: string;
  rowsSeen: number;
  rowsImported: number;
  rowsSkipped: number;
  durationMs: number;
  rowsPerSecond: number;
};

function formatDurationMs(durationMs: number) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function formatRate(rowsPerSecond: number) {
  return `${rowsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 2 })} rows/s`;
}

export function ImportUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [message, setMessage] = useState<string>("");
  const [pending, startTransition] = useTransition();

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
        return;
      }

      setImportResults([]);
      setPreviews(data.previews ?? []);
      setMessage("Preview loaded. Adjust mappings if needed, then import.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preview failed due to a network or server error.");
    }
  }

  async function commitImport() {
    if (!files.length || !previews.length) return;
    try {
      const formData = new FormData();
      formData.set("action", "commit");
      formData.set("mappingByFile", JSON.stringify(mappingByFile));
      formData.set("kindByFile", JSON.stringify(kindByFile));
      files.forEach((file) => formData.append("files", file));

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await readApiPayload(res);
      if (!res.ok) {
        setMessage(data.error ?? "Import failed.");
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
          `Import complete. Seen ${summary.totalRowsSeen}, imported ${summary.totalRowsImported}, skipped ${summary.totalRowsSkipped}. Duration ${formatDurationMs(summary.totalDurationMs)} at ${formatRate(summary.totalRowsPerSecond)}.`,
        );
      } else {
        setMessage("Import complete.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed due to a network or server error.");
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
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startTransition(previewUpload)} disabled={pending || files.length === 0}>
              {pending ? "Working..." : "Preview"}
            </Button>
            <Button
              variant="outline"
              onClick={() => startTransition(commitImport)}
              disabled={pending || previews.length === 0}
            >
              Validate & Import
            </Button>
          </div>
          {message ? (
            <p className="rounded-[18px] border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-600">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {previews.map((preview) => (
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
      ))}

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
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Imported</th>
                    <th className="px-2 py-2 text-left font-semibold text-slate-700">Skipped</th>
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
                      <td className="px-2 py-1.5 text-slate-700">{result.rowsSkipped.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-slate-700">{formatDurationMs(result.durationMs)}</td>
                      <td className="px-2 py-1.5 text-slate-700">{formatRate(result.rowsPerSecond)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
