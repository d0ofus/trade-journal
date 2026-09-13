"use client";
import { useCallback, useEffect, useState } from "react";
type Account = { id: string; ibkrAccount: string; policy: null | { active: boolean; revision: number; timezone: string; ready: number; pending: number; unresolved: number; exceptions: number } };
type Preview = { accountId: string; account: string; revision: number; fingerprint: string; total: number; eligible: number; reports: { batchId: string; filename: string; status: string; reason: string | null; eligible: number; total: number }[] };
const endpoint = "/api/workstation/timestamp-interpretations";
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { cache: "no-store", ...init }); const body = await response.json(); if (!response.ok) throw Error(body.error ?? "Account timestamp policy unavailable."); return body; }
export function AccountTimestampSettings() {
  const [accounts, setAccounts] = useState<Account[]>([]), [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const refresh = useCallback(async () => { setAccounts((await request<{ accounts: Account[] }>(`${endpoint}?accounts=1`)).accounts); }, []);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); try { await action(); } catch(e) { setError(e instanceof Error ? e.message : "Request failed"); } finally { setBusy(false); } }
  function save(accountId: string, expectedRevision: number, action: "confirm-account" | "disable-account" | "prepare-account") { void run(async () => {
    await request(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, accountId, expectedRevision, ...(action === "confirm-account" ? { fingerprint: preview!.fingerprint } : {}) }) });
    setPreview(null); await refresh(); setNotice(action === "disable-account" ? "Account default disabled. Report-specific interpretations remain in place." : "Account policy saved. Matching reports are prepared independently of ingestion; unresolved reports stay visible below.");
    try { localStorage.setItem("execution-lab:time-interpretation-update", String(Date.now())); } catch { /* Reload also refreshes the workstation. */ }
    window.dispatchEvent(new Event("workstation-time-interpretation"));
  }); }
  return <section className="space-y-3 rounded border border-violet-300 p-3" aria-label="Account timestamp defaults">
    <h3 className="font-medium">Account default — US Eastern</h3>
    <p>Use America/New_York, including EDT / EST, for matching archived IBKR execution reports and future imports. Original timestamps and accounting remain unchanged. Explicit offsets and report-specific exceptions take precedence.</p>
    {accounts.map(a => <div key={a.id} className="flex flex-wrap items-center gap-2 border-t py-2"><div className="min-w-0 flex-1"><strong>{a.ibkrAccount}</strong><p className="text-xs">{a.policy?.active ? `${a.policy.ready} ready · ${a.policy.unresolved} unresolved · ${a.policy.exceptions} report exceptions` : "No active account default"}</p></div><button className="rounded border px-3 py-2" disabled={busy} onClick={() => void run(async () => { setPreview(await request(`${endpoint}?accountId=${encodeURIComponent(a.id)}`)); })}>Preview account</button>{a.policy?.active && <><button className="rounded border px-3 py-2" disabled={busy} onClick={() => save(a.id, a.policy!.revision, "prepare-account")}>Resume preparation</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => save(a.id, a.policy!.revision, "disable-account")}>Disable default</button></>}</div>)}
    {preview && <div><p>{preview.eligible} of {preview.total} executions eligible across {preview.reports.length} reports.</p><div className="my-3 max-h-60 overflow-auto">{preview.reports.map(r => <p className="border-t py-2 text-xs" key={r.batchId}>{r.filename} · {r.eligible}/{r.total} · {r.reason ?? r.status}</p>)}</div><button className="rounded bg-violet-600 px-3 py-2 text-white" disabled={busy || !preview.eligible} onClick={() => save(preview.accountId, preview.revision, "confirm-account")}>Use Eastern time for this account’s matching IBKR reports</button></div>}
    <button className="underline" disabled={busy} onClick={() => void run(refresh)}>Refresh policy status</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
  </section>;
}
