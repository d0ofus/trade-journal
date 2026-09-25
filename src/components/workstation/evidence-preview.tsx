"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { Evidence } from "@/lib/workstation/types";
import { evidenceBlob } from "@/lib/workstation/evidence-storage";
import { downloadBlob } from "@/lib/workstation/export";

export const EvidenceViewerContext = createContext<(id: string) => void>(() => {});
export const EvidenceTradeContext = createContext("");
function useEvidenceUrl(evidence: Evidence, variant: "thumbnail" | "original", enabled = true) {
  const trade = useContext(EvidenceTradeContext), key = `${trade}:${evidence.id}:${evidence.asset?.id ?? "inline"}:${variant}`;
  const [state, setState] = useState({ key: "", url: "", error: "" });
  useEffect(() => {
    if (!enabled || !evidence.asset) return;
    let url = ""; const controller = new AbortController();
    void evidenceBlob(trade, evidence, variant, controller.signal).then(blob => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setState({ key, url, error: "" }); } }).catch(error => { if (!controller.signal.aborted) setState({ key, url: "", error: error instanceof Error ? error.message : "Image unavailable" }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [trade, evidence.id, evidence.image, evidence.asset?.id, variant, enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return !evidence.asset ? { url: evidence.image, error: "" } : state.key === key && enabled ? state : { url: "", error: "" };
}
export const evidenceFilename = (name: string) => `${name.replace(/\.png$/i, "").replace(/[^a-z0-9._-]/gi, "_")}.png`;

export function EvidenceThumbnail({ evidence }: { evidence: Evidence }) {
  const open = useContext(EvidenceViewerContext);
  const target = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = target.current; if (!node) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "160px" });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const source = useEvidenceUrl(evidence, "thumbnail", visible);
  return <button ref={target} type="button" className="ws-evidence-thumbnail" aria-label={`View ${evidence.name}`} onClick={() => open(evidence.id)}>
    {/* Size-validated embedded PNG; no remote image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {source.url ? <img src={source.url} alt={evidence.name} loading="lazy" /> : <span role="status">{source.error || "Loading preview…"}</span>}
  </button>;
}
export function EvidenceDownload({ evidence }: { evidence: Evidence }) {
  const trade = useContext(EvidenceTradeContext), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  // Keep keyboard focus in the viewer during retrieval; disabling the focused
  // button sends focus to the document and prevents Escape from closing it.
  return <><button type="button" className="ws-evidence-download" aria-disabled={loading} aria-busy={loading} onClick={() => { if (loading) return; setLoading(true); setError(""); void evidenceBlob(trade, evidence).then(blob => downloadBlob(blob, evidenceFilename(evidence.name))).catch(e => setError(e instanceof Error ? e.message : "Download failed")).finally(() => setLoading(false)); }} aria-label={`Download ${evidence.name}`} title="Download original image"><Download size={14} /></button>{error && <span role="alert">{error}</span>}</>;
}

export function EvidenceViewer({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
  const source = useEvidenceUrl(evidence, "original");
  const [actualSize, setActualSize] = useState(false), [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const dialog = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const backdrop = dialog.current?.parentElement;
    const siblings = backdrop?.parentElement ? Array.from(backdrop.parentElement.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdrop).map(node => ({ node, inert: node.inert })) : [];
    siblings.forEach(({ node }) => { node.inert = true; });
    close.current?.focus();
    return () => { siblings.forEach(({ node, inert }) => { node.inert = inert; }); if (before?.isConnected) before.focus({ preventScroll: true }); };
  }, []);
  return <div className="ws-modal-backdrop ws-evidence-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={dialog} className="ws-modal ws-evidence-viewer" role="dialog" aria-modal="true" aria-label={`Image preview: ${evidence.name}`} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const nodes = Array.from(dialog.current!.querySelectorAll<HTMLElement>("button,a[href]"));
        const first = nodes[0], last = nodes.at(-1)!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}>
      <header className="ws-modal-heading"><h2>{evidence.name}</h2><EvidenceDownload evidence={evidence} /><button ref={close} aria-label="Close image preview" onClick={onClose}><X size={18} /></button></header>
      <div className="ws-evidence-view-controls"><span>{size ? `${size.width} × ${size.height} px` : "Loading image…"}</span><button type="button" aria-pressed={!actualSize} onClick={() => setActualSize(false)}>Fit</button><button type="button" aria-pressed={actualSize} onClick={() => setActualSize(true)}>100%</button></div>
      <div className={`ws-evidence-image-scroll${actualSize ? " ws-evidence-actual-size" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {source.url ? <img className="ws-evidence-full-image" src={source.url} alt={evidence.name} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : <p role="status">{source.error || "Retrieving original image…"}</p>}
      </div>
      {evidence.replayAt !== undefined && <p className="ws-help">Replay capture · {new Date(evidence.replayAt * 1000).toISOString()}</p>}
    </div>
  </div>;
}
