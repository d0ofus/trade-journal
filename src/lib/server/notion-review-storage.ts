import { Prisma } from "@prisma/client";
import { emptyNotionReview, notionReviewSchema, stopLossPercent, type NotionReview, type PropertyKey } from "@/lib/workstation/notion-template";
import { normalizeJournalNotionRelationSlug } from "@/lib/journal/schema";

const columns = ["exitMarked", "xFrom50Sma", "indexSupportive", "highAvat", "idealExecutionOptions", "idealStopLossOptions", "plannedEntry", "plannedStop"] as const;
const relations = { typeOfReview: "TYPE_OF_REVIEW", typeOfTrade: "TYPE_OF_TRADE", chartPattern: "CHART_PATTERN", confluences: "CONFLUENCE", characteristics: "CHARACTERISTIC", newsImpact: "NEWS_IMPACT" } as const;

export function readNotionReview(entry: Record<string, unknown> | null | undefined): NotionReview {
  const parsed = notionReviewSchema.safeParse(entry?.templateData);
  if (entry?.templateData != null && !parsed.success) throw new Error("This journal template version cannot be read. Preserve the saved review and update the application before editing.");
  const review = parsed.success ? parsed.data : emptyNotionReview();
  if (!entry) return review;
  for (const key of columns) if (entry[key] !== undefined) review.properties[key] = entry[key] as NotionReview["properties"][PropertyKey];
  const tags = entry.notionRelations as { relationTag: { kind: string; name: string } }[] | undefined;
  for (const [key, kind] of Object.entries(relations)) review.properties[key as PropertyKey] = tags?.filter(t => t.relationTag.kind === kind).map(t => t.relationTag.name) ?? [];
  return review;
}

export function notionJournalPatch(review: NotionReview): Prisma.JournalEntryUpdateManyMutationInput {
  const properties = { ...review.properties };
  const data: Record<string, unknown> = {};
  for (const key of columns) { if (properties[key] !== undefined) data[key] = properties[key]; delete properties[key]; }
  for (const key of Object.keys(relations)) delete properties[key as PropertyKey];
  return { ...data, stopLossPercent: stopLossPercent(review), templateData: { ...review, properties } as Prisma.InputJsonValue };
}

export async function saveNotionRelations(tx: Prisma.TransactionClient, journalEntryId: string, review: NotionReview) {
  for (const [key, kind] of Object.entries(relations)) {
    const values = review.properties[key as PropertyKey];
    if (!Array.isArray(values)) continue;
    await tx.journalEntryNotionRelation.deleteMany({ where: { journalEntryId, relationTag: { kind } } });
    const seen = new Set<string>();
    for (const name of values) {
      const normalizedName = normalizeJournalNotionRelationSlug(name);
      if (!normalizedName || seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      const tag = await tx.journalNotionRelationTag.upsert({ where: { kind_normalizedName: { kind, normalizedName } }, create: { kind, name, normalizedName }, update: {} });
      await tx.journalEntryNotionRelation.create({ data: { journalEntryId, relationTagId: tag.id } });
    }
  }
}
