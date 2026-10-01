"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, ChartNoAxesCombined } from "lucide-react";
import { fundamentalPeriod, fundamentalSources, type FundamentalsCapture, type FundamentalsMode, type FundamentalsSnapshot, fundamentalsCutoff } from "@/lib/workstation/fundamentals";
import { allFundamentalsSeries, hasVisibleFundamentals, type FundamentalsSeries } from "@/lib/workstation/fundamentals-series";
import type { Trade } from "@/lib/workstation/types";
import { FundamentalsMini, FundamentalsProfile, captureFundamentalsSvg } from "./fundamentals-profile";
import { ReviewDialog } from "./review-dialog";
import "./fundamentals.css";

export type AttachFundamentals = (canvas: HTMLCanvasElement, metadata: FundamentalsCapture) => Promise<void>;
export function FundamentalsSection({ trade, mode: applicationMode, onAttach }: { trade: Trade; mode: "application" | "demo"; onAttach: AttachFundamentals }) {
  const [mode, setMode] = useState<FundamentalsMode>("before-entry"), [attempt, setAttempt] = useState(0);
  const [seriesVisibility, setSeriesVisibility] = useState(allFundamentalsSeries);
  const [loaded, setLoaded] = useState<{ key: string; data: FundamentalsSnapshot } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const capture = useRef<HTMLDivElement>(null), alive = useRef(true), generation = useRef(0), capturing = useRef(false);
  const key = `${trade.id}:${trade.timeInterpretationVersion}:${mode}`;
  const data = loaded?.key === key ? loaded.data : null;
  const cutoff = mode === "before-entry" ? fundamentalsCutoff(trade) : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    async function load() {
      setLoading(true); setError(""); setMessage("");
      try {
        let value: FundamentalsSnapshot;
        if (applicationMode === "demo") {
          const { demoFundamentals } = await import("@/lib/workstation/fundamentals-demo");
          value = demoFundamentals(trade, mode);
        } else {
          const response = await fetch(`/api/workstation/fundamentals?${new URLSearchParams({ tradeId: trade.id, mode })}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" });
          const json = await response.json();
          if (!response.ok || json.error) throw new Error(json.error ?? "Fundamentals could not be loaded.");
          value = json as FundamentalsSnapshot;
        }
        if (current) setLoaded({ key, data: value });
      } catch (e) { if (current) setError(e instanceof Error ? e.message : "Fundamentals could not be loaded."); }
      finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; controller.abort(); };
  }, [key, mode, applicationMode, attempt, trade]);
  const changeMode = () => { if (capturing.current) return; generation.current++; setMode(value => value === "before-entry" ? "latest" : "before-entry"); setMessage(""); };
  const toggleSeries = (series: FundamentalsSeries) => {
    if (capturing.current) return;
    generation.current++;
    setSeriesVisibility(value => ({ ...value, [series]: !value[series] })); setMessage("");
  };
  const toggle = (location: string) => <label className="ws-fundamentals-toggle"><input type="checkbox" aria-label={`Before entry fundamentals ${location}`} checked={mode === "before-entry"} disabled={busy} onChange={changeMode} /><span>Before entry</span><small>{mode === "latest" ? "Latest available" : cutoff ? `Filed before ${cutoff} · NY` : "Entry date unresolved"}</small></label>;
  const attach = async () => {
    if (capturing.current || !canAttach || !data) return;
    const svg = capture.current?.querySelector("svg"); if (!svg) return;
    const current = generation.current;
    const frozen = structuredClone(data);
    const frozenVisibility = { ...seriesVisibility };
    capturing.current = true;
    setBusy(true); setMessage("");
    try {
      const canvas = await captureFundamentalsSvg(svg);
      if (!alive.current || current !== generation.current) throw new Error("Snapshot cancelled because the selected trade or view changed.");
      const { symbol, mode, cutoff, issuer, quarters, fetchedAt, stale } = frozen;
      await onAttach(canvas, { symbol, mode, cutoff, issuer, quarters, fetchedAt, stale, seriesVisibility: frozenVisibility, capturedAt: new Date().toISOString() });
      if (alive.current) setMessage("Snapshot attached to Fundamentals.");
    } catch (e) { if (alive.current) setMessage(e instanceof Error ? e.message : "Snapshot could not be attached."); }
    finally { capturing.current = false; if (alive.current) setBusy(false); }
  };
  const canAttach = !!data && hasVisibleFundamentals(data.quarters, seriesVisibility) && !busy && !loading && !trade.stale;
  const feedback = <>{loading && <p role="status" className="ws-help">Loading SEC fundamentals…</p>}{(error || data?.message) && <p role="status" className="ws-fundamentals-status">{error || data?.message}{!loading && (error || data?.retryable) && <button type="button" disabled={busy} onClick={() => setAttempt(n => n + 1)}>Retry</button>}</p>}{message && <p role="status" className="ws-help">{message}</p>}</>;
  return <div className="ws-fundamentals" aria-label="Earnings profile">
    {toggle("preview")}
    {applicationMode === "demo" && <small className="ws-help">Illustrative demo fundamentals</small>}
    {data?.quarters.length ? <div className="ws-fundamentals-minis"><FundamentalsMini quarters={data.quarters} metric="revenue" /><FundamentalsMini quarters={data.quarters} metric="netIncome" /></div> : loading ? <div className="ws-fundamentals-skeleton" aria-hidden="true" /> : null}
    <div className="ws-fundamentals-actions"><button type="button" className="ws-primary" onClick={() => setOpen(true)}><ChartNoAxesCombined size={14} /> View fundamentals</button><button type="button" disabled={!canAttach} onClick={() => void attach()}><Camera size={14} />{busy ? "Attaching…" : "Attach snapshot"}</button></div>
    {feedback}
    <small className="ws-help">Preview stays in your journal. Only attached snapshots are published.</small>
    {data?.quarters.length ? <div className="ws-fundamentals-capture" aria-hidden="true" ref={capture}><FundamentalsProfile data={data} demo={applicationMode === "demo"} seriesVisibility={seriesVisibility} /></div> : null}
    {open && <ReviewDialog title={`${trade.symbol} fundamentals`} onClose={() => setOpen(false)}><div className="ws-fundamentals-dialog">
      <div className="ws-fundamentals-dialog-toolbar">{toggle("dialog")}<button type="button" className="ws-primary" disabled={!canAttach} onClick={() => void attach()}><Camera size={14} />{busy ? "Attaching…" : "Attach snapshot"}</button></div>
      {feedback}
      {!!data?.quarters.length && <><FundamentalsProfile data={data} demo={applicationMode === "demo"} interactive seriesVisibility={seriesVisibility} onToggleSeries={toggleSeries} disabled={busy} /><details className="ws-fundamentals-sources"><summary>Quarterly filing sources</summary>{data.quarters.map(q => <div key={q.periodEnd}><strong>{fundamentalPeriod(q)} · {q.periodEnd}</strong>{fundamentalSources(q).map(s => <a key={`${s.accession}:${s.tag}`} href={applicationMode === "demo" ? undefined : `https://www.sec.gov/Archives/edgar/data/${Number(data.issuer?.cik)}/${s.accession.replaceAll("-", "")}/${s.accession}-index.html`} target="_blank" rel="noreferrer">{s.form} · {s.filed} · {s.tag}</a>)}</div>)}</details></>}
    </div></ReviewDialog>}
  </div>;
}
