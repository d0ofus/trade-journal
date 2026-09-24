"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { storageGuard, type StorageUsage } from "@/lib/storage-usage";

function bytes(value: number) { return value < 1_000_000 ? `${(value / 1000).toFixed(1)} KB` : `${(value / 1_000_000).toFixed(1)} MB`; }
function Guard({ value, kind, label }: { value: number; kind: "cache" | "branch"; label: string }) {
  const guard = storageGuard(value, kind);
  return <div className="rounded-lg border border-slate-200 p-4">
    <h3 className="font-medium">{label}</h3><p className="my-2 font-mono">{bytes(value)} / {bytes(guard.limit)} · {guard.status}</p>
    <div role="progressbar" aria-label={label} aria-valuenow={guard.percent} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded bg-slate-100">
      <div className="h-full" style={{ width: `${guard.percent}%`, backgroundColor: guard.status === "Paused" ? "#dc2626" : guard.status === "Warning" ? "#d97706" : "#059669" }} />
    </div>
    <p className="mt-2 text-xs text-slate-600">{bytes(guard.remaining)} headroom · Warning at {bytes(guard.warningAt)} · Cache persistence pauses at {bytes(guard.pauseAt)}</p>
  </div>;
}
export function StorageMonitor() {
  const [usage, setUsage] = useState<StorageUsage | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const response = await fetch("/api/settings/storage", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Storage measurements unavailable.");
      if (!controller.signal.aborted) { setUsage(body); setError(""); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Storage measurements unavailable."); }
    finally { if (pending.current === controller) pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => { clearInterval(timer); pending.current?.abort(); pending.current = null; };
  }, [refresh]);
  const database = usage?.database, payloads = usage?.payloads;
  return <div className="space-y-4 text-sm" data-testid="cloud-storage-monitor" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-slate-600">App storage · {usage ? `Measured ${new Date(usage.measuredAt).toLocaleString()}` : "Awaiting measurement"}{error && usage ? " · Stale reading" : ""}</p>
      <button className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing…" : "Refresh storage"}</button>
    </div>
    {error && <p role="alert" className="text-amber-800">{error}</p>}
    {usage?.issues.map(issue => <p role="status" key={issue} className="text-amber-800">{issue}</p>)}
    {usage?.evidence && <section className="rounded-lg border p-4"><h3>Private R2 evidence · Standard storage</h3><p>{bytes(usage.evidence.originals)} originals ({usage.evidence.assets} unique assets) · {bytes(usage.evidence.thumbnails)} thumbnails · {bytes(usage.evidence.pending)} pending upload reservations.</p>
      {usage.evidence.account ? <><p>All applications in this R2 account: {(usage.evidence.account.standardBytes / 1e9).toFixed(2)} GB Standard · {usage.evidence.account.otherClassBytes === null ? "Other storage-class usage unavailable" : `${(usage.evidence.account.otherClassBytes / 1e9).toFixed(2)} GB other storage classes`}.</p><p>Measured {new Date(usage.evidence.account.measuredAt).toLocaleString()}{usage.evidence.account.stale ? " · Stale account reading" : " · Provider metrics may be delayed"}</p>{usage.evidence.account.warning && <p role="status">{usage.evidence.account.warning}</p>}<p>Estimated Standard storage at this level: US${usage.evidence.account.estimatedMonthlyStorageUsd.toFixed(3)}/month. This is not an invoice: monthly average usage, operation charges, other classes and taxes can differ. Workers charges are separate.</p></> : <p>Account-wide R2 usage and cost estimate unavailable. Configure read-only account metrics access.</p>}
      <p>8/9/10 GB warnings are advisory. Workers Paid does not enlarge R2&apos;s included allowance. Publishing to Notion does not remove originals.</p></section>}
    {database ? <>
      <p>Current database: <strong>{bytes(database.currentBytes)}</strong> physical storage.</p>
      <div className="grid gap-3 md:grid-cols-2"><Guard value={database.branchBytes} kind="branch" label="Databases on this branch" /><Guard value={database.cacheBytes} kind="cache" label="Chart and metric cache" /></div>
      <p className="text-xs text-slate-600">Application growth guards, not cloud plan quotas. The cache is included in database usage; metric cache ({bytes(database.metricCacheBytes)}) is included in chart/cache totals. These figures are not added together.</p>
    </> : <p>Database sizes: unavailable</p>}
    {payloads ? <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt>Inline chart image payloads</dt><dd className="font-mono">{bytes(payloads.inlineBytes)} · {payloads.inlineCount} references</dd></div>
      <div><dt>Workstation portion of inline images</dt><dd className="font-mono">{bytes(payloads.workstationInlineBytes)} · {payloads.workstationInlineCount} references</dd></div>
      <div><dt>Archived import payloads</dt><dd className="font-mono">{bytes(payloads.importBytes)} · {payloads.importCount} archives</dd></div>
      <div><dt>External screenshot references</dt><dd className="font-mono">{payloads.externalCount} · Storage bytes: Not measured</dd></div>
      <div><dt>Local screenshot references</dt><dd className="font-mono">{payloads.localCount} · Storage bytes: Not measured</dd></div>
    </dl> : <p>Attachment and import payloads: unavailable</p>}
    <p className="text-xs text-slate-600">Payload sizes measure stored text, including base64 image encoding, before database compression and indexes. They describe content already inside the database; they are not additional physical storage. External references do not measure a provider account’s usage. Refreshes every minute while this page is visible.</p>
  </div>;
}
