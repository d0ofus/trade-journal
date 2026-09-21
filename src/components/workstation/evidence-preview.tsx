"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import type { Evidence } from "@/lib/workstation/types";

export const EvidenceViewerContext = createContext<(id: string) => void>(() => {});
export const evidenceFilename = (name: string) => `${name.replace(/\.png$/i, "").replace(/[^a-z0-9._-]/gi, "_")}.png`;

export function EvidenceThumbnail({ evidence }: { evidence: Evidence }) {
  const open = useContext(EvidenceViewerContext);
  return <button type="button" className="ws-evidence-thumbnail" aria-label={`View ${evidence.name}`} onClick={() => open(evidence.id)}>
    {/* Size-validated embedded PNG; no remote image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={evidence.image} alt={evidence.name} loading="lazy" />
  </button>;
}
export function EvidenceDownload({ evidence }: { evidence: Evidence }) {
  return <a className="ws-evidence-download" href={evidence.image} download={evidenceFilename(evidence.name)} aria-label={`Download ${evidence.name}`} title="Download image"><Download size={14} /></a>;
}

export function EvidenceViewer({ evidence, onClose }: { evidence: Evidence; onClose: () => void }) {
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
      <img className="ws-evidence-full-image" src={evidence.image} alt={evidence.name} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      </div>
      {evidence.replayAt !== undefined && <p className="ws-help">Replay capture · {new Date(evidence.replayAt * 1000).toISOString()}</p>}
    </div>
  </div>;
}
