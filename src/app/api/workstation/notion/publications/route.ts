import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { notionRouteAuth, notionRouteError } from "@/lib/server/notion-route";
import { createNotionPreview, publicationStatus } from "@/lib/server/notion-publication-plan";
import { resumeNotionPublication, startNotionPublication } from "@/lib/server/notion-publisher";
import { withNotionBudget } from "@/lib/server/notion-client";
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  const auth = await notionRouteAuth(request); if (auth) return auth;
  const groupKey = request.nextUrl.searchParams.get("groupKey");
  if (!groupKey || groupKey.length > 1000) return NextResponse.json({ error: "A trade is required." }, { status: 400 });
  try {
    const publication = await prisma.notionPublication.findUnique({ where: { groupKey } });
    const job = publication?.activeJobId ? await prisma.notionPublishJob.findUnique({ where: { id: publication.activeJobId } }) : await prisma.notionPublishJob.findFirst({ where: { groupKey }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ job: job ? publicationStatus(job, job.state === "preview") : null, enabled: process.env.NOTION_PUBLISH_ENABLED === "1" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return notionRouteError(error); }
}
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), groupKey: z.string().min(1).max(1000), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.enum(["publish", "resume"]), groupKey: z.string().min(1).max(1000), id: z.string().min(1).max(100) }).strict(),
]);
export async function POST(request: NextRequest) {
  const auth = await notionRouteAuth(request, true); if (auth) return auth;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > 4096) return NextResponse.json({ error: "Publication requests must contain identifiers only." }, { status: 413 });
    let raw: unknown; try { raw = JSON.parse(body); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
    const result = command.safeParse(raw);
    if (!result.success) return NextResponse.json({ error: "Invalid publication command." }, { status: 400 });
    const input = result.data;
    const job = await withNotionBudget(() => input.action === "preview" ? createNotionPreview(input.groupKey, input.revision, request.nextUrl.origin)
      : input.action === "publish" ? startNotionPublication(input.id, input.groupKey) : resumeNotionPublication(input.id, input.groupKey));
    return NextResponse.json({ job, enabled: process.env.NOTION_PUBLISH_ENABLED === "1" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return notionRouteError(error); }
}
