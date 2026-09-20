import { describe, expect, it } from "vitest";
import { fallbackLayout, initialSectionIds, parseTemplateLayout, sectionChoices, sectionText, setSectionText, type TemplateBlock } from "./template-layout";
import { emptyDocument } from "./types";
import { workstationDocumentSchema } from "./schema";
import { assignSectionEvidence, removeEvidence, sameEvidenceAssignments, sectionEvidenceIds } from "./evidence";
import { emptyNotionReview } from "./notion-template";
import { notionBlocks } from "./notion-export";
import { demoTrades } from "./demo";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", dynamic = `notion:${id}` as const;
const block = (id: string, text: string, type = "heading_2", children: TemplateBlock[] = []): TemplateBlock => ({ id, text, type, children });
describe("template-driven review preservation", () => {
  it("maps paragraph labels and duplicate positive headings by source ID", () => {
    const layout = parseTemplateLayout([block(initialSectionIds.technicalPositive, "+ ve", "paragraph"), block(initialSectionIds.noteworthyPositive, "+ ve", "paragraph"), block(initialSectionIds.idealExecution, "Ideal Execution", "paragraph")], "test");
    expect(layout.sections.map(s => s.key)).toEqual(["technicalPositive", "noteworthyPositive", "idealExecution"]);
  });
  it("keeps identity on rename, reorder and grouping changes", () => {
    const first = parseTemplateLayout([block(initialSectionIds.entry, "Entry"), block(id, "New notes", "toggle")], "v1");
    const next = parseTemplateLayout([block(id, "Renamed"), block(initialSectionIds.entry, "My entry")], "v2", first);
    expect(next.sections.map(s => [s.key, s.label])).toEqual([[dynamic, "Renamed"], ["entry", "My entry"]]);
  });
  it("archives deletion and does not remap a recreated identical title", () => {
    const first = parseTemplateLayout([block(initialSectionIds.entry, "Entry Screen")], "v1");
    const next = parseTemplateLayout([block(id, "Entry Screen")], "v2", first);
    expect(next.sections[0].key).toBe(dynamic); expect(next.archived.some(s => s.key === "entry")).toBe(true);
  });
  it("retains all known archived IDs through a template reversion", () => {
    const added = parseTemplateLayout([block(initialSectionIds.entry, "Entry"), block(id, "New")], "v2");
    const reverted = parseTemplateLayout([block(initialSectionIds.entry, "Entry")], "v1", added);
    expect(reverted.archived.some(s => s.key === dynamic)).toBe(true);
  });
  it("rejects an empty layout without discarding a previous definition", () => {
    expect(() => parseTemplateLayout([], "empty", fallbackLayout)).toThrow(/last valid/);
    expect(fallbackLayout.sections).toHaveLength(13);
  });
  it("keeps new sections, legacy notes and assignments through schema-one save/reload", () => {
    const doc = emptyDocument(); doc.review.notes = "LPTH saved note"; doc.review.mistake = "SHLS/TATT saved improvement";
    doc.review = setSectionText(doc.review, dynamic, "<p>New section</p>");
    doc.review.notion = assignSectionEvidence(doc.review.notion!, dynamic, "image", true);
    doc.review.notion.layout = parseTemplateLayout([block(id, "New section")], "v1");
    const restored = workstationDocumentSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(restored.review.notes).toBe(doc.review.notes); expect(restored.review.mistake).toBe(doc.review.mistake);
    expect(sectionText(restored.review, dynamic)).toBe("<p>New section</p>"); expect(sectionEvidenceIds(restored.review.notion, dynamic)).toEqual(["image"]);
    expect(restored.schema).toBe(1);
  });
  it("preserves legacy analysis and chart assignments without moving stored content", () => {
    const doc = emptyDocument(); doc.review.notion = emptyNotionReview();
    for (const key of ["entry", "idealExecution", "fundamentals"] as const) doc.review.notion = assignSectionEvidence(doc.review.notion, key, "shared", true);
    const before = structuredClone(doc.review.notion); doc.review.notion.layout = fallbackLayout;
    expect(sameEvidenceAssignments(before, doc.review.notion)).toBe(true);
    for (const key of ["entry", "idealExecution", "fundamentals"] as const) expect(sectionEvidenceIds(doc.review.notion, key)).toEqual(["shared"]);
  });
  it("detects dynamic assignment changes and removes every reference on deletion", () => {
    const doc = emptyDocument(); const before = emptyNotionReview();
    doc.review.notion = assignSectionEvidence(before, dynamic, "shared", true);
    expect(sameEvidenceAssignments(before, doc.review.notion)).toBe(false);
    expect(sectionEvidenceIds(removeEvidence(doc, "shared").review.notion, dynamic)).toEqual([]);
  });
  it("keeps Takeaways as a shared field and offers archived destinations in Evidence", () => {
    const review = setSectionText(emptyDocument().review, "takeaways", "Shared lesson");
    expect(review.takeaway).toBe("Shared lesson");
    const layout = parseTemplateLayout([block(id, "New")], "v2");
    expect(sectionChoices(layout).find(([key]) => key === "entry")?.[1]).toContain("archived");
  });
  it("exports renamed and archived sections without silently dropping text", () => {
    const doc = emptyDocument(); doc.review = setSectionText(doc.review, "entry", "Original entry");
    doc.review = setSectionText(doc.review, dynamic, "New section note");
    doc.review.notion!.layout = parseTemplateLayout([block(id, "My new section")], "v2");
    const blocks = notionBlocks(demoTrades[0], doc);
    expect(blocks.find(b => b.key === "entry")?.title).toContain("archived");
    expect(blocks.find(b => b.key === dynamic)?.html).toContain("New section note");
  });
});
