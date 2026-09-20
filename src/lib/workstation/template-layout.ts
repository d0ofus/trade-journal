import type { Review } from "./types";
import { analysisSections, chartSections, emptyNotionReview, type ReviewSectionKey } from "./notion-template";
import { templateLayoutSchema, type SectionDefinition, type TemplateLayout } from "./template-layout-schema";
export { templateLayoutSchema, type SectionDefinition, type TemplateLayout } from "./template-layout-schema";

export const NOTION_DATA_SOURCE_ID = "1fd6f185-199d-8111-8f46-000b0bf768d4";
export const NOTION_TEMPLATE_ID = "1fd6f185-199d-81c0-b0cb-cfef4190fc8d";
export type TemplateBlock = { id: string; type: string; text: string; children: TemplateBlock[] };

// These labels are paragraphs in the real template, not headings. Never infer
// their semantic role from a duplicate title such as "+ ve".
export const initialSectionIds: Record<string, string> = {
  entry: "1fd6f185-199d-8162-979a-dfb0e10ffc0d", postBreak: "2526f185-199d-8020-b2c7-ec9c5d03653b",
  exit: "1fd6f185-199d-813f-8d5e-fec6c37a3e9d", peers: "36b6f185-199d-80df-a63f-fb252f52ff32",
  index: "36b6f185-199d-8032-a3b1-cb61f29f0598", other: "3666f185-199d-805f-aede-c722afaee01c",
  technicalPositive: "26a6f185-199d-80a3-8436-efcc3d3ff1d5", technicalNegative: "26a6f185-199d-80d9-b2dd-ce53311e1606",
  idealExecution: "3666f185-199d-805f-9223-c187705adf26", fundamentals: "2136f185-199d-80a7-8ba7-c6f03ac6297d",
  noteworthyPositive: "26a6f185-199d-800b-94a2-c1aa08380c41", noteworthyNegative: "26a6f185-199d-80ae-93d0-fe2ecc7f8e64",
  takeaways: "3896f185-199d-809f-8ef0-f55716a3b380",
};
const initialGroupIds = new Set(["1fd6f185-199d-818d-9b1b-f13e4bf7af44", "1ff6f185-199d-8077-ab3e-d547970d9f16", "2136f185-199d-8064-ae82-f0a0c748fd46"]);
export const fallbackLayout: TemplateLayout = {
  version: 1, id: "builtin", templateId: NOTION_TEMPLATE_ID, archived: [],
  sections: [...chartSections, ...analysisSections, ["takeaways", "Takeaways"] as const].map(([key, label], index) => ({
    key, label, sourceId: initialSectionIds[key], path: [index], groups: index >= 6 && index < 12 ? ["Setup Analysis"] : [], type: "heading_2",
  })),
};

export function parseTemplateLayout(blocks: TemplateBlock[], id: string, previous?: TemplateLayout): TemplateLayout {
  const known = new Map<string, SectionDefinition["key"]>(Object.entries(initialSectionIds).map(([key, value]) => [value, key as SectionDefinition["key"]]));
  for (const section of [...previous?.sections ?? [], ...previous?.archived ?? []]) known.set(section.sourceId, section.key);
  const sections: SectionDefinition[] = [];
  function walk(nodes: TemplateBlock[], path: number[], inherited: string[]) {
    let groups = [...inherited];
    nodes.forEach((node, index) => {
      const nextPath = [...path, index];
      if (initialGroupIds.has(node.id)) {
        // Technicals/Noteworthy label the remainder of their own column.
        groups = [...inherited, node.text || "Untitled group"];
      } else if (known.has(node.id) || /^(heading_[123]|toggle)$/.test(node.type)) {
        if (!node.text.trim()) throw new Error("A Notion section has no title. Name it before refreshing sections.");
        sections.push({ key: known.get(node.id) ?? `notion:${node.id}`, sourceId: node.id, path: nextPath, label: node.text.trim(), groups, type: node.type });
      }
      if (node.children.length) walk(node.children, nextPath, /^(heading_[123]|toggle)$/.test(node.type) && !initialGroupIds.has(node.id) ? [...groups, node.text] : groups);
    });
  }
  walk(blocks, [], []);
  if (!sections.length) throw new Error("The Notion template has no supported sections. The last valid layout is retained.");
  const active = new Set(sections.map(section => section.key));
  const prior = [...previous?.sections ?? fallbackLayout.sections, ...previous?.archived ?? []];
  const archived = [...new Map(prior.filter(section => !active.has(section.key)).map(section => [section.key, section])).values()];
  return templateLayoutSchema.parse({ version: 1, id, templateId: NOTION_TEMPLATE_ID, sections, archived });
}

export function sectionText(review: Review, key: ReviewSectionKey): string {
  if (key === "takeaways") return review.takeaway;
  if (key.startsWith("notion:")) return review.notion?.dynamicSections?.[key]?.html ?? "";
  const chart = chartSections.find(([value]) => value === key);
  if (chart) return review.notion?.sections[chart[0]]?.html ?? "";
  const analysis = analysisSections.find(([value]) => value === key);
  return analysis ? review.notion?.analysis[analysis[0]] ?? "" : "";
}
export function setSectionText(review: Review, key: ReviewSectionKey, html: string): Review {
  if (key === "takeaways") return { ...review, takeaway: html };
  const notion = review.notion ?? emptyNotionReview();
  if (key.startsWith("notion:")) return { ...review, notion: { ...notion, dynamicSections: { ...notion.dynamicSections, [key]: { ...notion.dynamicSections?.[key] ?? { evidenceIds: [] }, html } } } };
  const chart = chartSections.find(([value]) => value === key);
  return { ...review, notion: chart
    ? { ...notion, sections: { ...notion.sections, [key]: { ...notion.sections[chart[0]] ?? { evidenceIds: [] }, html } } }
    : { ...notion, analysis: { ...notion.analysis, [key]: html } } };
}
export function sectionChoices(layout?: TemplateLayout, saved?: TemplateLayout): [ReviewSectionKey, string][] {
  const current = layout ?? saved ?? fallbackLayout;
  const labels = new Map<string, string>([["properties", "Trade properties"]]);
  current.sections.forEach(s => labels.set(s.key, current.sections.filter(other => other.label === s.label).length > 1 ? [...s.groups, s.label].join(" · ") : s.label));
  [...current.archived, ...saved?.sections ?? [], ...saved?.archived ?? []].forEach(s => { if (!labels.has(s.key)) labels.set(s.key, `${s.label} (archived)`); });
  labels.set("previousReview", "Review details");
  return [...labels] as [ReviewSectionKey, string][];
}
