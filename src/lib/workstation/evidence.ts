import { emptyNotionReview, type ChartSectionKey } from "./notion-template";
import type { Evidence, TradeDocument } from "./types";

export function attachEvidence(doc: TradeDocument, evidence: Evidence, destination: ChartSectionKey): TradeDocument {
  const notion = doc.review.notion ?? emptyNotionReview();
  const section = notion.sections[destination] ?? { html: "", evidenceIds: [] };
  if (section.evidenceIds.length >= 30) throw new Error("This section already has 30 charts. Remove or reassign a chart first.");
  return { ...doc, evidence: [...doc.evidence, evidence], review: { ...doc.review, notion: {
    ...notion, sections: { ...notion.sections, [destination]: { ...section, evidenceIds: [...section.evidenceIds, evidence.id] } },
  } } };
}

export function removeEvidence(doc: TradeDocument, id: string): TradeDocument {
  const notion = doc.review.notion;
  return { ...doc, evidence: doc.evidence.filter(e => e.id !== id), review: { ...doc.review,
    ...(notion ? { notion: { ...notion, sections: Object.fromEntries(Object.entries(notion.sections).map(([key, section]) =>
      [key, { ...section, evidenceIds: section!.evidenceIds.filter(value => value !== id) }])) } } : {}),
  } };
}
