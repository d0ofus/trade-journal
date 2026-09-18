"use client";
import { assignSectionEvidence, sectionEvidenceIds } from "@/lib/workstation/evidence";
import { emptyNotionReview, reviewSections, type ReviewSectionKey } from "@/lib/workstation/notion-template";
import type { Review, TradeDocument } from "@/lib/workstation/types";

export function SectionAttachments({ section, document, onChange, onEvidence }: {
  section: ReviewSectionKey; document: TradeDocument;
  onChange: (update: (review: Review) => Review) => void;
  onEvidence: (section: ReviewSectionKey) => void;
}) {
  const label = reviewSections.find(([key]) => key === section)![1];
  const ids = sectionEvidenceIds(document.review.notion, section);
  const assign = (id: string, checked: boolean) => onChange(review => ({ ...review,
    notion: assignSectionEvidence(review.notion ?? emptyNotionReview(), section, id, checked),
  }));
  return <div className="ws-section-attachments">
    <button type="button" className="ws-add-evidence" onClick={() => onEvidence(section)}>Attach current chart to {label}</button>
    {document.evidence.filter(e => ids.includes(e.id)).map(e => <figure key={e.id} className="ws-section-preview">
      {/* Stored, size-validated PNG evidence; Next image optimization is unnecessary. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a href={e.image} download={`${e.name.replace(/[^a-z0-9._-]/gi, "_")}.png`}><img src={e.image} alt={e.name} loading="lazy" /></a>
      <figcaption>{e.name}<button type="button" onClick={() => assign(e.id, false)} aria-label={`Detach ${e.name} from ${label}`}>Detach</button></figcaption>
    </figure>)}
    <fieldset className="ws-section-evidence"><legend>Captured charts</legend>{document.evidence.length ? document.evidence.map(e => <label key={e.id}>
      <input type="checkbox" checked={ids.includes(e.id)} onChange={event => assign(e.id, event.target.checked)} />{e.name}
    </label>) : <p className="ws-help">Attach a chart, then reuse it in any review section.</p>}</fieldset>
  </div>;
}
