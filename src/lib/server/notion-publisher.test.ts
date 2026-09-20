import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { initialSectionIds, NOTION_DATA_SOURCE_ID, NOTION_TEMPLATE_ID, type TemplateBlock } from "@/lib/workstation/template-layout";
import { jsonHash, NotionError, remoteText, type JsonObject, type RemoteBlock } from "./notion-client";
import { readTemplateLayout } from "./notion-template-sync";
import { readWorkstationDocument } from "./trade-workstation";
import { resumeNotionPublication, startNotionPublication } from "./notion-publisher";
import { propertySchemaSignature, type RemoteProperty } from "./notion-properties";
import type { PublishPlan, PublishSnapshot } from "./notion-publication-plan";

const remote = vi.hoisted(() => ({ call: vi.fn(), children: vi.fn(), tree: vi.fn() }));
vi.mock("./notion-client", async original => ({ ...await original<typeof import("./notion-client")>(), notionRequest: remote.call, notionChildren: remote.children, notionTree: remote.tree }));
const fixtures: { groupKey: string; accountId: string; instrumentId: string }[] = [];
const nodes = new Map<string, RemoteBlock>(), children = new Map<string, string[]>(), pages = new Map<string, JsonObject>(), uploads = new Map<string, string>();
let failAfter: ((path: string, method: string, body: JsonObject) => boolean) | null = null;
let titleProperty: RemoteProperty, schema: Record<string, RemoteProperty>, source: TemplateBlock[];
const copy = <T>(value: T): T => structuredClone(value);
const bodyObject = (value: unknown) => value as JsonObject;
function readChildren(id: string) { return (children.get(id) ?? []).flatMap(id => { const block = nodes.get(id)!; return block.archived ? [] : [{ ...block, has_children: (children.get(id)?.length ?? 0) > 0 }]; }); }
function add(parent: string, input: JsonObject, after?: string) {
  const id = randomUUID(), type = String(input.type), data = copy(input[type]) as JsonObject;
  if (type === "image") { const uploadId = (data.file_upload as { id: string }).id; delete data.file_upload; data.type = "file"; data.file = { url: `https://notion.invalid/${uploadId}/image.png?v=changing` }; }
  nodes.set(id, { id, type, [type]: data, archived: false });
  const list = children.get(parent) ?? [], index = after ? list.indexOf(after) + 1 : list.length; list.splice(index, 0, id); children.set(parent, list);
  return nodes.get(id)!;
}
beforeEach(async () => {
  vi.stubEnv("NOTION_TOKEN", "local-mocked-notion-connection"); vi.stubEnv("NOTION_PUBLISH_ENABLED", "1"); vi.stubEnv("E2E_DEMO_ONLY_WRITES", "0");
  nodes.clear(); children.clear(); pages.clear(); uploads.clear(); remote.call.mockReset(); remote.children.mockReset(); remote.tree.mockReset(); failAfter = null;
  await prisma.notionTemplateDefinition.deleteMany();
  await prisma.notionRequestGate.deleteMany();
  source = ["entry", "exit"].map(key => ({ id: initialSectionIds[key], type: "heading_2", text: key === "entry" ? "Entry Screen" : "Exit Screen", children: [] }));
  titleProperty = { id: "title", name: "Trade", type: "title" };
  schema = { Trade: titleProperty, Entry: { id: "entry-price", name: "Entry", type: "number" } };
  remote.children.mockImplementation(async (id: string) => copy(readChildren(id)));
  remote.tree.mockImplementation(async (id: string) => {
    if (id === NOTION_TEMPLATE_ID) return copy(source);
    const tree = (parent: string): TemplateBlock[] => readChildren(parent).map(block => ({ id: block.id, type: block.type, text: remoteText(block), children: tree(block.id) }));
    return tree(id);
  });
  remote.call.mockImplementation(async (path: string, method = "GET", value?: unknown) => {
    const body = bodyObject(value), url = new URL(`https://notion.invalid${path}`), parts = url.pathname.split("/").filter(Boolean);
    let result: unknown;
    if (parts[0] === "users") result = { id: "test-bot" };
    else if (parts[0] === "data_sources" && parts[2] === "query") {
      const filter = body.filter as { title: { equals: string } };
      result = { results: [...pages.values()].filter(page => JSON.stringify(page.properties).includes(filter.title.equals)).map(page => ({ id: page.id, created_by: { id: "test-bot" } })), has_more: false };
    } else if (parts[0] === "data_sources") result = { properties: schema };
    else if (parts[0] === "pages" && method === "POST") {
      const id = randomUUID(), props = body.properties as Record<string, JsonObject>;
      const properties = Object.fromEntries(Object.values(schema).map(p => [p.name, { id: p.id, type: p.type, [p.type]: props[p.id]?.[p.type] ?? (p.type === "title" ? [] : null) }]));
      pages.set(id, { id, properties, created_by: { id: "test-bot" }, parent: { data_source_id: NOTION_DATA_SOURCE_ID } });
      source.forEach(block => add(id, { type: block.type, [block.type]: { rich_text: [{ type: "text", text: { content: block.text } }] } }));
      result = pages.get(id);
    } else if (parts[0] === "pages") {
      const page = pages.get(parts[1])!;
      if (method === "PATCH") {
        const properties = page.properties as Record<string, JsonObject>;
        for (const [id, property] of Object.entries(body.properties as Record<string, JsonObject>)) {
          const key = Object.keys(properties).find(key => properties[key].id === id)!;
          properties[key] = { id, type: Object.keys(property)[0], ...property };
        }
      }
      result = page;
    } else if (parts[0] === "blocks" && parts[2] === "children" && method === "PATCH") {
      const after = (body.position as { after_block?: { id: string } } | undefined)?.after_block?.id;
      const created = (body.children as JsonObject[]).map(input => add(parts[1], input, after)); result = { results: created, has_more: false };
    } else if (parts[0] === "blocks") {
      const node = nodes.get(parts[1])!;
      if (!node) throw new NotionError("Missing mock block", 404);
      if (method === "DELETE") node.archived = true;
      result = { ...node, has_children: readChildren(node.id).length > 0 };
    } else if (parts[0] === "file_uploads" && parts.length === 1) { const id = randomUUID(); uploads.set(id, "pending"); result = { id }; }
    else if (parts[0] === "file_uploads") { if (parts[2] === "send") uploads.set(parts[1], "uploaded"); result = { id: parts[1], status: uploads.get(parts[1]) }; }
    else throw new Error(`Unexpected mocked Notion operation ${method} ${path}`);
    if (failAfter?.(path, method, body)) { failAfter = null; throw new NotionError("Response lost after remote commit", 503, undefined, true); }
    return copy(result);
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) {
    await prisma.notionPublishJob.deleteMany({ where: { groupKey: fixture.groupKey } });
    await prisma.notionPublication.deleteMany({ where: { groupKey: fixture.groupKey } });
    await prisma.closedTradeNote.deleteMany({ where: { groupKey: fixture.groupKey } });
    await prisma.closedTrade.delete({ where: { groupKey: fixture.groupKey } });
    await prisma.instrument.delete({ where: { id: fixture.instrumentId } }); await prisma.account.delete({ where: { id: fixture.accountId } });
  }
  await prisma.notionUpload.deleteMany(); await prisma.notionTemplateDefinition.deleteMany();
});
async function fixture(images = false) {
  const groupKey = `notion-test-${randomUUID()}`;
  const account = await prisma.account.create({ data: { ibkrAccount: groupKey, name: "Isolated Notion test", baseCurrency: "USD" } });
  const instrument = await prisma.instrument.create({ data: { symbol: "NTST", exchange: groupKey, assetType: "STOCK", currency: "USD" } });
  fixtures.push({ groupKey, accountId: account.id, instrumentId: instrument.id });
  await prisma.closedTrade.create({ data: { groupKey, accountId: account.id, instrumentId: instrument.id, symbol: "NTST", direction: "LONG", openTime: new Date("2026-01-02T15:00:00Z"), closeTime: new Date("2026-01-02T16:00:00Z"), tradeDate: new Date("2026-01-02"), totalQuantity: 10, avgEntryPrice: 100, avgExitPrice: 110, grossRealizedPnl: 100, openingQuantity: 10, closingQuantity: 10, realizedPnl: 100, totalCommission: 0 } });
  await prisma.closedTradeNote.create({ data: { groupKey, content: "Legacy LPTH-like note", mistake: "Preserve SHLS/TATT-like improvement" } });
  const doc = await readWorkstationDocument(groupKey), { layout } = await readTemplateLayout(true);
  const plan: PublishPlan = { layout, schemaHash: jsonHash(propertySchemaSignature(Object.values(schema))), titleId: titleProperty.id, sourceUrl: `https://journal.invalid/trades?groupKey=${groupKey}`, properties: { title: { title: [{ type: "text", text: { content: "NTST review" } }] }, "entry-price": { number: 100 } }, propertyDisplay: [], sections: layout.sections.map(section => ({ ...section, blocks: [{ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: `Saved ${section.key}` } }] } }], images: images ? ["image"] : [] })), omitted: ["Review details: notes", "Review details: mistake"], errors: [] };
  const snapshot: PublishSnapshot = { doc, digest: jsonHash(doc), symbol: "NTST", assets: images ? [{ id: "image", hash: "test-image-hash", caption: "Original screenshot context", image: "data:image/png;base64,aW1hZ2U=" }] : [] };
  await prisma.notionPublication.create({ data: { groupKey, dataSourceId: NOTION_DATA_SOURCE_ID } });
  const job = await prisma.notionPublishJob.create({ data: { groupKey, requestKey: randomUUID(), revision: doc.revision, templateId: layout.id, plan: plan as unknown as Prisma.InputJsonValue, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
  return { job, plan, doc, groupKey };
}
async function finish(id: string, groupKey: string) {
  let result = await resumeNotionPublication(id, groupKey);
  for (let i = 0; i < 20 && result.state === "waiting"; i++) result = await resumeNotionPublication(id, groupKey);
  return result;
}
describe("durable Notion publishing against isolated PostgreSQL", () => {
  it("publishes one page, correct section parents, shared images once, and preserves local review", async () => {
    const f = await fixture(true); await startNotionPublication(f.job.id, f.groupKey);
    expect((await finish(f.job.id, f.groupKey)).state).toBe("succeeded");
    expect(pages.size).toBe(1); expect(uploads.size).toBe(1);
    expect([...nodes.values()].filter(n => n.type === "image")).toHaveLength(2);
    const record = await prisma.notionPublication.findUniqueOrThrow({ where: { groupKey: f.groupKey } });
    expect(record.lastRevision).toBe(f.doc.revision); expect(record.activeJobId).toBeNull();
    expect(await readWorkstationDocument(f.groupKey)).toEqual(f.doc);
    expect(remote.call.mock.calls.filter(([path, method]) => path.endsWith("/send") && method === "POST")).toHaveLength(1);
  });
  it("reconciles a lost page response without creating another page", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey);
    failAfter = (path, method) => path === "/pages" && method === "POST";
    expect((await resumeNotionPublication(f.job.id, f.groupKey)).state).toBe("failed");
    expect((await finish(f.job.id, f.groupKey)).state).toBe("succeeded"); expect(pages.size).toBe(1);
  });
  it("reconciles a lost section-container response without duplicate containers", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey); await resumeNotionPublication(f.job.id, f.groupKey);
    failAfter = (_path, method, body) => method === "PATCH" && (body.children as JsonObject[] | undefined)?.[0]?.type === "callout";
    expect((await resumeNotionPublication(f.job.id, f.groupKey)).state).toBe("failed");
    expect((await finish(f.job.id, f.groupKey)).state).toBe("succeeded"); expect([...nodes.values()].filter(n => n.type === "callout")).toHaveLength(2);
  });
  it("reconciles a lost content response without duplicate paragraphs or images", async () => {
    const f = await fixture(true); await startNotionPublication(f.job.id, f.groupKey); await resumeNotionPublication(f.job.id, f.groupKey);
    failAfter = (_path, method, body) => method === "PATCH" && (body.children as JsonObject[] | undefined)?.[0]?.type === "paragraph";
    expect((await resumeNotionPublication(f.job.id, f.groupKey)).state).toBe("failed");
    expect((await finish(f.job.id, f.groupKey)).state).toBe("succeeded"); expect([...nodes.values()].filter(n => n.type === "image")).toHaveLength(2);
  });
  it("reconciles a lost property-update response", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey);
    failAfter = (path, method) => path.startsWith("/pages/") && method === "PATCH";
    expect((await finish(f.job.id, f.groupKey)).state).toBe("failed");
    expect((await finish(f.job.id, f.groupKey)).state).toBe("succeeded");
  });
  it("blocks a changed saved revision before making remote writes", async () => {
    const f = await fixture(); await prisma.closedTradeNote.update({ where: { groupKey: f.groupKey }, data: { content: "A newer note" } });
    await expect(startNotionPublication(f.job.id, f.groupKey)).rejects.toThrow(/saved review changed/i);
    expect(pages.size).toBe(0);
  });
  it("blocks a changed schema and a disabled publisher", async () => {
    const f = await fixture(); schema.Entry.type = "rich_text";
    await expect(startNotionPublication(f.job.id, f.groupKey)).rejects.toThrow(/schema changed/);
    vi.stubEnv("NOTION_PUBLISH_ENABLED", "0"); await expect(startNotionPublication(f.job.id, f.groupKey)).rejects.toThrow(/disabled/);
  });
  it("pauses a trade that becomes stale", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey);
    await prisma.closedTrade.update({ where: { groupKey: f.groupKey }, data: { isStale: true } });
    expect((await resumeNotionPublication(f.job.id, f.groupKey)).state).toBe("conflict"); expect(pages.size).toBe(0);
  });
  it("prevents a second active job for the same trade", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey);
    const second = await prisma.notionPublishJob.create({ data: { groupKey: f.groupKey, requestKey: randomUUID(), revision: f.job.revision, templateId: f.job.templateId, plan: f.job.plan!, snapshot: f.job.snapshot! } });
    await expect(startNotionPublication(second.id, f.groupKey)).rejects.toThrow(/Another publication/);
  });
  it("retains a cooldown rather than retrying early", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey);
    await prisma.notionPublishJob.update({ where: { id: f.job.id }, data: { retryAt: new Date(Date.now() + 60_000), state: "failed" } });
    const before = remote.call.mock.calls.length;
    expect((await resumeNotionPublication(f.job.id, f.groupKey)).state).toBe("failed"); expect(remote.call.mock.calls).toHaveLength(before);
  });
  it("updates only app-owned containers and reuses uploaded images", async () => {
    const f = await fixture(true); await startNotionPublication(f.job.id, f.groupKey); await finish(f.job.id, f.groupKey);
    const pageId = [...pages.keys()][0]; const manual = add(pageId, { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Human-authored outside app content" } }] } });
    const update = await prisma.notionPublishJob.create({ data: { groupKey: f.groupKey, requestKey: randomUUID(), revision: f.job.revision, templateId: f.job.templateId, plan: f.job.plan!, snapshot: f.job.snapshot! } });
    await startNotionPublication(update.id, f.groupKey); expect((await finish(update.id, f.groupKey)).state).toBe("succeeded");
    expect(pages.size).toBe(1); expect(uploads.size).toBe(1); expect(nodes.get(manual.id)?.archived).toBe(false);
    expect([...nodes.values()].filter(n => n.type === "callout" && !n.archived)).toHaveLength(2);
  });
  it("detects edits to previously published app-managed content without overwriting it", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey); await finish(f.job.id, f.groupKey);
    const paragraph = [...nodes.values()].find(n => n.type === "paragraph")!;
    paragraph.paragraph = { rich_text: [{ type: "text", text: { content: "Edited in Notion" } }] };
    const update = await prisma.notionPublishJob.create({ data: { groupKey: f.groupKey, requestKey: randomUUID(), revision: f.job.revision, templateId: f.job.templateId, plan: f.job.plan!, snapshot: f.job.snapshot! } });
    await startNotionPublication(update.id, f.groupKey); const result = await finish(update.id, f.groupKey);
    expect(result.state).toBe("conflict"); expect(result.error).toMatch(/content was edited/); expect(remoteText(nodes.get(paragraph.id)!)).toBe("Edited in Notion");
  });
  it("refuses to adopt a manually created page even if a saved binding points at it", async () => {
    const f = await fixture(); await startNotionPublication(f.job.id, f.groupKey); await resumeNotionPublication(f.job.id, f.groupKey);
    const page = [...pages.values()][0]; page.created_by = { id: "human" };
    const result = await resumeNotionPublication(f.job.id, f.groupKey);
    expect(result.state).toBe("conflict"); expect(result.error).toMatch(/not be adopted/); expect([...nodes.values()].filter(n => n.type === "callout")).toHaveLength(0);
  });
});
