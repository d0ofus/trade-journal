import { chartSections, emptyNotionReview, reviewSections, type AdditionalReviewSectionKey, type ChartSectionKey, type NotionReview, type ReviewSectionKey } from "./notion-template";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "./payload";
import type { Evidence, TradeDocument } from "./types";
import { assertEvidenceCapacity } from "./image-assets";
import { preserveLayoutArchive, type TemplateLayout } from "./template-layout-schema";

export function evidenceSource(e: Evidence) { return e.origin === "upload" ? "Uploaded image" : e.origin === "clipboard" ? "Clipboard screenshot" : e.peerCapture ? "Peer comparison" : "Workspace chart"; }
export function evidenceCaption(e: Evidence) { return e.name + (e.replayAt === undefined ? "" : ` · Replay cutoff ${new Date(e.replayAt * 1000).toISOString()}`); }
export function earlierTimestampBasis(e: Evidence, version: string) { return !e.origin && e.timeInterpretationVersion !== version; }

function isChartSection(key: ReviewSectionKey): key is ChartSectionKey {
  return chartSections.some(([value]) => value === key);
}
export function sectionEvidenceIds(notion: NotionReview | undefined, key: ReviewSectionKey): string[] {
  if (key.startsWith("notion:")) return notion?.dynamicSections?.[key]?.evidenceIds ?? [];
  return (isChartSection(key) ? notion?.sections[key]?.evidenceIds : notion?.sectionEvidence?.[key as AdditionalReviewSectionKey]) ?? [];
}
export function allSectionKeys(notion?: NotionReview): ReviewSectionKey[] { return [...reviewSections.map(([key]) => key), ...Object.keys(notion?.dynamicSections ?? {}) as `notion:${string}`[]]; }
/** Assignment changes are structural; prose changes should not rerender charts. */
export function sameEvidenceAssignments(a: NotionReview | undefined, b: NotionReview | undefined) {
  return [...new Set([...allSectionKeys(a), ...allSectionKeys(b)])].every(key => {
    const left = sectionEvidenceIds(a, key), right = sectionEvidenceIds(b, key);
    return left.length === right.length && left.every((id, index) => id === right[index]);
  });
}
export function assignSectionEvidence(notion: NotionReview, key: ReviewSectionKey, id: string, assigned: boolean): NotionReview {
  const ids = sectionEvidenceIds(notion, key).filter(value => value !== id);
  if (assigned) ids.push(id);
  if (ids.length > 30) throw new Error("This section already has 30 images. Remove or reassign an image first.");
  if (key.startsWith("notion:")) return { ...notion, dynamicSections: { ...notion.dynamicSections, [key]: { ...notion.dynamicSections?.[key] ?? { html: "" }, evidenceIds: ids } } };
  return isChartSection(key)
    ? { ...notion, sections: { ...notion.sections, [key]: { ...notion.sections[key] ?? { html: "" }, evidenceIds: ids } } }
    : { ...notion, sectionEvidence: { ...notion.sectionEvidence, [key]: ids } };
}
export function attachEvidence(doc: TradeDocument, evidence: Evidence, destination: ReviewSectionKey, layout?: TemplateLayout): TradeDocument {
  if (doc.evidence.length >= 30) throw new Error("This review already has 30 images. Reuse an existing image or remove one first.");
  const next = { ...doc, evidence: [...doc.evidence, evidence], review: { ...doc.review,
    notion: { ...assignSectionEvidence(doc.review.notion ?? emptyNotionReview(), destination, evidence.id, true), ...layout ? { layout: preserveLayoutArchive(layout, doc.review.notion?.layout) } : {} },
  } };
  assertEvidenceCapacity(next.evidence);
  if (jsonBytes({ document: { ...next, legacy: undefined }, expectedRevision: doc.revision }) > REVIEW_PACKAGE_MAX_BYTES) throw new Error(REVIEW_PACKAGE_TOO_LARGE);
  return next;
}
export function assignedEvidenceIds(notion?: NotionReview) {
  return new Set(allSectionKeys(notion).flatMap(key => sectionEvidenceIds(notion, key)));
}

export function removeEvidence(doc: TradeDocument, id: string): TradeDocument {
  const notion = doc.review.notion;
  return { ...doc, evidence: doc.evidence.filter(e => e.id !== id), review: { ...doc.review,
    ...(notion ? { notion: { ...notion, sections: Object.fromEntries(Object.entries(notion.sections).map(([key, section]) =>
      [key, { ...section, evidenceIds: section!.evidenceIds.filter(value => value !== id) }])),
      ...(notion.sectionEvidence ? { sectionEvidence: Object.fromEntries(Object.entries(notion.sectionEvidence).map(([key, ids]) => [key, ids.filter(value => value !== id)])) } : {}),
      ...(notion.dynamicSections ? { dynamicSections: Object.fromEntries(Object.entries(notion.dynamicSections).map(([key, section]) => [key, { ...section, evidenceIds: section.evidenceIds.filter(value => value !== id) }])) } : {}),
    } } : {}),
  } };
}
