"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Preview = {
  filename: string;
  kind: "executions" | "positions" | "snapshots" | "unknown";
  headers: string[];
  mapping: Record<string, string | null>;
  rows: Record<string, string>[];
  errors: string[];
};

export function ImportUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
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
      if (preview.kind !== "unknown") mapped[preview.filename] = preview.kind;
    }
    return mapped;
  }, [previews]);

  async function previewUpload() {
    if (!files.length) return;
    const formData = new FormData();
    formData.set("action", "preview");
    files.forEach((file) => formData.append("files", file));

    const res = await fetch("/api/import", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "Preview failed.");
      return;
    }

    setPreviews(data.previews);
    setMessage("Preview loaded. Adjust mappings if needed, then import.");
  }

  async function commitImport() {
    if (!files.length || !previews.length) return;
    const formData = new FormData();
    formData.set("action", "commit");
    formData.set("mappingByFile", JSON.stringify(mappingByFile));
    formData.set("kindByFile", JSON.stringify(kindByFile));
    files.forEach((file) => formData.append("files", file));

    const res = await fetch("/api/import", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error ?? "Import failed.");
      return;
    }

    const summary = data.results
      .map((r: { filename: string; rowsImported: number; rowsSkipped: number }) =>
        `${r.filename}: imported ${r.rowsImported}, skipped ${r.rowsSkipped}`,
      )
      .join(" | ");
    setMessage(`Import complete. ${summary}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Upload IBKR CSV Files</CardTitle>
          <CardDescription>Upload Activity Statement exports for trades, positions, and daily metrics.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <div className="flex gap-2">
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
          {message && <p className="text-sm text-slate-600">{message}</p>}
        </CardContent>
      </Card>

      {previews.map((preview) => (
        <Card key={preview.filename}>
          <CardHeader>
            <CardTitle className="text-base">{preview.filename}</CardTitle>
            <CardDescription>Detected type: {preview.kind}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.errors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                {preview.errors.join(" | ")}
              </div>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(preview.mapping).map(([field, column]) => (
                <label key={field} className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">{field}</span>
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
            <div className="overflow-auto rounded-md border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className="px-2 py-1 text-left font-semibold text-slate-700">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-200">
                      {preview.headers.map((header) => (
                        <td key={header} className="px-2 py-1 text-slate-700">
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
    </div>
  );
}
