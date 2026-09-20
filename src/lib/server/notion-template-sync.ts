import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fallbackLayout, NOTION_DATA_SOURCE_ID, NOTION_TEMPLATE_ID, parseTemplateLayout, templateLayoutSchema, type TemplateLayout } from "@/lib/workstation/template-layout";
import { jsonHash, notionConfigured, notionTree, NotionError, withNotionBudget } from "./notion-client";

let refreshing: Promise<{ layout: TemplateLayout; warning?: string }> | undefined;
export async function readTemplateLayout(refresh = false): Promise<{ layout: TemplateLayout; warning?: string }> {
  const previous = await prisma.notionTemplateDefinition.findFirst({ where: { templateId: NOTION_TEMPLATE_ID }, orderBy: { checkedAt: "desc" } });
  const saved = previous ? templateLayoutSchema.parse(previous.layout) : undefined;
  if (!notionConfigured()) return { layout: saved ?? fallbackLayout, warning: "Notion is not configured. Using the last available journal layout." };
  if (!refresh && previous && Date.now() - previous.checkedAt.getTime() < 60_000) return { layout: saved! };
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const source = await withNotionBudget(() => notionTree(NOTION_TEMPLATE_ID));
      const id = jsonHash({ templateId: NOTION_TEMPLATE_ID, source });
      const layout = parseTemplateLayout(source, id, saved);
      await prisma.notionTemplateDefinition.upsert({ where: { id },
        create: { id, templateId: NOTION_TEMPLATE_ID, dataSourceId: NOTION_DATA_SOURCE_ID, source: source as unknown as Prisma.InputJsonValue, layout: layout as unknown as Prisma.InputJsonValue },
        update: { checkedAt: new Date(), layout: layout as unknown as Prisma.InputJsonValue },
      });
      return { layout };
    } catch (error) {
      return { layout: saved ?? fallbackLayout, warning: error instanceof NotionError || error instanceof Error ? error.message : "Notion section refresh failed. Using the last valid layout." };
    }
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
