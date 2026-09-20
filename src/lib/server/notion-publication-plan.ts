import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listWorkstationTrades, readWorkstationDocument, WorkstationError } from "./trade-workstation";
import { readTemplateLayout } from "./notion-template-sync";
import { NOTION_DATA_SOURCE_ID, sectionText, type SectionDefinition, type TemplateLayout } from "@/lib/workstation/template-layout";
import { allSectionKeys, evidenceCaption, sectionEvidenceIds } from "@/lib/workstation/evidence";
import { richHtml, richPlain } from "@/lib/workstation/rich-text";
import { jsonHash, NotionError, notionRequest, type JsonObject } from "./notion-client";
import { htmlToNotionBlocks } from "./notion-format";
import { planNotionProperties, type RemoteProperty } from "./notion-properties";
import type { TradeDocument } from "@/lib/workstation/types";

export type PublishSection = SectionDefinition & { blocks: JsonObject[]; images: string[] };
export type PublishPlan = { layout: TemplateLayout; schemaHash: string; properties: Record<string, JsonObject>; propertyDisplay: { name: string; value: string }[]; sections: PublishSection[]; omitted: string[]; errors: string[]; titleId: string; sourceUrl: string };
export type PublishSnapshot = { doc: TradeDocument; symbol: string; digest: string; assets: { id: string; hash: string; caption: string; image: string }[] };

export async function createNotionPreview(groupKey: string, revision: number, sourceOrigin: string) {
  const doc = await readWorkstationDocument(groupKey);
  const trade = (await listWorkstationTrades({}, groupKey, true, true))[0];
  if (!trade || trade.stale) throw new WorkstationError("This trade is unavailable or stale and cannot be published.", 409);
  if (doc.revision !== revision) throw new WorkstationError("The saved review changed. Save and open a fresh preview.");
  const { layout, warning } = await readTemplateLayout(true);
  const schema = await notionRequest<{ properties: Record<string, RemoteProperty> }>(`/data_sources/${NOTION_DATA_SOURCE_ID}`);
  const propertyPlan = await planNotionProperties(trade, doc, schema.properties);
  const errors = [...propertyPlan.errors, ...warning ? [warning] : []];
  if (layout.id === "builtin") errors.push("Fetch and verify the live template before publishing.");
  const active = new Set(layout.sections.map(section => section.key));
  const omitted = [
    ...(["setup", "execution", "thesis", "exit", "mistake", "followUp", "notes"] as const).filter(key => richPlain(doc.review[key])).map(key => `Review details: ${key}`),
    ...Object.entries(doc.review.custom).filter(([, value]) => richPlain(value)).map(([key]) => `Custom field: ${key}`),
    ...allSectionKeys(doc.review.notion).filter(key => !active.has(key as SectionDefinition["key"]) && (sectionText(doc.review, key) || sectionEvidenceIds(doc.review.notion, key).length)).map(key => `Unmapped or archived section: ${key}`),
  ];
  const sections = layout.sections.map(section => {
    let blocks: JsonObject[] = [];
    try { blocks = htmlToNotionBlocks(sectionText(doc.review, section.key)); } catch (e) { errors.push(`${section.label}: ${e instanceof Error ? e.message : "Unsupported formatting"}`); }
    const images = sectionEvidenceIds(doc.review.notion, section.key);
    return { ...section, blocks, images };
  });
  const assigned = new Set(sections.flatMap(section => section.images));
  for (const id of assigned) if (!doc.evidence.some(image => image.id === id)) errors.push(`Missing evidence asset ${id}. Recover it before publishing.`);
  const unassigned = doc.evidence.filter(image => !assigned.has(image.id));
  if (unassigned.length) omitted.push(`${unassigned.length} image(s) outside active template sections remain in Evidence.`);
  const assets = doc.evidence.filter(image => assigned.has(image.id)).map(image => {
    const bytes = Buffer.from(image.image.split(",")[1] ?? "", "base64");
    if (!/^data:image\/png;base64,/.test(image.image)) errors.push(`Evidence “${image.name}” must be normalized to PNG before publishing.`);
    const hash = jsonHash(bytes.toString("base64"));
    const context = image.origin ? `Imported ${image.origin}` : [image.timeframe, image.peerCapture ? JSON.stringify(image.peerCapture) : "Workspace", new Date(image.time * 1000).toISOString()].join(" · ");
    return { id: image.id, hash, image: image.image, caption: `${evidenceCaption(image)} · ${context} · image ${hash.slice(0, 12)}` };
  });
  const origin = new URL(sourceOrigin); if (!/^https?:$/.test(origin.protocol)) throw new NotionError("Invalid application origin.", 400);
  const plan: PublishPlan = { layout, schemaHash: jsonHash(propertyPlan.schemaHashInput), properties: propertyPlan.values, propertyDisplay: propertyPlan.display, sections, omitted, errors,
    titleId: Object.values(schema.properties).find(p => p.type === "title")?.id ?? "", sourceUrl: `${origin.origin}/trades?groupKey=${encodeURIComponent(groupKey)}` };
  const digest = jsonHash(doc), snapshot: PublishSnapshot = { doc: { ...doc, drawings: [], evidence: [], legacy: null }, symbol: trade.symbol, digest, assets };
  // Re-read after upstream I/O; never preview a silently superseded revision.
  if (jsonHash(await readWorkstationDocument(groupKey)) !== digest) throw new WorkstationError("The review changed while preparing the preview. Open it again.");
  const requestKey = jsonHash({ groupKey, digest, layout: layout.id, schema: plan.schemaHash, properties: plan.properties, errors });
  await prisma.notionPublication.upsert({ where: { groupKey }, create: { groupKey, dataSourceId: NOTION_DATA_SOURCE_ID }, update: {} });
  const job = await prisma.notionPublishJob.upsert({ where: { requestKey }, create: { groupKey, revision, templateId: layout.id, requestKey,
    snapshot: snapshot as unknown as Prisma.InputJsonValue, plan: plan as unknown as Prisma.InputJsonValue }, update: {} });
  return publicationStatus(job, true);
}
export function publicationStatus(job: { id: string; groupKey: string; revision: number; state: string; error: string | null; retryAt: Date | null; plan: unknown; progress: unknown; snapshot: unknown }, details = false) {
  const plan = job.plan as PublishPlan, progress = job.progress as { pageId?: string; sections?: Record<string, { done?: boolean }> };
  const snapshot = job.snapshot as PublishSnapshot;
  const includeDetails = details && job.state === "preview";
  return { id: job.id, groupKey: job.groupKey, revision: job.revision, state: job.state, error: job.error, retryAt: job.retryAt,
    pageUrl: progress.pageId && /^[0-9a-f-]{36}$/.test(progress.pageId) ? new URL(`/${progress.pageId.replace(/-/g, "")}`, "https://www.notion.so").href : null,
    templateVersion: plan.layout.id, properties: plan.propertyDisplay, omitted: plan.omitted, errors: plan.errors,
    sections: plan.sections.map(section => ({ key: section.key, label: [...section.groups, section.label].join(" · "), images: section.images.length, blocks: section.blocks.length, done: progress.sections?.[section.key]?.done ?? false,
      html: includeDetails ? richHtml(sectionText(snapshot.doc.review, section.key)) : undefined, imageIds: includeDetails ? section.images : undefined })),
    assets: includeDetails ? snapshot.assets.map(asset => ({ id: asset.id, image: asset.image, caption: asset.caption })) : undefined,
  };
}
