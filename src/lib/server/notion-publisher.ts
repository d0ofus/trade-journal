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
import { templateRetryAt, templateTimeoutMessage, templateWaitExpired, type TemplateWait } from "@/lib/workstation/notion-publication-state";
import { completePublishedReview } from "./notion-review-completion";
import { effectivePresentation, planPresentation } from "./notion-presentation";
import { createPlainProgress, fingerprint, inspectPlainBinding, publishPlainSection, verifyPlainAnchor, verifyPlainCompletion, type PlainBinding, type PlainProgress, type VerificationState } from "./notion-plain-sections";
import { readFingerprint, written, type WrittenNode } from "./notion-block-verification";

type Anchor = { id: string; parent: string; sourceId: string; type: string };
type SectionBinding = { anchor: Anchor; container?: string; fingerprint?: string; plain?: PlainBinding; contentHash?: string };
type Bindings = { presentationVersion?: number; sections?: Record<string, SectionBinding>; propertyFingerprint?: string; propertyIds?: string[]; propertyFingerprints?: Record<string, string> };
type Progress = { pageId?: string; botId?: string; createIntent?: boolean; createTitle?: string; anchors?: Record<string, Anchor>;
  checkIndex?: number; finalIndex?: number; verification?: VerificationState;
  retryReason?: string; failures?: number;
  provider?: { code?: string; requestId?: string };
  conflicts?: { key: string; label: string; fingerprint: string }[];
  overrides?: Record<string, SectionBinding>; propertyOverride?: string;
  overwriteAcknowledgement?: string;
  templateWait?: TemplateWait;
  checked?: boolean; propertiesDone?: boolean; propertyIntent?: boolean; propertyBase?: string; newPropertyFingerprint?: string;
  pendingAppend?: { parent: string; count: number }; sections?: Record<string, { container?: string; createIntent?: boolean; removeIntent?: string; done?: boolean; fingerprint?: string; plain?: PlainProgress; unchanged?: boolean; contentHash?: string; appendedParents?: string[]; legacyRoot?: WrittenNode }>; };
class ContentConflict extends NotionError {
  constructor(public key: string, public label: string, public fingerprint: string) { super(`App-managed Notion content was edited: ${label}. Review before replacing it with saved app data.`, 409); }
}
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const progressDigest = (progress: Progress) => { const content = { ...progress }; delete content.failures; delete content.retryReason; delete content.provider; return jsonHash(content); };
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
async function readPageProperties(pageId: string, ids: string[]) {
  const page = await notionRequest<{ properties: Record<string, JsonObject> }>(`/pages/${pageId}`);
  const byId = new Map<string, JsonObject>(Object.entries(page.properties).map(([name, value]) => [String(value.id), { ...value, name }]));
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
  return Object.fromEntries(ids.map(id => [id, byId.get(id)!]));
}
const propertiesFingerprint = (values: Record<string, JsonObject>) => jsonHash(Object.keys(values).sort().map(id => [id, propertyValue(values[id])]));
const pageProperties = async (pageId: string, ids: string[]) => propertiesFingerprint(await readPageProperties(pageId, ids));
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
    if (await effectivePresentation(publication, tx) !== planPresentation(plan) ||
      (plan.targetPageId !== undefined && plan.targetPageId !== publication.pageId))
      throw new NotionError("The destination or publication format changed. Prepare a new preview.", 409);
    const assets = (job.snapshot as unknown as PublishSnapshot).assets.flatMap(image => image.asset ? [image.asset.id] : []);
    if (assets.length) {
      const { lockClosedTradeForReview } = await import("./closed-trade-review-lock");
      await lockClosedTradeForReview(tx, groupKey);
      for (const assetId of new Set(assets)) {
        const asset = await tx.evidenceAsset.findFirst({ where: { id: assetId, tradeId: groupKey, state: "ready" } });
        if (!asset) throw new NotionError("An original is no longer available. Prepare a fresh preview.", 409);
        await tx.evidenceAssetReference.upsert({ where: { assetId_kind_key: { assetId, kind: "publication", key: id } }, create: { assetId, kind: "publication", key: id }, update: { expiresAt: null } });
        await tx.evidenceAsset.update({ where: { id: assetId }, data: { unreferencedAt: null } });
      }
    }
    await tx.notionPublication.update({ where: { groupKey }, data: { activeJobId: id } });
    await tx.notionPublishJob.updateMany({ where: { id, state: "preview" }, data: { state: "ready" } });
  });
  return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
}

export const resumeNotionPublication = (id: string, groupKey: string, overwrite?: string) => withNotionBudget(() => runPublicationStep(id, groupKey, overwrite));
async function runPublicationStep(id: string, groupKey: string, overwrite?: string) {
  requireNotionPublishing();
  const lease = randomUUID(), until = new Date(Date.now() + 180_000);
  const global = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "NotionRequestGate" ("key", "nextAt", "updatedAt") VALUES ('publisher', (${until}::timestamptz AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET "nextAt" = EXCLUDED."nextAt", "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "NotionRequestGate"."nextAt" <= (NOW() AT TIME ZONE 'UTC') RETURNING "key"`;
  if (!global.length) throw new NotionError("Another Notion publication step is running. Waiting for its publishing slot…", 429, new Date(Date.now() + 2000), false, "busy");
  let job: NotionPublishJob | null = null;
  let currentProgress: Progress | undefined;
  let initialDigest = "";
  try {
    const previous = await prisma.notionPublishJob.findUnique({ where: { id } });
    const result = await prisma.notionPublishJob.updateMany({ where: { id, groupKey, state: { in: ["ready", "running", "waiting", "failed", "conflict"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }], AND: [{ OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }] }] }, data: { leaseToken: lease, leaseUntil: until, state: "running", error: null, retryAt: null } });
    if (!result.count) {
      const current = await prisma.notionPublishJob.findUnique({ where: { id } });
      if (!current || current.groupKey !== groupKey) throw new NotionError("Publication not found.", 404);
      return publicationStatus(current);
    }
    job = await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } });
    const plan = job.plan as unknown as PublishPlan, snapshot = job.snapshot as unknown as PublishSnapshot;
    const progress = job.progress as unknown as Progress;
    currentProgress = progress;
    if (previous && ["failed", "conflict"].includes(previous.state)) {
      progress.failures = 0;
      if (!overwrite) { progress.checked = false; progress.checkIndex = 0; progress.finalIndex = 0; delete progress.verification; delete progress.conflicts; delete progress.overwriteAcknowledgement; }
    }
    initialDigest = progressDigest(progress);
    // Only explicit Resume reaches a paused timeout. Open a new bounded window,
    // retaining the same page, creation intent and frozen publication snapshot.
    if (progress.templateWait?.timedOut) progress.templateWait = { startedAt: Date.now(), attempt: 0 };
    const publication = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey } });
    const bindings = publication.bindings as unknown as Bindings;
    if (publication.activeJobId !== id) throw new NotionError("This publication no longer owns the trade's publishing slot.", 409);
    const trade = await prisma.closedTrade.findUnique({ where: { groupKey }, select: { isStale: true } });
    if (!trade || trade.isStale) throw new WorkstationError("The trade became stale. Publication is paused.");
    async function checkpoint(patch: { state?: string; error?: string | null; retryAt?: Date | null } = {}) {
      const saved = await prisma.notionPublishJob.updateMany({ where: { id, leaseToken: lease, leaseUntil: { gt: new Date() } }, data: { progress: asJson(progress), ...patch } });
      if (!saved.count) throw new NotionError("The publishing lease expired. Resume to reconcile saved progress.", 409);
    }
    async function write<T = JsonObject>(path: string, method: string, body?: unknown) { await checkpoint(); return notionRequest<T>(path, method, body); }
    const status = async () => publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
    const label = (key: string) => plan.sections.find(section => section.key === key)?.label ?? "Trade properties";
    async function inspectBinding(binding: SectionBinding, cursors: VerificationState = {}) {
      await verifyPlainAnchor(binding.anchor);
      const actual = { ...binding };
      if (binding.container) actual.fingerprint = await fingerprint(binding.container, cursors, checkpoint);
      if (binding.plain) actual.plain = await inspectPlainBinding(binding.plain, [], cursors, checkpoint);
      return actual;
    }
    async function checkBinding(key: string, binding: SectionBinding, cursors?: VerificationState) {
      const actual = await inspectBinding(binding, cursors);
      if (jsonHash(actual) !== jsonHash(binding)) throw new ContentConflict(key, label(key), jsonHash(actual));
    }
    // Acknowledgements apply only to the observed remote version and this frozen job.
    const acknowledgement = overwrite ?? progress.overwriteAcknowledgement;
    if (acknowledgement) {
      if (!progress.conflicts?.length || jsonHash(progress.conflicts) !== acknowledgement) throw new NotionError("The overwrite acknowledgement is outdated. Review the current conflict.", 409);
      progress.overwriteAcknowledgement = acknowledgement;
      await checkpoint();
      for (const conflict of progress.conflicts) {
        if (conflict.key === "$properties") {
          const actual = await pageProperties(progress.pageId!, bindings.propertyIds ?? []);
          if (actual !== conflict.fingerprint) throw new ContentConflict(conflict.key, conflict.label, actual);
          progress.propertyOverride = actual;
        } else {
          const binding = progress.overrides?.[conflict.key] ?? bindings.sections?.[conflict.key];
          if (!binding) throw new NotionError("The section binding is unavailable. Review the page layout.", 409);
          const actual = await inspectBinding(binding, progress.verification ??= {});
          if (jsonHash(actual) !== conflict.fingerprint) throw new ContentConflict(conflict.key, conflict.label, jsonHash(actual));
          (progress.overrides ??= {})[conflict.key] = actual;
          const partial = progress.sections?.[conflict.key]?.plain;
          if (partial) { delete partial.verification; partial.oldChecked = false; }
        }
      }
      delete progress.conflicts; delete progress.verification; delete progress.overwriteAcknowledgement;
      progress.checked = false; progress.checkIndex = 0;
      await checkpoint();
    }
    // The initial check and the write path use the same acknowledged bindings.
    bindings.sections = { ...bindings.sections, ...progress.overrides };
    if (progress.propertyOverride) bindings.propertyFingerprint = progress.propertyOverride;
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
        await prisma.notionPublication.update({ where: { groupKey }, data: { pageId: progress.pageId, bindings: asJson({ ...bindings, presentationVersion: planPresentation(plan) }) } });
      }
      if (!bindings.sections || !Object.keys(bindings.sections).length) progress.templateWait ??= { startedAt: Date.now(), attempt: 0 };
      await checkpoint({ state: "waiting", retryAt: progress.templateWait ? templateRetryAt(progress.templateWait) : null });
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
        progress.templateWait ??= { startedAt: Date.now(), attempt: 0 };
        await checkpoint();
        const tree = await notionTree(pageId), anchors: Record<string, Anchor> = {};
        const missing: string[] = [];
        for (const section of plan.sections) {
          const found = locate(tree, section.path, pageId);
          if (!found || found.node.type !== section.type || found.node.text.trim() !== section.label) { missing.push([...section.groups, section.label].join(" / ")); continue; }
          anchors[section.key] = { id: found.node.id, parent: found.parent, sourceId: section.sourceId, type: section.type };
        }
        if (missing.length) {
          const wait = progress.templateWait;
          wait.missing = missing;
          wait.timedOut = templateWaitExpired(wait);
          wait.attempt++;
          await checkpoint({ state: wait.timedOut ? "failed" : "waiting", error: wait.timedOut ? templateTimeoutMessage : null, retryAt: wait.timedOut ? null : templateRetryAt(wait) });
          return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
        }
        progress.anchors = anchors;
      }
      delete progress.templateWait;
      await checkpoint();
    }
    if (!progress.checked) {
      const checks = ["$properties", ...Object.keys(bindings.sections ?? {})];
      const key = checks[progress.checkIndex ?? 0];
      if (key) {
        try {
          if (key === "$properties") {
            if (bindings.propertyFingerprint && bindings.propertyIds && !progress.propertyIntent && !progress.propertiesDone) {
              const values = await readPageProperties(pageId, bindings.propertyIds), actual = propertiesFingerprint(values);
              if (actual !== bindings.propertyFingerprint) {
                const changed = Object.keys(values).filter(id => bindings.propertyFingerprints?.[id] && bindings.propertyFingerprints[id] !== jsonHash(propertyValue(values[id])));
                throw new ContentConflict(key, changed.map(id => String(values[id].name)).join(", ") || "Trade properties", actual);
              }
            }
          } else if (!progress.sections?.[key]?.done && !progress.sections?.[key]?.plain?.ready && !progress.sections?.[key]?.removeIntent) {
            await checkBinding(key, bindings.sections![key], progress.verification ??= {});
          }
        } catch (error) {
          if (!(error instanceof ContentConflict)) throw error;
          (progress.conflicts ??= []).push({ key: error.key, label: error.label, fingerprint: error.fingerprint });
        }
        delete progress.verification;
        progress.checkIndex = (progress.checkIndex ?? 0) + 1;
        await checkpoint({ state: "waiting" });
        return status();
      }
      if (progress.conflicts?.length) {
        const first = progress.conflicts[0]; throw new ContentConflict(first.key, first.label, first.fingerprint);
      }
      progress.checked = true; await checkpoint();
    }
    progress.sections ??= {};
    const section = plan.sections.find(section => !progress.sections?.[section.key]?.done);
    if (section) {
      const state = progress.sections[section.key] ??= {};
      const old = bindings.sections?.[section.key];
      state.contentHash ??= jsonHash({ presentation: planPresentation(plan), blocks: section.blocks, images: section.images.map(imageId => {
        const asset = snapshot.assets.find(asset => asset.id === imageId);
        if (!asset) throw new NotionError("A frozen evidence asset is missing. Review the publication.", 409);
        return { hash: asset.hash, caption: asset.caption };
      }) });
      if (old?.contentHash === state.contentHash && !progress.overrides?.[section.key]) {
        await checkBinding(section.key, old, progress.verification ??= {});
        delete progress.verification;
        Object.assign(state, { unchanged: true, done: true, container: old.container, fingerprint: old.fingerprint });
        if (old.plain) state.plain = { ...old.plain, nodes: [], removalIntents: [], ready: true, binding: old.plain };
        await checkpoint({ state: "waiting" }); return status();
      }
      if (planPresentation(plan) >= 4) {
        if (old?.container) throw new NotionError("An existing callout page cannot be converted by this publication. Prepare a new preview.", 409);
        await verifyPlainAnchor(progress.anchors[section.key]);
        state.plain ??= await createPlainProgress(progress.anchors[section.key], old?.plain);
        await checkpoint();
        const blocks = [...section.blocks], imageHashes = new Map<string, string>();
        for (const imageId of section.images) {
          const asset = snapshot.assets.find(asset => asset.id === imageId);
          if (!asset) throw new NotionError("A frozen evidence asset is missing. Review the publication.", 409);
          const uploadId = await uploadAsset(asset, write); imageHashes.set(uploadId, asset.hash);
          blocks.push({ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: uploadId }, caption: notionRichText(asset.caption) } });
        }
        try { await publishPlainSection(state.plain, blocks, old?.plain, progress.botId!, imageHashes, checkpoint, write); }
        catch (error) {
          if (error instanceof NotionError && error.status === 409 && old && !state.plain.cleanupIndex) await checkBinding(section.key, old);
          throw error;
        }
        state.done = true; await checkpoint({ state: "waiting" });
        return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
      }
      // Frozen legacy jobs retain their original presentation. New plans omit empty
      // containers, but keep anchors so these sections can be populated later.
      if ((plan.presentationVersion ?? 1) >= 3 && !section.blocks.length && !section.images.length) {
        const old = bindings.sections?.[section.key];
        if (old?.container) {
          const block = await notionRequest<RemoteBlock>(`/blocks/${old.container}`);
          if (block.archived || block.in_trash) {
            if (state.removeIntent !== old.container) throw new NotionError("App-managed Notion content was removed outside this publication. Review the conflict.", 409);
          } else {
            await checkBinding(section.key, old, progress.verification ??= {}); delete progress.verification;
            state.removeIntent = old.container; await checkpoint();
            await write(`/blocks/${old.container}`, "DELETE");
          }
        }
        state.done = true;
        await checkpoint({ state: "waiting" });
        return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
      }
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
      if (!state.legacyRoot) { state.legacyRoot = written(await notionRequest<RemoteBlock>(`/blocks/${state.container}`)); await checkpoint(); }
      const blocks = [...section.blocks];
      for (const imageId of section.images) {
        const asset = snapshot.assets.find(asset => asset.id === imageId)!;
        const uploadId = await uploadAsset(asset, write);
        blocks.push({ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: uploadId }, caption: notionRichText(asset.caption) } });
      }
      async function append(parentId: string, desired: JsonObject[], nodes: WrittenNode[], depth = 0): Promise<void> {
        if (depth > 12) throw new NotionError("This section's nesting exceeds the safe publishing limit.", 422);
        if (state.appendedParents?.includes(parentId)) return;
        const existing = await notionChildren(parentId);
        if (existing.length > desired.length || existing.some((block, index) => jsonHash(managedBlockValue(block)) !== jsonHash(managedBlockValue({ id: "", ...desired[index] } as RemoteBlock)))) throw new NotionError("An in-progress Notion section was edited. Resolve the conflicting content before resuming.", 409);
        if (nodes.some((node, index) => node.id !== existing[index]?.id || node.value !== written(existing[index]).value)) throw new NotionError("An in-progress Notion section changed. Review the conflicting content before resuming.", 409);
        nodes.push(...existing.slice(nodes.length).map(written));
        if (progress.pendingAppend?.parent === parentId) {
          if (existing.length < progress.pendingAppend.count) throw new NotionError("A content append is unconfirmed. No duplicate text or images will be sent. Resume after checking Notion.", 409);
          delete progress.pendingAppend; await checkpoint();
        }
        while (existing.length < desired.length) {
          const chunk = desired.slice(existing.length, existing.length + 80).map(block => { const type = String(block.type), data = { ...block[type] as JsonObject }; delete data.children; return { ...block, [type]: data }; });
          progress.pendingAppend = { parent: parentId, count: existing.length + chunk.length }; await checkpoint();
          try {
            const result = await write<{ results: RemoteBlock[] }>(`/blocks/${parentId}/children`, "PATCH", { children: chunk });
            existing.push(...result.results); nodes.push(...result.results.map(written)); delete progress.pendingAppend; await checkpoint();
          } catch (e) { if (e instanceof NotionError && !e.uncertain) { delete progress.pendingAppend; await checkpoint(); } throw e; }
        }
        for (let index = 0; index < desired.length; index++) {
          const children = (desired[index][String(desired[index].type)] as { children?: JsonObject[] }).children;
          if (children?.length) await append(existing[index].id, children, nodes[index].children, depth + 1);
          else if (existing[index].has_children) throw new NotionError("Unexpected nested content was added in Notion. Review the conflict.", 409);
        }
        (state.appendedParents ??= []).push(parentId); await checkpoint();
      }
      await append(state.container, blocks, state.legacyRoot.children);
      if (await readFingerprint(state.container, true, progress.verification ??= {}, checkpoint) !== jsonHash(state.legacyRoot)) throw new NotionError("The replacement Notion content changed before cleanup. Review the conflicting content.", 409);
      state.fingerprint = await fingerprint(state.container, progress.verification, checkpoint);
      delete progress.verification;
      if (old?.container && old.container !== state.container) {
        const oldBlock = await notionRequest<RemoteBlock>(`/blocks/${old.container}`);
        if (!oldBlock.archived && !oldBlock.in_trash) {
          await checkBinding(section.key, old, progress.verification ??= {}); delete progress.verification;
          await write(`/blocks/${old.container}`, "DELETE");
        }
      }
      state.done = true;
      await checkpoint({ state: "waiting" });
      return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
    }
    // Verify one section per durable step, including unchanged sections. Each
    // subtree has its own cursor so a large section can span bounded requests.
    const finalSection = plan.sections[progress.finalIndex ?? 0];
    if (finalSection) {
      const key = finalSection.key, state = progress.sections[key];
      await verifyPlainAnchor(progress.anchors[key]);
      if (state.plain) await verifyPlainCompletion(state.plain, checkpoint);
      if (state.removeIntent) {
        const removed = await notionRequest<RemoteBlock>(`/blocks/${state.removeIntent}`);
        if (!removed.archived && !removed.in_trash) throw new NotionError("A removed section was restored during publication. Review the Notion edit before finalizing.", 409);
      }
      if (state.container && await fingerprint(state.container, progress.verification ??= {}, checkpoint) !== state.fingerprint)
        throw new NotionError("A completed section changed during publication. Review the Notion edit before finalizing.", 409);
      delete progress.verification;
      progress.finalIndex = (progress.finalIndex ?? 0) + 1;
      await checkpoint({ state: "waiting" }); return status();
    }
    if (!progress.propertiesDone) {
      const ids = Object.keys(plan.properties), values = await readPageProperties(pageId, ids), current = propertiesFingerprint(values);
      const expected = propertiesFingerprint(plan.properties);
      if (progress.propertyIntent) {
        if (current === expected) { progress.propertiesDone = true; progress.newPropertyFingerprint = current; progress.propertyIntent = false; await checkpoint(); }
        else if (current !== progress.propertyBase) throw new NotionError("Property update completion is uncertain. Verify the Notion values before a reviewed retry.", 409);
      } else if (bindings.propertyFingerprint) {
        const actual = await pageProperties(pageId, bindings.propertyIds ?? []);
        if (actual !== bindings.propertyFingerprint) throw new ContentConflict("$properties", "Trade properties", actual);
      }
      if (!progress.propertiesDone) {
        const changed = Object.fromEntries(ids.filter(key => jsonHash(propertyValue(values[key])) !== jsonHash(propertyValue(plan.properties[key]))).map(key => [key, plan.properties[key]]));
        progress.propertyBase = current; progress.propertyIntent = true; await checkpoint();
        try { if (Object.keys(changed).length) await write(`/pages/${pageId}`, "PATCH", { properties: changed }); }
        catch (e) { if (e instanceof NotionError && !e.uncertain) { progress.propertyIntent = false; await checkpoint(); } throw e; }
        progress.newPropertyFingerprint = await pageProperties(pageId, ids);
        if (progress.newPropertyFingerprint !== expected) throw new NotionError("The written properties differ from the preview. Review Notion before finalizing this publication.", 409);
        progress.propertiesDone = true; progress.propertyIntent = false; await checkpoint();
      }
    } else if (await pageProperties(pageId, Object.keys(plan.properties)) !== progress.newPropertyFingerprint) {
      throw new NotionError("The published properties changed before completion. Review Notion before resuming.", 409);
    }
    const nextBindings: Bindings = { presentationVersion: planPresentation(plan), sections: { ...bindings.sections }, propertyIds: Object.keys(plan.properties), propertyFingerprint: progress.newPropertyFingerprint,
      propertyFingerprints: Object.fromEntries(Object.entries(plan.properties).map(([id, property]) => [id, jsonHash(propertyValue(property))])) };
    for (const section of plan.sections) { const done = progress.sections[section.key]; nextBindings.sections![section.key] = { anchor: progress.anchors[section.key], contentHash: done.contentHash, ...(done.container ? { container: done.container, fingerprint: done.fingerprint! } : {}), ...(done.plain ? { plain: done.plain.binding! } : {}) }; }
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "groupKey" FROM "NotionPublication" WHERE "groupKey" = ${groupKey} FOR UPDATE`;
      const reviewCompletion = await completePublishedReview(tx, groupKey, job!.revision, snapshot.digest);
      const saved = await tx.notionPublishJob.updateMany({ where: { id, leaseToken: lease, leaseUntil: { gt: new Date() } }, data: { progress: asJson({ ...progress, reviewCompletion }), state: "succeeded", error: null,
        snapshot: asJson({ ...snapshot, assets: snapshot.assets.map(asset => ({ ...asset, image: "" })) }),
      } });
      if (!saved.count) throw new NotionError("Publishing lease expired before completion.", 409);
      await tx.notionPublication.update({ where: { groupKey }, data: { bindings: asJson(nextBindings), lastRevision: job!.revision, templateId: job!.templateId, activeJobId: null } });
    });
    return publicationStatus(await prisma.notionPublishJob.findUniqueOrThrow({ where: { id } }));
  } catch (error) {
    if (job) {
      const known = error instanceof NotionError || error instanceof WorkstationError;
      const wait = currentProgress?.templateWait;
      const retryable = error instanceof NotionError && (error.status === 429 || error.status === 503 || error.reason === "transient");
      const templateWaiting = retryable && wait && !currentProgress?.anchors;
      const cooldownExceedsWindow = templateWaiting && error.retryAt && templateWaitExpired(wait, error.retryAt.getTime());
      if (templateWaiting) wait.timedOut = templateWaitExpired(wait) || !!cooldownExceedsWindow;
      const timedOut = templateWaiting && wait.timedOut;
      if (currentProgress) {
        if (error instanceof NotionError && error.uncertain && (currentProgress.propertyIntent || currentProgress.propertiesDone)) currentProgress.finalIndex = 0;
        if (error instanceof NotionError && (error.providerCode || error.providerRequestId)) currentProgress.provider = { code: error.providerCode, requestId: error.providerRequestId };
        if (error instanceof ContentConflict) {
          delete currentProgress.verification;
          delete currentProgress.overwriteAcknowledgement;
          const other = (currentProgress.conflicts ?? []).filter(conflict => conflict.key !== error.key);
          currentProgress.conflicts = [...other, { key: error.key, label: error.label, fingerprint: error.fingerprint }];
        }
        const ordinary = error instanceof NotionError && error.reason === "budget";
        const advanced = progressDigest(currentProgress) !== initialDigest;
        currentProgress.failures = ordinary || advanced ? 0 : (currentProgress.failures ?? 0) + (retryable ? 1 : 0);
        currentProgress.retryReason = error instanceof NotionError ? error.reason ?? (retryable ? "transient" : undefined) : undefined;
      }
      const waiting = retryable && !timedOut && (currentProgress?.failures ?? 0) < 5;
      const retryAt = waiting ? error instanceof NotionError && error.retryAt || new Date(Date.now() + Math.min(30_000, 1000 * 2 ** (currentProgress?.failures ?? 0)) + Math.floor(Math.random() * 250)) : error instanceof NotionError ? error.retryAt ?? null : null;
      await prisma.notionPublishJob.updateMany({ where: { id, leaseToken: lease }, data: {
        progress: asJson(currentProgress),
        state: waiting ? "waiting" : known && error.status === 409 && !retryable ? "conflict" : "failed",
        error: waiting ? null : timedOut ? templateTimeoutMessage : retryable ? "Automatic retries paused after repeated interruptions. Saved progress is retained; Resume to try again." : known ? error.message : "Publishing failed. Progress is retained; inspect and resume.",
        retryAt,
      } });
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
  const bytes = asset.asset ? (await (await import("./evidence-assets")).readOriginalAsset(asset.asset.id)).bytes : Buffer.from(asset.image.split(",")[1], "base64"), form = new FormData();
  if (jsonHash(bytes.toString("base64")) !== asset.hash) throw new NotionError("Original image checksum does not match this frozen publication. No substituted image was uploaded.", 409);
  form.append("file", new Blob([bytes], { type: "image/png" }), `${asset.hash}.png`);
  await write(`/file_uploads/${row.uploadId}/send`, "POST", form);
  await prisma.notionUpload.update({ where: { id }, data: { status: "uploaded" } });
  return row.uploadId!;
}
