"use client";
import { assignSectionEvidence, sectionEvidenceIds } from "@/lib/workstation/evidence";
import { emptyNotionReview, reviewSections, type ReviewSectionKey } from "@/lib/workstation/notion-template";
import type { Review, TradeDocument } from "@/lib/workstation/types";

export function SectionAttachments({ section, document, onChange, onEvidence, onImage, readOnly = false }: {
  section: ReviewSectionKey; document: TradeDocument;
  onChange: (update: (review: Review) => Review) => void;
  onEvidence: (section: ReviewSectionKey) => void;
  onImage: (section: ReviewSectionKey) => void;
  readOnly?: boolean;
}) {
  const label = reviewSections.find(([key]) => key === section)![1];
  const ids = sectionEvidenceIds(document.review.notion, section);
  const assign = (id: string, checked: boolean) => onChange(review => ({ ...review,
    notion: assignSectionEvidence(review.notion ?? emptyNotionReview(), section, id, checked),
  }));
  return <div className="ws-section-attachments">
    <div className="ws-section-attachment-actions">
      <button type="button" className="ws-add-evidence" disabled={readOnly} onClick={() => onEvidence(section)}>Attach current chart to {label}</button>
      <button type="button" disabled={readOnly} onClick={() => onImage(section)}>Attach image</button>
    </div>
    {document.evidence.filter(e => ids.includes(e.id)).map(e => <figure key={e.id} className="ws-section-preview">
      {/* Stored, size-validated PNG evidence; Next image optimization is unnecessary. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a href={e.image} download={`${e.name.replace(/\.png$/i, "").replace(/[^a-z0-9._-]/gi, "_")}.png`}><img src={e.image} alt={e.name} loading="lazy" /></a>
      <figcaption><button type="button" disabled={readOnly} onClick={() => assign(e.id, false)} aria-label={`Detach ${e.name} from ${label}`}>Detach</button></figcaption>
    </figure>)}
  </div>;
}
