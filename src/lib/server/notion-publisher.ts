import { randomUUID } from "node:crypto";
import { Prisma, type NotionPublishJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NOTION_DATA_SOURCE_ID, NOTION_TEMPLATE_ID, type TemplateBlock } from "@/lib/workstation/template-layout";
import { jsonHash, managedPlaceholder, NotionError, notionChildren, notionRequest, notionTree, requireNotionPublishing, type JsonObject, type RemoteBlock } from "./notion-publisher-support";
import { managedBlockValue, notionRichText } from "./notion-format";
import { readWorkstationDocument, WorkstationError } from "./trade-workstation";
import { readTemplateLayout } from "./notion-template-sync";
import { publicationStatus, type PublishPlan, type PublishSnapshot } from "./notion-publication-plan";
import { withNotionBudget } from "./notion-client";
import { propertySchemaSignature, type RemoteProperty } from "./notion-properties";

type Anchor = { id: string; parent: string; sourceId: string; type: string };
type SectionBinding = { anchor: Anchor; container: string; fingerprint: string };
type Bindings = { sections?: Record<string, SectionBinding>; propertyFingerprint?: string; propertyIds?: string[] };
type Progress = { pageId?: string; botId?: string; createIntent?: boolean; createTitle?: string; anchors?: Record<string, Anchor>;
  checked?: boolean; propertiesDone?: boolean; propertyIntent?: boolean; propertyBase?: string; newPropertyFingerprint?: string;
  pendingAppend?: { parent: string; count: number }; sections?: Record<string, { container?: string; createIntent?: boolean; done?: boolean; fingerprint?: string }>; };
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
function dateInstant(raw: unknown, zone: unknown) {
  if (typeof raw !== "string") return null;
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) return new Date(raw).toISOString();
  if (!raw.includes("T")) return raw;
  const wall = Date.parse(`${raw}Z`); let time = wall;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: typeof zone === "string" ? zone : "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
    const rendered = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    time += wall - rendered;
  }
  return new Date(time).toISOString();
}
export function propertyValue(property: JsonObject): unknown {
  const type = String(property.type ?? Object.keys(property)[0]), value = property[type];
  if (type === "title" || type === "rich_text") return { type, text: (value as JsonObject[] ?? []).map(part => ({ content: (part.text as JsonObject)?.content ?? part.plain_text, annotations: Object.fromEntries(Object.entries(part.annotations as JsonObject ?? {}).filter(([, v]) => v !== false && v !== "default")) })) };
  if (type === "relation") return { type, ids: (value as { id: string }[]).map(p => p.id).sort() };
  if (type === "select") return { type, value: (value as { name?: string } | null)?.name ?? null };
  if (type === "multi_select") return { type, values: (value as { name: string }[]).map(v => v.name).sort() };
  if (type === "date") { const date = value as JsonObject | null; return { type, value: date ? { start: dateInstant(date.start, date.time_zone), end: dateInstant(date.end, date.time_zone) } : null }; }
  return { type, value };
}
async function pageProperties(pageId: string, ids: string[]) {
  const page = await notionRequest<{ properties: Record<string, JsonObject> }>(`/pages/${pageId}`);
  const byId = new Map(Object.values(page.properties).map(value => [String(value.id), value]));
  for (const id of ids) {
    const property = byId.get(id);
    if (!property) throw new NotionError("An app-managed Notion property was deleted. Review the database schema.", 409);
    if (property.type === "relation" && property.has_more) {
      const relation: { id: string }[] = []; let cursor: string | null = null;
      do {
        const result: { results: { relation: { id: string } }[]; has_more: boolean; next_cursor: string | null } = await notionRequest(`/pages/${pageId}/properties/${encodeURIComponent(id)}?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
        relation.push(...result.results.map(row => row.relation));
        if (relation.length > 100) throw new NotionError("A managed relation exceeds the supported property size.", 409);
        cursor = result.has_more ? result.next_cursor : null;
      } while (cursor);
      byId.set(id, { ...property, relation });
    }
  }
  return jsonHash(ids.slice().sort().map(id => [id, propertyValue(byId.get(id)!)]));
}
async function fingerprint(id: string): Promise<string> {
  let count = 0;
  async function value(block: RemoteBlock): Promise<unknown> {
    if (++count > 1500) throw new NotionError("The managed Notion section is too large to verify safely.", 409);
    const image = block.type === "image" ? block.image as { file?: { url?: string }; external?: { url?: string } } : undefined;
    const imageUrl = image?.file?.url ?? image?.external?.url;
    return { id: block.id, value: managedBlockValue(block), image: imageUrl ? new URL(imageUrl).pathname : undefined,
      children: block.has_children ? await Promise.all((await notionChildren(block.id)).map(value)) : [] };
  }
  const block = await notionRequest<RemoteBlock>(`/blocks/${id}`);
  if (block.archived || block.in_trash) throw new NotionError("App-managed Notion content was removed. Review this conflict before publishing.", 409);
  return jsonHash(await value(block));
}
function locate(tree: TemplateBlock[], path: number[], pageId: string): { node: TemplateBlock; parent: string } | null {
  let nodes = tree, parent = pageId;
  for (let depth = 0; depth < path.length; depth++) {
    const node = nodes[path[depth]]; if (!node) return null;
    if (depth === path.length - 1) return { node, parent };
    nodes = node.children; parent = node.id;
  }
  return null;
}

export async function startNotionPublication(id: string, groupKey: string) {
  requireNotionPublishing();
  const job = await prisma.notionPublishJob.findUnique({ where: { id } });
  if (!job || job.groupKey !== groupKey) throw new NotionError("Publication not found.", 404);
  if (job.state !== "preview") return publicationStatus(job);
  const plan = job.plan as unknown as PublishPlan;
  if (plan.errors.length) throw new NotionError("Resolve every preview warning before publishing.", 422);
  const doc = await readWorkstationDocument(groupKey);
  if (jsonHash(doc) !== (job.snapshot as unknown as PublishSnapshot).digest) throw new WorkstationError("The saved review changed. Prepare a new preview.");
  const trade = await prisma.closedTrade.findUnique({ where: { groupKey }, select: { isStale: true } });
  if (!trade || trade.isStale) throw new WorkstationError("Stale trades cannot be published.");
  const refreshed = await readTemplateLayout(true);
  if (refreshed.warning || refreshed.layout.id !== plan.layout.id) throw new NotionError("The template changed or cannot be verified. Prepare a new preview.", 409);
  const schema = await notionRequest<{ properties: Record<string, RemoteProperty> }>(`/data_sources/${NOTION_DATA_SOURCE_ID}`);
  if (jsonHash(propertySchemaSignature(Object.values(schema.properties))) !== plan.schemaHash) throw new NotionError("The Notion database schema changed. Prepare a new preview.", 409);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "groupKey" FROM "NotionPublication" WHERE "groupKey" = ${groupKey} FOR UPDATE`;
    const publication = await tx.notionPublication.findUniqueOrThrow({ where: { groupKey } });
    if (publication.activeJobId && publication.activeJobId !== id) throw new NotionError("Another publication for this trade needs to finish first.", 409);
    if (publication.dataSourceId !== NOTION_DATA_SOURCE_ID) throw new NotionError("This trade is bound to a different Notion database.", 409);
    await tx.notionPublication.update({ where: { groupKey }, data: { activeJobId: id } });
    await tx.notionPublishJob.updateMany({ where: { id, state: "preview" }, data: { state: "ready" } });
  });
  return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
}

export const resumeNotionPublication = (id: string, groupKey: string) => withNotionBudget(() => runPublicationStep(id, groupKey));
async function runPublicationStep(id: string, groupKey: string) {
  requireNotionPublishing();
  const lease = randomUUID(), until = new Date(Date.now() + 180_000);
  const global = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "NotionRequestGate" ("key", "nextAt", "updatedAt") VALUES ('publisher', (${until}::timestamptz AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET "nextAt" = EXCLUDED."nextAt", "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "NotionRequestGate"."nextAt" <= (NOW() AT TIME ZONE 'UTC') RETURNING "key"`;
  if (!global.length) throw new NotionError("Another Notion publication step is running. Try again shortly.", 409);
  let job: NotionPublishJob | null = null;
  try {
    const result = await prisma.notionPublishJob.updateMany({ where: { id, groupKey, state: { in: ["ready", "running", "waiting", "failed", "conflict"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }], AND: [{ OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }] }] }, data: { leaseToken: lease, leaseUntil: until, state: "running", error: null, retryAt: null } });
    if (!result.count) {
      const current = await prisma.notionPublishJob.findUnique({ where: { id } });
      if (!current || current.groupKey !== groupKey) throw new NotionError("Publication not found.", 404);
      return publicationStatus(current);
    }
    job = await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } });
    const plan = job.plan as unknown as PublishPlan, snapshot = job.snapshot as unknown as PublishSnapshot;
    const progress = job.progress as unknown as Progress;
    const publication = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey } });
    const bindings = publication.bindings as unknown as Bindings;
    if (publication.activeJobId !== id) throw new NotionError("This publication no longer owns the trade's publishing slot.", 409);
    const trade = await prisma.closedTrade.findUnique({ where: { groupKey }, select: { isStale: true } });
    if (!trade || trade.isStale) throw new WorkstationError("The trade became stale. Publication is paused.");
    async function checkpoint(patch: { state?: string; error?: string | null } = {}) {
      const saved = await prisma.notionPublishJob.updateMany({ where: { id, leaseToken: lease, leaseUntil: { gt: new Date() } }, data: { progress: asJson(progress), ...patch } });
      if (!saved.count) throw new NotionError("The publishing lease expired. Resume to reconcile saved progress.", 409);
    }
    async function write<T = JsonObject>(path: string, method: string, body?: unknown) { await checkpoint(); return notionRequest<T>(path, method, body); }
    if (!progress.botId) { progress.botId = (await notionRequest<{ id: string }>("/users/me")).id; await checkpoint(); }
    if (!progress.pageId) {
      if (publication.pageId) progress.pageId = publication.pageId;
      else {
        progress.createTitle ??= `${snapshot.symbol} · TJ-${id}`;
        if (progress.createIntent) {
          const match = await notionRequest<{ results: { id: string; created_by: { id: string } }[]; has_more: boolean }>(`/data_sources/${NOTION_DATA_SOURCE_ID}/query`, "POST", { filter: { property: plan.titleId, title: { equals: progress.createTitle } }, page_size: 2 });
          if (match.results.length !== 1 || match.has_more || match.results[0].created_by.id !== progress.botId) throw new NotionError("Page creation is unconfirmed. No second page will be created. Check Notion, then resume reconciliation.", 409);
          progress.pageId = match.results[0].id;
        } else {
          progress.createIntent = true; await checkpoint();
          try {
            const page = await write<{ id: string }>("/pages", "POST", { parent: { type: "data_source_id", data_source_id: NOTION_DATA_SOURCE_ID }, properties: { [plan.titleId]: { title: notionRichText(progress.createTitle) } }, template: { type: "template_id", template_id: NOTION_TEMPLATE_ID, timezone: "America/New_York" } });
            progress.pageId = page.id;
          } catch (e) { if (e instanceof NotionError && !e.uncertain) { progress.createIntent = false; await checkpoint(); } throw e; }
        }
        await prisma.notionPublication.update({ where: { groupKey }, data: { pageId: progress.pageId } });
      }
      await checkpoint({ state: "waiting" });
      return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
    }
    const pageId = progress.pageId;
    const owner = await notionRequest<{ created_by: { id: string }; parent: { data_source_id?: string }; archived?: boolean; in_trash?: boolean }>(`/pages/${pageId}`);
    if (owner.created_by?.id !== progress.botId || owner.parent?.data_source_id !== NOTION_DATA_SOURCE_ID || owner.archived || owner.in_trash)
      throw new NotionError("The saved destination is not an active page created by this connection in the configured database. It will not be adopted or overwritten.", 409);
    if (!progress.anchors) {
      if (bindings.sections && Object.keys(bindings.sections).length) {
        const anchors: Record<string, Anchor> = {};
        for (const section of plan.sections) {
          const binding = bindings.sections[section.key];
          if (!binding || binding.anchor.sourceId !== section.sourceId) throw new NotionError("This page uses an earlier template structure. A new or recreated section needs a reviewed page-layout migration; existing content has not been changed.", 409);
          anchors[section.key] = binding.anchor;
        }
        progress.anchors = anchors;
      } else {
        const tree = await notionTree(pageId), anchors: Record<string, Anchor> = {};
        for (const section of plan.sections) {
          const found = locate(tree, section.path, pageId);
          if (!found || found.node.type !== section.type || found.node.text.trim() !== section.label) throw new NotionError("The template is not ready or its structure differs from the preview. Resume after checking Notion; the template will not be reapplied.", 409);
          anchors[section.key] = { id: found.node.id, parent: found.parent, sourceId: section.sourceId, type: section.type };
        }
        progress.anchors = anchors;
      }
      await checkpoint();
    }
    if (!progress.checked) {
      if (bindings.propertyFingerprint && bindings.propertyIds && await pageProperties(pageId, bindings.propertyIds) !== bindings.propertyFingerprint) throw new NotionError("App-managed Notion properties were edited. Review and resolve that conflict in Notion before resuming.", 409);
      for (const binding of Object.values(bindings.sections ?? {})) if (await fingerprint(binding.container) !== binding.fingerprint) throw new NotionError("App-managed Notion section content was edited. Review and resolve that conflict before resuming.", 409);
      progress.checked = true; await checkpoint();
    }
    progress.sections ??= {};
    const section = plan.sections.find(section => !progress.sections?.[section.key]?.done);
    if (section) {
      const state = progress.sections[section.key] ??= {};
      const anchor = progress.anchors[section.key], parent = anchor.type === "toggle" ? anchor.id : anchor.parent;
      const marker = `${plan.sourceUrl}#notion-${id}-${jsonHash(section.key).slice(0, 12)}`;
      if (!state.container) {
        const existing = (await notionChildren(parent)).filter(block => managedPlaceholder(block) === marker);
        if (existing.length > 1) throw new NotionError("Duplicate app-owned section containers require review.", 409);
        if (existing.length) state.container = existing[0].id;
        else if (state.createIntent) throw new NotionError("Section creation is unconfirmed. Resume reconciliation; no duplicate section will be appended.", 409);
        else {
          state.createIntent = true; await checkpoint();
          try {
            const response = await write<{ results: { id: string }[] }>(`/blocks/${parent}/children`, "PATCH", { children: [{ object: "block", type: "callout", callout: { rich_text: [{ type: "text", text: { content: `Trade journal review · revision ${job.revision}`, link: { url: marker } } }] } }], position: anchor.type === "toggle" ? { type: "end" } : { type: "after_block", after_block: { id: anchor.id } } });
            state.container = response.results[0].id;
          } catch (e) { if (e instanceof NotionError && !e.uncertain) { state.createIntent = false; await checkpoint(); } throw e; }
        }
        await checkpoint();
      }
      const blocks = [...section.blocks];
      for (const imageId of section.images) {
        const asset = snapshot.assets.find(asset => asset.id === imageId)!;
        const uploadId = await uploadAsset(asset, write);
        blocks.push({ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: uploadId }, caption: notionRichText(asset.caption) } });
      }
      async function append(parentId: string, desired: JsonObject[], depth = 0): Promise<void> {
        if (depth > 12) throw new NotionError("This section's nesting exceeds the safe publishing limit.", 422);
        const existing = await notionChildren(parentId);
        if (existing.length > desired.length || existing.some((block, index) => jsonHash(managedBlockValue(block)) !== jsonHash(managedBlockValue({ id: "", ...desired[index] } as RemoteBlock)))) throw new NotionError("An in-progress Notion section was edited. Resolve the conflicting content before resuming.", 409);
        if (progress.pendingAppend?.parent === parentId) {
          if (existing.length < progress.pendingAppend.count) throw new NotionError("A content append is unconfirmed. No duplicate text or images will be sent. Resume after checking Notion.", 409);
          delete progress.pendingAppend; await checkpoint();
        }
        while (existing.length < desired.length) {
          const chunk = desired.slice(existing.length, existing.length + 80).map(block => { const type = String(block.type), data = { ...block[type] as JsonObject }; delete data.children; return { ...block, [type]: data }; });
          progress.pendingAppend = { parent: parentId, count: existing.length + chunk.length }; await checkpoint();
          try {
            const result = await write<{ results: RemoteBlock[] }>(`/blocks/${parentId}/children`, "PATCH", { children: chunk });
            existing.push(...result.results); delete progress.pendingAppend; await checkpoint();
          } catch (e) { if (e instanceof NotionError && !e.uncertain) { delete progress.pendingAppend; await checkpoint(); } throw e; }
        }
        for (let index = 0; index < desired.length; index++) {
          const children = (desired[index][String(desired[index].type)] as { children?: JsonObject[] }).children;
          if (children?.length) await append(existing[index].id, children, depth + 1);
          else if (existing[index].has_children) throw new NotionError("Unexpected nested content was added in Notion. Review the conflict.", 409);
        }
      }
      await append(state.container, blocks);
      const old = bindings.sections?.[section.key];
      if (old && old.container !== state.container) {
        const oldBlock = await notionRequest<RemoteBlock>(`/blocks/${old.container}`);
        if (!oldBlock.archived && !oldBlock.in_trash) {
          if (await fingerprint(old.container) !== old.fingerprint) throw new NotionError("The previous Notion content changed during publishing. Both versions are preserved for review.", 409);
          await write(`/blocks/${old.container}`, "DELETE");
        }
      }
      state.fingerprint = await fingerprint(state.container); state.done = true;
      await checkpoint({ state: "waiting" });
      return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
    }
    if (!progress.propertiesDone) {
      for (const state of Object.values(progress.sections)) if (state.done && state.container && await fingerprint(state.container) !== state.fingerprint)
        throw new NotionError("A completed section changed during publication. Review the Notion edit before finalizing.", 409);
      const ids = Object.keys(plan.properties), current = await pageProperties(pageId, ids);
      const expected = jsonHash(ids.slice().sort().map(id => [id, propertyValue(plan.properties[id])]));
      if (progress.propertyIntent) {
        if (current === expected) { progress.propertiesDone = true; progress.newPropertyFingerprint = current; progress.propertyIntent = false; await checkpoint(); }
        else if (current !== progress.propertyBase) throw new NotionError("Property update completion is uncertain. Verify the Notion values before a reviewed retry.", 409);
      } else if (bindings.propertyFingerprint && await pageProperties(pageId, bindings.propertyIds ?? []) !== bindings.propertyFingerprint) throw new NotionError("Notion properties changed while publishing. Review the conflict.", 409);
      if (!progress.propertiesDone) {
        progress.propertyBase = current; progress.propertyIntent = true; await checkpoint();
        try { await write(`/pages/${pageId}`, "PATCH", { properties: plan.properties }); }
        catch (e) { if (e instanceof NotionError && !e.uncertain) { progress.propertyIntent = false; await checkpoint(); } throw e; }
        progress.newPropertyFingerprint = await pageProperties(pageId, ids);
        if (progress.newPropertyFingerprint !== expected) throw new NotionError("The written properties differ from the preview. Review Notion before finalizing this publication.", 409);
        progress.propertiesDone = true; progress.propertyIntent = false; await checkpoint();
      }
    }
    const nextBindings: Bindings = { sections: { ...bindings.sections }, propertyIds: Object.keys(plan.properties), propertyFingerprint: progress.newPropertyFingerprint };
    for (const section of plan.sections) { const done = progress.sections[section.key]; nextBindings.sections![section.key] = { anchor: progress.anchors[section.key], container: done.container!, fingerprint: done.fingerprint! }; }
    await prisma.$transaction(async tx => {
      const saved = await tx.notionPublishJob.updateMany({ where: { id, leaseToken: lease, leaseUntil: { gt: new Date() } }, data: { progress: asJson(progress), state: "succeeded", error: null,
        snapshot: asJson({ ...snapshot, assets: snapshot.assets.map(asset => ({ ...asset, image: "" })) }),
      } });
      if (!saved.count) throw new NotionError("Publishing lease expired before completion.", 409);
      await tx.notionPublication.update({ where: { groupKey }, data: { bindings: asJson(nextBindings), lastRevision: job!.revision, templateId: job!.templateId, activeJobId: null } });
    });
    return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
  } catch (error) {
    if (job) {
      const known = error instanceof NotionError || error instanceof WorkstationError;
      await prisma.notionPublishJob.updateMany({ where: { id, leaseToken: lease }, data: { state: known && error.status === 409 ? "conflict" : "failed", error: known ? error.message : "Publishing failed. Progress is retained; inspect and resume.", retryAt: error instanceof NotionError ? error.retryAt ?? null : null } });
      return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
    }
    throw error;
  } finally {
    await prisma.notionPublishJob.updateMany({ where: { id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } });
    await prisma.notionRequestGate.updateMany({ where: { key: "publisher", nextAt: until }, data: { nextAt: new Date() } });
  }
}

async function uploadAsset(asset: PublishSnapshot["assets"][number], write: <T = JsonObject>(path: string, method: string, body?: unknown) => Promise<T>): Promise<string> {
  const id = jsonHash({ source: NOTION_DATA_SOURCE_ID, hash: asset.hash });
  let row = await prisma.notionUpload.upsert({ where: { id }, create: { id, dataSourceId: NOTION_DATA_SOURCE_ID, contentHash: asset.hash }, update: {} });
  if (row.uploadId) {
    const upload = await notionRequest<{ status: string }>(`/file_uploads/${row.uploadId}`);
    if (upload.status === "uploaded") return row.uploadId;
    if (upload.status === "expired" || upload.status === "failed") row = await prisma.notionUpload.update({ where: { id }, data: { uploadId: null, status: "pending" } });
  }
  if (!row.uploadId) {
    // An unconfirmed creation has no image bytes yet and expires unused. Bytes
    // are only sent after the resulting upload ID is durable.
    const upload = await write<{ id: string }>("/file_uploads", "POST", { mode: "single_part", filename: `${asset.hash}.png`, content_type: "image/png" });
    row = await prisma.notionUpload.update({ where: { id }, data: { uploadId: upload.id } });
  }
  const bytes = Buffer.from(asset.image.split(",")[1], "base64"), form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), `${asset.hash}.png`);
  await write(`/file_uploads/${row.uploadId}/send`, "POST", form);
  await prisma.notionUpload.update({ where: { id }, data: { status: "uploaded" } });
  return row.uploadId!;
}
