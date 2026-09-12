"use client";
import { useCallback, useEffect, useState } from "react";
import type { InterpretationRow } from "@/lib/server/execution-time-interpretation";
type Batch = { id: string; filename: string; importedAt: string; _count: { executions: number }; timeInterpretation: { active: boolean; revision: number; timezone: string } | null };
type Preview = { batchId: string; timezone: string; fingerprint: string; revision: number; total: number; eligible: number; rows: InterpretationRow[] };
const endpoint = "/api/workstation/timestamp-interpretations";
const utc = (time: number) => new Date(time * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
async function request<T>(url: string, init?: RequestInit): Promise<T> { const res = await fetch(url, { cache: "no-store", ...init }); const body = await res.json(); if (!res.ok) throw new Error(body.error ?? "Request failed"); return body; }
export function TimestampInterpretationSettings() {
  const [batches, setBatches] = useState<Batch[]>([]), [cursor, setCursor] = useState<string | null>(null), [preview, setPreview] = useState<Preview | null>(null), [timezone, setTimezone] = useState("America/New_York"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const refresh = useCallback(async () => { const result = await request<{ batches: Batch[]; nextCursor: string | null }>(endpoint); setBatches(result.batches); setCursor(result.nextCursor); }, []);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [refresh]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); } }
  function inspect(id: string) { void run(async () => { setPreview(null); setPreview(await request<Preview>(`${endpoint}?batchId=${encodeURIComponent(id)}&timezone=${encodeURIComponent(timezone)}`)); }); }
  function mutate(batchId: string, expectedRevision: number, action: "confirm" | "disable") { void run(async () => {
    await request(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId, expectedRevision, action, ...(action === "confirm" ? { timezone: preview!.timezone, fingerprint: preview!.fingerprint } : {}) }) });
    setPreview(null); await refresh(); setNotice(action === "confirm" ? "User-confirmed interpretation saved. Imported records are unchanged." : "Interpretation disabled. The workstation will use the original stored times.");
    try { localStorage.setItem("execution-lab:time-interpretation-update", String(Date.now())); } catch { /* Other tabs can reload to retrieve the confirmed interpretation. */ }
    window.dispatchEvent(new Event("workstation-time-interpretation"));
  }); }
  return <section className="space-y-4 text-sm" aria-label="Timestamp interpretation">
    <p>Confirm the timezone of an archived broker report to interpret its execution times in the workstation. Charts, replay and review exports use the interpreted UTC time. Accounting records and import automation stay unchanged.</p>
    <label className="flex flex-wrap items-center gap-3">Source timezone <select className="rounded border border-slate-300 bg-white p-2 text-slate-900" aria-label="Source timezone" value={timezone} disabled={busy} onChange={e => { setTimezone(e.target.value); setPreview(null); }}><option value="America/New_York">US Eastern — America/New_York (EDT / EST)</option><option value="UTC">UTC</option></select></label>
    <p className="text-slate-500">Confirmation applies to one batch. New batches remain unverified. Explicit timestamp offsets are preserved; ambiguous or unsupported timestamps are left unresolved.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status" className="text-emerald-700">{notice}</p>}
    <div className="max-h-72 overflow-auto rounded border border-slate-200">
      {!batches.length && <p className="p-3">No execution batches available.</p>}
      {batches.map(batch => <div key={batch.id} className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3"><div className="min-w-0 flex-1"><p className="break-all font-medium">{batch.filename}</p><p className="text-xs text-slate-500">{batch._count.executions} executions · {batch.timeInterpretation?.active ? `User-confirmed ${batch.timeInterpretation.timezone}` : "Unverified / disabled"}</p></div><button className="rounded border px-3 py-2" disabled={busy} onClick={() => inspect(batch.id)}>Preview times</button>{batch.timeInterpretation?.active && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => mutate(batch.id, batch.timeInterpretation!.revision, "disable")}>Disable</button>}</div>)}
      {cursor && <button className="p-3 underline" disabled={busy} onClick={() => void run(async () => { const next = await request<{ batches: Batch[]; nextCursor: string | null }>(`${endpoint}?cursor=${encodeURIComponent(cursor)}`); setBatches(old => [...old, ...next.batches]); setCursor(next.nextCursor); })}>Older batches</button>}
    </div>
    {preview && <div className="space-y-3 rounded border border-violet-300 p-3"><p><strong>{preview.eligible} of {preview.total}</strong> timestamps can be interpreted. {preview.total - preview.eligible} remain unresolved. Showing {preview.rows.length} rows.</p><div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{["Execution", "Broker time", "Stored UTC", "Interpreted UTC", "Status"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{preview.rows.map(row => <tr key={row.executionId} className="border-t"><td className="p-2">{row.symbol} {row.side} {row.quantity} @ {row.price}</td><td className="whitespace-nowrap p-2">{row.brokerWallTime || "Unavailable"}</td><td className="whitespace-nowrap p-2">{utc(row.storedTime)}</td><td className="whitespace-nowrap p-2">{row.interpretedTime === null ? "Unresolved" : utc(row.interpretedTime)}</td><td className="p-2">{row.status}</td></tr>)}</tbody></table></div><button className="rounded bg-violet-600 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !preview.eligible} onClick={() => mutate(preview.batchId, preview.revision, "confirm")}>Confirm this report uses {preview.timezone === "UTC" ? "UTC" : "US Eastern"}</button></div>}
  </section>;
}
