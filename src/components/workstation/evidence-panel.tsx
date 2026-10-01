"use client";
import { memo } from "react";
import { Camera, ImageIcon, Trash2 } from "lucide-react";
import { earlierTimestampBasis, evidenceSource, sectionEvidenceIds } from "@/lib/workstation/evidence";
import { evidenceUsage } from "@/lib/workstation/image-assets";
import type { Evidence, Trade, TradeDocument } from "@/lib/workstation/types";
import type { ReviewSectionKey } from "@/lib/workstation/notion-template";
import type { sectionChoices } from "@/lib/workstation/template-layout";
import { PendingEvidence } from "./pending-evidence";
import { EvidenceThumbnail, EvidenceDownload } from "./evidence-preview";
import { useStableCallbacks } from "./use-stable-callbacks";
type Props = { documentState: TradeDocument | null; trade: Trade; mode: "demo" | "application"; replay: number | null; reviewSections: ReturnType<typeof sectionChoices>; onRecover: (evidence: Evidence, section?: ReviewSectionKey) => Promise<void>; onCapture: () => void; onRemove: (id: string) => void; onAssign: (section: ReviewSectionKey, id: string, checked: boolean) => void };
export function EvidencePanel(props: Props) { const stable = useStableCallbacks(props); return <Panel {...stable} />; }
const Panel = memo(function EvidencePanel({ documentState, trade, mode, replay, reviewSections, onRecover, onCapture, onRemove, onAssign }: Props) {
  return (
    <div className="ws-evidence">
      <PendingEvidence key={`${mode}:${trade.id}:${trade.timeInterpretationVersion}:${trade.stale}`} tradeId={trade.id} mode={mode} savedIds={documentState?.evidence.map(e => e.id) ?? []} readOnly={!!trade.stale} onRecover={onRecover} />
      <p role="status" className="ws-help">{documentState ? `${documentState.evidence.length}/30 images · ${(evidenceUsage(documentState.evidence).bytes / 1_000_000).toFixed(2)}/50 MB originals · ${(evidenceUsage(documentState.evidence).remainingBytes / 1_000_000).toFixed(2)} MB remaining${evidenceUsage(documentState.evidence).warning ? " · Storage warning: at least 80% used" : ""}` : "Loading image usage…"}</p>
      {replay !== null && <p className="ws-replay-notice" role="note">Saved evidence may contain hindsight. New chart captures record the current replay cutoff.</p>}
      <div className="ws-executions-toolbar">
        <span>Evidence saved with this review</span>
        <button disabled={trade.stale} onClick={() => onCapture()}>
          <Camera size={14} /> Capture chart
        </button>
      </div>
      {!documentState?.evidence.length ? (
        <div className="ws-empty">
          <ImageIcon size={23} />
          <p>Keep the chart behind the decision.</p>
          <span>
            Attach an annotated snapshot, then include it in your Notion export.
          </span>
        </div>
      ) : (
        <div className="ws-evidence-grid">
          {documentState.evidence
            .map((e) => (
              <div key={e.id}>
                <EvidenceThumbnail evidence={e} />
                <strong className="ws-evidence-name">{e.name}</strong>
                <small className="ws-evidence-source">{evidenceSource(e)}</small>
                <span>
                  {e.origin ? "Imported image" : e.timeframe} · r{e.revision}
                  {earlierTimestampBasis(e, trade.timeInterpretationVersion ?? "original") && (e.timeInterpretationVersion || trade.executions.some(fill => fill.provenance?.interpretationStatus === "applied")) && <small>Earlier timestamp basis</small>}
                  <EvidenceDownload evidence={e} />
                  <button
                    title="Remove attachment"
                    disabled={trade.stale}
                    onClick={() =>
                      { onRemove(e.id); }
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
                {e.replayAt !== undefined && <small>Replay · {new Date(e.replayAt * 1000).toISOString()}</small>}
                <p className="ws-evidence-assignments">{reviewSections.filter(([key]) => sectionEvidenceIds(documentState.review.notion, key).includes(e.id)).map(([, label]) => label).join(", ") || "Unassigned"}</p>
                <details className="ws-evidence-sections"><summary>Assign sections</summary>
                  {reviewSections.map(([key, label]) => <label key={key}><input type="checkbox" checked={sectionEvidenceIds(documentState.review.notion, key).includes(e.id)} disabled={trade.stale}
                    onChange={event => { onAssign(key, e.id, event.target.checked); }} />{label}</label>)}
                </details>
              </div>
            ))}
        </div>
      )}
    </div>
  );

}, (a, b) => a.documentState?.evidence === b.documentState?.evidence && a.documentState?.review.notion === b.documentState?.review.notion && Object.keys(a).every(key => key === "documentState" || Object.is(a[key as keyof Props], b[key as keyof Props])));
