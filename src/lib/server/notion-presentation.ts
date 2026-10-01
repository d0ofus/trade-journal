import type { NotionPublication, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NOTION_PRESENTATION_VERSION, unfinishedPublication } from "@/lib/workstation/notion-publication-state";
import { NotionError } from "./notion-client";

type Reader = Pick<Prisma.TransactionClient, "notionPublishJob">;
export function planPresentation(plan: unknown): number {
  const version = (plan as { presentationVersion?: number } | null)?.presentationVersion ?? 1;
  if (![1, 2, 3, 4].includes(version)) throw new NotionError("This publication format is unsupported. Refresh the application before publishing.", 409);
  return version;
}

/** A page keeps its format. Reading this policy never changes pages or records. */
export async function effectivePresentation(publication: NotionPublication | null, db: Reader = prisma): Promise<number> {
  if (publication?.activeJobId) {
    const active = await db.notionPublishJob.findUnique({ where: { id: publication.activeJobId } });
    if (active && unfinishedPublication(active)) return planPresentation(active.plan);
  }
  if (!publication?.pageId) return NOTION_PRESENTATION_VERSION;
  const pinned = (publication.bindings as { presentationVersion?: number }).presentationVersion;
  if (pinned !== undefined) return planPresentation({ presentationVersion: pinned });
  const completed = await db.notionPublishJob.findFirst({ where: { groupKey: publication.groupKey, state: "succeeded", progress: { path: ["pageId"], equals: publication.pageId } }, orderBy: { createdAt: "desc" } });
  return completed ? planPresentation(completed.plan) : 3;
}
