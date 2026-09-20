import { z } from "zod";
export const dynamicSectionKeySchema = z.string().regex(/^notion:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).transform(value => value as `notion:${string}`);
export const stableSectionKeySchema = z.union([dynamicSectionKeySchema, z.enum(["entry", "postBreak", "exit", "peers", "index", "other", "technicalPositive", "technicalNegative", "idealExecution", "fundamentals", "noteworthyPositive", "noteworthyNegative", "takeaways"])]);
export const sectionDefinitionSchema = z.object({
  key: stableSectionKeySchema, label: z.string().min(1).max(200), sourceId: z.string().uuid(),
  path: z.array(z.number().int().nonnegative()).min(1).max(16), groups: z.array(z.string().max(200)).max(16), type: z.string().max(50),
}).strict();
export const templateLayoutSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(100), templateId: z.string().uuid(),
  sections: z.array(sectionDefinitionSchema).max(200), archived: z.array(sectionDefinitionSchema).max(1000),
}).strict().refine(value => new Set([...value.sections, ...value.archived].map(s => s.key)).size === value.sections.length + value.archived.length, "Duplicate section identity");
export type SectionDefinition = z.infer<typeof sectionDefinitionSchema>;
export type TemplateLayout = z.infer<typeof templateLayoutSchema>;
/** A recovered review can know older sections absent from the current cache. */
export function preserveLayoutArchive(current: TemplateLayout, previous?: TemplateLayout): TemplateLayout {
  const active = new Set(current.sections.map(section => section.key));
  const archived = [...new Map([...current.archived, ...previous?.sections ?? [], ...previous?.archived ?? []]
    .filter(section => !active.has(section.key)).map(section => [section.key, section])).values()];
  return { ...current, archived };
}
