"use client";
import { useCallback, useEffect, useState } from "react";
type Status = { intervals: string[]; attachmentBytes: number; enabled: boolean; preparation: boolean; usage: null | { cacheBytes: number; databaseBytes: number; cacheLimit: number; databaseLimit: number; warning: boolean; persistencePaused: boolean }; counts: Record<string, number>; issues: { key: string; symbol: string; timeframe: string; start: string; end: string; status: string; lastError: string | null }[] };
export function MarketDataSettings() {
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/workstation/market-data", { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Cache status unavailable."); setStatus(body); setError("");
  }, []);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  const working = busy || (status?.preparation && !status?.usage?.persistencePaused && (!!status?.counts.pending || !!status?.counts.running));
  useEffect(() => { if (!working) return; const timer = setInterval(() => { void refresh().catch(e => setError(e.message)); }, 5000); return () => clearInterval(timer); }, [working, refresh]);
  async function action(action: "plan" | "run" | "retry" | "pilot") {
    setBusy(true); setError(""); setMessage("");
    try { const response = await fetch("/api/workstation/market-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setStatus(body); setMessage(body.result?.paused ?? (action === "run" ? `Completed ${body.result?.processed ?? 0} windows in this batch. Remaining work is saved.` : "Preparation queue updated.")); }
    catch (e) { setError(e instanceof Error ? e.message : "Preparation paused. Retry to resume."); }
    finally { setBusy(false); }
  }
  const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
  return <div className="space-y-4 text-sm" aria-busy={busy}>
    <p>Charts display saved history first. Alpaca fills uncovered periods; Yahoo fallback stays a separate, labelled series.</p>
    {status && <>
      <p>Cache: <strong>{status.enabled ? "Enabled" : "Not enabled"}</strong> · Background preparation: <strong>{status.preparation ? "Enabled" : "Not enabled"}</strong></p>
      {status.usage && <div className="grid gap-3 sm:grid-cols-2">
        <p>Chart cache: <strong>{mb(status.usage.cacheBytes)}</strong> / {mb(status.usage.cacheLimit)}</p>
        <p>Databases on this branch: <strong>{mb(status.usage.databaseBytes)}</strong> / {mb(status.usage.databaseLimit)} growth guard</p>
      </div>}
      <p>Automatic preparation: <strong>{status.intervals.join(" / ")}</strong>. Other intervals load on demand. Saved history is retained without automatic eviction.</p>
      <p>Stored attachment URLs / inline data: <strong>{mb(status.attachmentBytes)}</strong>. External files, if configured, use separate storage.</p>
      {status.usage?.persistencePaused ? <p role="status">Storage limit reached. Existing history is preserved. New history can be viewed temporarily; preparation resumes when storage permits.</p> : status.usage?.warning && <p role="status">Storage is approaching the growth guard. Review usage before preparing more history.</p>}
      <div className="flex flex-wrap gap-4" aria-label="Preparation progress">{["pending", "running", "done", "failed", "unavailable"].map(key => <span key={key}>{key === "done" ? "Complete" : key}: <strong>{status.counts[key] ?? 0}</strong></span>)}</div>
      <p className="text-xs text-slate-500">Storage measurements cover this database branch. Check project-level storage, compute and transfer usage in Neon before the initial preload. Requests are limited to 60/minute in the background; a batch can run for several minutes. Closing this page does not erase queued work.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />I have checked Neon project Usage and have headroom for the initial preload.</label>
      <div className="flex flex-wrap gap-2">{([['pilot', 'Prepare 10 recent trades'], ['plan', 'Queue all trade windows'], ['run', 'Run / resume batch'], ['retry', 'Retry failed windows']] as const).map(([key, label]) => <button className="rounded-md border px-3 py-2 disabled:opacity-50" key={key} disabled={busy || !status.enabled || (key !== "pilot" && !status.preparation) || !checked || status.usage?.persistencePaused} onClick={() => void action(key)}>{label}</button>)}<button className="rounded-md border px-3 py-2" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>Refresh status</button></div>
      {status.issues.length > 0 && <details><summary className="cursor-pointer">Unavailable / empty periods and errors ({status.issues.length} latest)</summary><ul className="mt-2 space-y-2">{status.issues.map(issue => <li key={issue.key}>{issue.symbol} · {issue.timeframe} · {issue.start.slice(0, 10)}–{issue.end.slice(0, 10)} · {issue.lastError ?? issue.status}</li>)}</ul></details>}
    </>}
    {busy && <p role="status">Preparing a bounded batch. Previously saved progress is retained.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
