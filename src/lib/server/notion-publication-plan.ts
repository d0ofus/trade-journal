import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listWorkstationTrades, readWorkstationDocument, WorkstationError } from "./trade-workstation";
import { readTemplateLayout } from "./notion-template-sync";
import { NOTION_DATA_SOURCE_ID, sectionText, type SectionDefinition, type TemplateLayout } from "@/lib/workstation/template-layout";
import { allSectionKeys, sectionEvidenceIds } from "@/lib/workstation/evidence";
import { richHtml, richPlain } from "@/lib/workstation/rich-text";
import { jsonHash, NotionError, notionRequest, type JsonObject } from "./notion-client";
import { htmlToNotionBlocks } from "./notion-format";
import { planNotionProperties, type RemoteProperty } from "./notion-properties";
import type { TradeDocument } from "@/lib/workstation/types";
import { notionPageUrl, unfinishedPublication, type PublicationContext, type TemplateWait } from "@/lib/workstation/notion-publication-state";
import type { ImageAssetReference } from "@/lib/workstation/image-assets";

export type PublishSection = SectionDefinition & { blocks: JsonObject[]; images: string[] };
export type PublishPlan = { layout: TemplateLayout; schemaHash: string; properties: Record<string, JsonObject>; propertyDisplay: { name: string; value: string }[]; sections: PublishSection[]; omitted: string[]; errors: string[]; titleId: string; sourceUrl: string };
export type PublishSnapshot = { doc: TradeDocument; symbol: string; digest: string; assets: { id: string; hash: string; name?: string; caption: string; image: string; asset?: ImageAssetReference }[] };
// A new explicit preview must not reuse a completed job with the old generated captions.
export const NOTION_PRESENTATION_VERSION = 2;

export async function createNotionPreview(groupKey: string, revision: number, sourceOrigin: string) {
  const existing = await prisma.notionPublication.findUnique({ where: { groupKey } });
  if (existing?.activeJobId) {
    const active = await prisma.notionPublishJob.findUniqueOrThrow({ where: { id: existing.activeJobId } });
    if (unfinishedPublication(active)) return publicationStatus(active);
  }
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
  if (doc.evidence.some(image => assigned.has(image.id) && !image.asset)) throw new WorkstationError("Save this review to finish private image migration before preparing a new Notion publication. Existing publication jobs remain resumable.", 409);
  if (unassigned.length) omitted.push(`${unassigned.length} image(s) outside active template sections remain in Evidence.`);
  const storedAssets = doc.evidence.some(image => image.asset) ? await prisma.evidenceAsset.findMany({ where: { tradeId: groupKey, id: { in: doc.evidence.flatMap(image => image.asset ? [image.asset.id] : []) }, state: "ready" } }) : [];
  const assets = doc.evidence.filter(image => assigned.has(image.id)).map(image => {
    const bytes = Buffer.from(image.image.split(",")[1] ?? "", "base64");
    if (!image.asset && !/^data:image\/png;base64,/.test(image.image)) errors.push(`Evidence “${image.name}” must be normalized to PNG before publishing.`);
    const stored = image.asset ? storedAssets.find(a => a.id === image.asset!.id) : undefined;
    if (image.asset && (!stored || stored.sha256 !== image.asset.sha256)) errors.push(`The original image “${image.name}” is unavailable or does not match its checksum.`);
    const hash = stored?.notionHash ?? jsonHash(bytes.toString("base64"));
    return { id: image.id, hash, name: image.name, image: image.asset ? "" : image.image, asset: image.asset, caption: "" };
  });
  if (assets.length) {
    const bot = await notionRequest<{ bot?: { workspace_limits?: { max_file_upload_size_in_bytes?: number } } }>("/users/me");
    const limit = bot.bot?.workspace_limits?.max_file_upload_size_in_bytes;
    if (!limit || !Number.isFinite(limit)) errors.push("Notion's workspace file allowance could not be verified. Check connection access before publishing images.");
    else for (const image of assets) if ((image.asset?.bytes ?? Buffer.from(image.image.split(",")[1] ?? "", "base64").length) > limit) errors.push(`Evidence ${image.id} exceeds this Notion workspace's ${limit.toLocaleString()}-byte file allowance. The original will not be compressed or omitted.`);
  }
  const origin = new URL(sourceOrigin); if (!/^https?:$/.test(origin.protocol)) throw new NotionError("Invalid application origin.", 400);
  const plan: PublishPlan = { layout, schemaHash: jsonHash(propertyPlan.schemaHashInput), properties: propertyPlan.values, propertyDisplay: propertyPlan.display, sections, omitted, errors,
    titleId: Object.values(schema.properties).find(p => p.type === "title")?.id ?? "", sourceUrl: `${origin.origin}/trades?groupKey=${encodeURIComponent(groupKey)}` };
  const digest = jsonHash(doc), snapshot: PublishSnapshot = { doc: { ...doc, drawings: [], evidence: [], legacy: null }, symbol: trade.symbol, digest, assets };
  // Re-read after upstream I/O; never preview a silently superseded revision.
  if (jsonHash(await readWorkstationDocument(groupKey)) !== digest) throw new WorkstationError("The review changed while preparing the preview. Open it again.");
  const requestKey = jsonHash({ groupKey, digest, layout: layout.id, schema: plan.schemaHash, properties: plan.properties, errors, presentation: NOTION_PRESENTATION_VERSION });
  await prisma.notionPublication.upsert({ where: { groupKey }, create: { groupKey, dataSourceId: NOTION_DATA_SOURCE_ID }, update: {} });
  const job = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "groupKey" FROM "NotionPublication" WHERE "groupKey" = ${groupKey} FOR UPDATE`;
    const current = await tx.notionPublication.findUniqueOrThrow({ where: { groupKey } });
    if (current.activeJobId) {
      const active = await tx.notionPublishJob.findUniqueOrThrow({ where: { id: current.activeJobId } });
      if (unfinishedPublication(active)) return active;
    }
    const prepared = await tx.notionPublishJob.upsert({ where: { requestKey }, create: { groupKey, revision, templateId: layout.id, requestKey,
      snapshot: snapshot as unknown as Prisma.InputJsonValue, plan: plan as unknown as Prisma.InputJsonValue }, update: {} });
    if (storedAssets.length) {
      const { lockClosedTradeForReview } = await import("./closed-trade-review-lock");
      await lockClosedTradeForReview(tx, groupKey);
      for (const asset of assets) if (asset.asset) {
        const ready = await tx.evidenceAsset.findFirst({ where: { id: asset.asset.id, tradeId: groupKey, state: "ready" } });
        if (!ready) throw new WorkstationError("An original image changed availability while preparing. Open a fresh preview.");
        const expiresAt = prepared.state === "preview" ? new Date(Date.now() + 86_400_000) : null;
        await tx.evidenceAssetReference.upsert({ where: { assetId_kind_key: { assetId: ready.id, kind: "publication", key: prepared.id } }, create: { assetId: ready.id, kind: "publication", key: prepared.id, expiresAt }, update: { expiresAt } });
        await tx.evidenceAsset.update({ where: { id: ready.id }, data: { unreferencedAt: null } });
      }
    }
    return prepared;
  });
  return publicationStatus(job, true);
}
export async function publicationContext(groupKey: string): Promise<PublicationContext> {
  const [publication, note] = await Promise.all([
    prisma.notionPublication.findUnique({ where: { groupKey } }),
    prisma.closedTradeNote.findUnique({ where: { groupKey }, select: { workstationVersion: true } }),
  ]);
  return { savedRevision: note?.workstationVersion ?? 0, lastPublishedRevision: publication?.lastRevision ?? null,
    pageUrl: notionPageUrl(publication?.pageId), activeJobId: publication?.activeJobId ?? null };
}
export function publicationStatus(job: { id: string; groupKey: string; revision: number; state: string; error: string | null; retryAt: Date | null; plan: unknown; progress: unknown; snapshot: unknown }, details = false) {
  const plan = job.plan as PublishPlan, progress = job.progress as { pageId?: string; templateWait?: TemplateWait; sections?: Record<string, { done?: boolean }> };
  const snapshot = job.snapshot as PublishSnapshot;
  const includeDetails = details && job.state === "preview";
  return { id: job.id, groupKey: job.groupKey, revision: job.revision, state: job.state, error: job.error, retryAt: job.retryAt,
    pageUrl: notionPageUrl(progress.pageId),
    phase: progress.templateWait?.timedOut ? "template_timeout" : progress.templateWait && ["ready", "running", "waiting"].includes(job.state) ? "template_wait" : job.state,
    missingSections: progress.templateWait?.missing ?? [],
    templateVersion: plan.layout.id, properties: plan.propertyDisplay, omitted: plan.omitted, errors: plan.errors,
    sections: plan.sections.map(section => ({ key: section.key, label: [...section.groups, section.label].join(" · "), images: section.images.length, blocks: section.blocks.length, done: progress.sections?.[section.key]?.done ?? false,
      html: includeDetails ? richHtml(sectionText(snapshot.doc.review, section.key)) : undefined, imageIds: includeDetails ? section.images : undefined })),
    assets: includeDetails ? snapshot.assets.map(asset => ({ id: asset.id, image: asset.image, asset: asset.asset, name: asset.name, caption: asset.caption })) : undefined,
  };
}
