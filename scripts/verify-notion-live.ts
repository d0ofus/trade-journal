/** Explicit, opt-in live Notion validation. Never uses the production app DB. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { assertTestDatabaseSafety } from "../src/lib/test-database-safety";
import { inspectBatchTimestamps, confirmBatchTimestamps } from "../src/lib/server/execution-time-interpretation";
import { readWorkstationDocument, saveWorkstationDocument } from "../src/lib/server/trade-workstation";
import { readTemplateLayout } from "../src/lib/server/notion-template-sync";
import { createNotionPreview, publicationStatus, type PublishPlan } from "../src/lib/server/notion-publication-plan";
import { startNotionPublication, resumeNotionPublication, propertyValue } from "../src/lib/server/notion-publisher";
import { notionChildren, notionRequest, jsonHash, remoteText, withNotionBudget, type JsonObject } from "../src/lib/server/notion-client";
import { NOTION_DATA_SOURCE_ID, setSectionText } from "../src/lib/workstation/template-layout";
import { notionProperties, type NotionValue } from "../src/lib/workstation/notion-template";
import { attachEvidence, assignSectionEvidence } from "../src/lib/workstation/evidence";
import { workstationDocumentSchema } from "../src/lib/workstation/schema";
import type { RemoteProperty } from "../src/lib/server/notion-properties";

const groupKey = "NOTION-LIVE-VALIDATION-20260921", symbol = "NOTIONTEST";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const report = (value: unknown) => console.log(JSON.stringify(value));
async function seed() {
  if (await prisma.closedTrade.findUnique({ where: { groupKey } })) return;
  await prisma.$transaction(async tx => {
    const account = await tx.account.create({ data: { ibkrAccount: groupKey, name: "Synthetic live Notion test only", baseCurrency: "USD" } });
    const instrument = await tx.instrument.create({ data: { symbol, exchange: "SYNTHETIC", assetType: "STOCK", currency: "USD" } });
    const csv = `Account,Symbol,Side,Quantity,Price,DateTime\n${groupKey},${symbol},BUY,10,100,2026-09-10T14:00:00Z\n${groupKey},${symbol},SELL,10,110,2026-09-10T15:00:00Z\n`;
    const artifact = await tx.importArtifact.create({ data: { storageKey: groupKey, content: csv, rawSha256: sha(csv), rawBytes: Buffer.byteLength(csv) } });
    const batch = await tx.importBatch.create({ data: { id: groupKey, accountId: account.id, filename: "synthetic-notion-validation.csv", fileType: "executions", sourceSection: "trades", parserVersion: "synthetic-notion-validation", rawStorageKey: artifact.storageKey, rawSha256: artifact.rawSha256, status: "SUCCEEDED" } });
    const open = new Date("2026-09-10T14:00:00Z"), close = new Date("2026-09-10T15:00:00Z");
    await tx.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol, direction: "LONG", openTime: open, closeTime: close, tradeDate: new Date("2026-09-10"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 100, totalCommission: 0 } });
    for (const [index, side, time, price] of [[0, "BUY", open, 100], [1, "SELL", close, 110]] as const) {
      const execution = await tx.execution.create({ data: { dedupeKey: `${groupKey}-${index}`, accountId: account.id, instrumentId: instrument.id, importBatchId: batch.id, executedAt: time, side, quantity: 10, price, currency: "USD" } });
      await tx.closedTradeExecution.create({ data: { closedTradeGroupKey: groupKey, executionId: execution.id, executedAt: time, side, quantity: 10, price, commission: 0, fees: 0, sortOrder: index } });
    }
    await tx.closedTradeNote.create({ data: { groupKey, content: "Synthetic legacy note: retained locally, intentionally not published.", mistake: "Synthetic legacy improvement: retained locally." } });
  });
}
async function png(label: string, color: string) {
  const svg = `<svg width="960" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="480" fill="#111827"/><text x="40" y="65" font-family="Arial" font-size="32" fill="#ffffff">NOTION TEST - SYNTHETIC EVIDENCE</text><text x="40" y="112" font-family="Arial" font-size="24" fill="${color}">${label}</text><path d="M45 385 L170 345 L265 370 L360 280 L480 300 L580 220 L670 250 L780 170 L910 150" fill="none" stroke="${color}" stroke-width="8"/><text x="40" y="450" font-family="Arial" font-size="20" fill="#cbd5e1">Placement and image-reuse test only. Not real market data.</text></svg>`;
  return `data:image/png;base64,${(await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64")}`;
}
async function prepare() {
  await seed();
  const inspected = await inspectBatchTimestamps(groupKey, "UTC");
  assert(inspected.rows.every(row => row.interpretedTime !== null), "Synthetic timestamps must resolve.");
  if (!inspected.active) await confirmBatchTimestamps(groupKey, { timezone: "UTC", expectedRevision: inspected.revision, fingerprint: inspected.fingerprint });
  let doc = await readWorkstationDocument(groupKey);
  if (!doc.review.notion?.layout) {
    const { layout, warning } = await readTemplateLayout(true);
    assert(!warning && layout.id !== "builtin", warning ?? "Live template unavailable");
    const schema = await notionRequest<{ properties: Record<string, RemoteProperty> }>(`/data_sources/${NOTION_DATA_SOURCE_ID}`);
    for (const section of layout.sections) doc.review = setSectionText(doc.review, section.key,
      `<p><strong>SYNTHETIC TEST — ${section.label}</strong></p><p>Destination key: <em>${section.key}</em>. This is test content, not an actual trade review.</p><ul><li>Bold, italic and <u>underlined</u> formatting check.</li><li>Evidence below must belong to this section.</li></ul>`);
    doc.review.notion!.layout = layout;
    doc.review.notion!.properties = { plannedEntry: 100, plannedStop: 95 };
    for (const field of notionProperties) {
      const property = schema.properties[field.label]; let value: NotionValue | undefined;
      if (field.kind === "relation") {
        assert(property?.relation?.data_source_id, `Missing relation: ${field.label}`);
        const pages = await notionRequest<{ results: { properties: Record<string, { type: string; title?: { plain_text: string }[] }> }[] }>(`/data_sources/${property.relation.data_source_id}/query`, "POST", { page_size: 100 });
        const names = pages.results.map(page => Object.values(page.properties).find(p => p.type === "title")?.title?.map(p => p.plain_text).join("").trim()).filter((name): name is string => !!name);
        const name = names.find(name => names.filter(other => other.toLowerCase() === name.toLowerCase()).length === 1);
        assert(name, `No unambiguous existing option for ${field.label}`); value = [name];
      } else if (field.kind === "checkbox") value = true;
      else if (field.kind === "number") value = 1.25;
      else if (field.kind === "text") value = "Synthetic validation only";
      else if (field.kind === "multi") value = property?.multi_select?.options.slice(0, 1).map(option => option.name) ?? [];
      else if (field.kind === "select") value = property?.select?.options[0]?.name ?? "";
      if (value !== undefined) doc.review.notion!.properties[field.key] = value;
    }
    doc = attachEvidence(doc, { id: "synthetic-shared-image", name: "Synthetic shared evidence A", image: await png("A: SAME ASSET REUSED IN ALL ACTIVE SECTIONS", "#22c55e"), time: Date.now() / 1000, revision: doc.revision, timeframe: "5m" }, layout.sections[0].key, layout);
    for (const section of layout.sections.slice(1)) doc.review.notion = assignSectionEvidence(doc.review.notion!, section.key, "synthetic-shared-image", true);
    doc = attachEvidence(doc, { id: "synthetic-imported-image", name: "Synthetic imported evidence B", image: await png("B: IMPORTED IMAGE - FUNDAMENTALS ONLY", "#38bdf8"), origin: "upload", time: Date.now() / 1000, revision: doc.revision, timeframe: "" }, "fundamentals", layout);
    doc.evidence.push({ id: "synthetic-unassigned", name: "Unassigned evidence - must stay in app", image: await png("UNASSIGNED: MUST NOT APPEAR IN NOTION", "#f97316"), origin: "clipboard", time: Date.now() / 1000, revision: doc.revision, timeframe: "" });
    doc = await saveWorkstationDocument(groupKey, workstationDocumentSchema.parse(doc), doc.revision);
  }
  const preview = await withNotionBudget(() => createNotionPreview(groupKey, doc.revision, "http://127.0.0.1:3101"));
  report({ action: "prepared", id: preview.id, state: preview.state, revision: preview.revision, errors: preview.errors, sections: preview.sections.map(s => ({ label: s.label, images: s.images })), properties: preview.properties, omitted: preview.omitted });
  assert.equal(preview.errors.length, 0, "Resolve preview errors before any live write.");
}
async function latest() {
  const publication = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey } });
  return publication.activeJobId ? prisma.notionPublishJob.findUniqueOrThrow({ where: { id: publication.activeJobId } }) : prisma.notionPublishJob.findFirstOrThrow({ where: { groupKey }, orderBy: { createdAt: "desc" } });
}
async function step() {
  const job = await latest();
  const before = jsonHash(await readWorkstationDocument(groupKey));
  if (job.state === "preview") await withNotionBudget(() => startNotionPublication(job.id, groupKey));
  const result = await resumeNotionPublication(job.id, groupKey);
  assert.equal(jsonHash(await readWorkstationDocument(groupKey)), before, "Publishing must not change the saved review.");
  report({ id: result.id, state: result.state, pageUrl: result.pageUrl, error: result.error, retryAt: result.retryAt, complete: result.sections.filter(s => s.done).length, total: result.sections.length });
  assert(["waiting", "succeeded"].includes(result.state), result.error ?? "Publication paused; inspect before explicitly resuming.");
}
async function verify() {
  const job = await latest(), publication = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey } });
  assert.equal(job.state, "succeeded"); assert(publication.pageId);
  const plan = job.plan as unknown as PublishPlan;
  const page = await notionRequest<{ properties: Record<string, JsonObject> }>(`/pages/${publication.pageId}`);
  const byId = new Map(Object.values(page.properties).map(p => [String(p.id), p]));
  for (const [id, value] of Object.entries(plan.properties)) assert.equal(jsonHash(propertyValue(byId.get(id)!)), jsonHash(propertyValue(value)), `Property mismatch: ${id}`);
  const title = (plan.properties[plan.titleId].title as { text: { content: string } }[]).map(p => p.text.content).join("");
  const matches = await notionRequest<{ results: { id: string }[]; has_more: boolean }>(`/data_sources/${NOTION_DATA_SOURCE_ID}/query`, "POST", { filter: { property: plan.titleId, title: { equals: title } }, page_size: 2 });
  assert.equal(matches.results.length, 1, "The synthetic review must have exactly one Notion page."); assert.equal(matches.results[0].id, publication.pageId); assert.equal(matches.has_more, false);
  const bindings = publication.bindings as unknown as { sections: Record<string, { container: string; anchor: { id: string; parent: string; type: string } }> };
  let images = 0;
  const doc = await readWorkstationDocument(groupKey), verifiedAssets = new Set<string>(), managedContainers = new Set<string>();
  for (const section of plan.sections) {
    const binding = bindings.sections[section.key]; assert(binding);
    const siblings = await notionChildren(binding.anchor.type === "toggle" ? binding.anchor.id : binding.anchor.parent);
    for (const block of siblings) {
      const links = (block.callout as { rich_text?: { text?: { link?: { url?: string } } }[] } | undefined)?.rich_text ?? [];
      if (links.some(part => part.text?.link?.url?.startsWith(`${plan.sourceUrl}#notion-`))) managedContainers.add(block.id);
    }
    assert(siblings.some(b => b.id === binding.container), `Wrong parent for ${section.key}`);
    if (binding.anchor.type !== "toggle") assert.equal(siblings.findIndex(b => b.id === binding.container), siblings.findIndex(b => b.id === binding.anchor.id) + 1, `Wrong placement for ${section.key}`);
    const blocks = await notionChildren(binding.container);
    const imageBlocks = blocks.filter(block => block.type === "image");
    assert.equal(imageBlocks.length, section.images.length); images += imageBlocks.length;
    assert(blocks.some(b => remoteText(b).includes(`Destination key: ${section.key}`)), `Missing text for ${section.key}`);
    if (section.key === "takeaways" && doc.review.takeaway.includes("UPDATE VERIFIED")) assert(blocks.some(b => remoteText(b).includes("UPDATE VERIFIED")), "Updated Takeaways must reach the same page.");
    for (const image of imageBlocks) {
      const caption = (image.image as { caption: { plain_text: string }[] }).caption.map(p => p.plain_text).join("");
      assert(!caption.includes("Unassigned"));
      assert(caption.includes("Synthetic"));
      const asset = doc.evidence.find(e => caption.startsWith(e.name)); assert(asset);
      if (!verifiedAssets.has(asset.id)) {
        const fileUrl = (image.image as { file: { url: string } }).file.url;
        assert.equal(new URL(fileUrl).protocol, "https:");
        const response = await fetch(fileUrl, { signal: AbortSignal.timeout(15_000) }); assert(response.ok, "Uploaded evidence must be downloadable.");
        assert.equal(Buffer.from(await response.arrayBuffer()).toString("base64"), asset.image.split(",")[1], "Uploaded PNG bytes must remain unchanged.");
        verifiedAssets.add(asset.id);
      }
    }
  }
  assert.equal(await prisma.notionPublication.count(), 1);
  assert.equal(managedContainers.size, plan.sections.length, "Updates must not leave duplicate active section containers.");
  assert.equal(await prisma.notionUpload.count(), 2, "Shared evidence must reuse two uploads.");
  assert.equal(doc.evidence.length, 3); assert(doc.review.notes.includes("Synthetic legacy note"));
  report({ action: "verified", pageUrl: publicationStatus(job).pageUrl, revision: job.revision, properties: Object.keys(plan.properties).length, sections: plan.sections.length, activeSectionContainers: managedContainers.size, images, uniqueUploads: 2, verifiedImageFiles: verifiedAssets.size, uniqueRemotePage: true, unassignedImagePreservedLocally: true, legacyNotesPreservedLocally: true });
}
async function update() {
  const job = await latest(); assert.equal(job.state, "succeeded", "Finish the first publish before testing an update.");
  let doc = await readWorkstationDocument(groupKey);
  if (!doc.review.takeaway.includes("UPDATE VERIFIED")) {
    doc.review.takeaway += "<p><strong>UPDATE VERIFIED:</strong> This sentence was added by publishing a second saved revision to the same Notion page.</p>";
    doc = await saveWorkstationDocument(groupKey, workstationDocumentSchema.parse(doc), doc.revision);
  }
  const preview = await withNotionBudget(() => createNotionPreview(groupKey, doc.revision, "http://127.0.0.1:3101"));
  report({ action: "update-preview", id: preview.id, revision: preview.revision, errors: preview.errors });
  assert.equal(preview.errors.length, 0);
}
async function inspect() {
  const job = await latest(); report(publicationStatus(job));
  const publication = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey } });
  if (!publication.pageId) return;
  const tree: { id: string; type: string; text: string; parent: string }[] = [];
  async function walk(parent: string) { for (const block of await notionChildren(parent)) { tree.push({ id: block.id, type: block.type, text: remoteText(block), parent }); if (block.has_children) await walk(block.id); } }
  await walk(publication.pageId); report({ tree });
}
async function main() {
  const target = assertTestDatabaseSafety(process.env);
  assert.equal(target.databaseUrl.host, "127.0.0.1:15439"); assert.equal(target.databaseUrl.database, "trade_journal_notion_live_test");
  const action = process.argv[2];
  assert(["prepare", "step", "verify", "update", "inspect"].includes(action), "Choose prepare, step, verify, update or inspect.");
  if (action === "step") { assert.equal(process.env.ALLOW_LIVE_NOTION_TEST, "1", "Explicit live test approval is required."); assert.equal(process.env.NOTION_PUBLISH_ENABLED, "1"); }
  if (action === "prepare") await prepare(); else if (action === "step") await step(); else if (action === "verify") await verify(); else if (action === "update") await update(); else await inspect();
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live validation failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
