import { IMAGE_MAX_BYTES } from "@/lib/workstation/image-assets";
import { jsonHash, NotionError, notionChildren, notionRequest, type JsonObject, type RemoteBlock } from "./notion-client";
import { managedBlockValue } from "./notion-format";

export type SectionAnchor = { id: string; parent: string; sourceId: string; type: string };
type Position = { parent: string; after: string | null; before: string | null };
export type PlainBinding = Position & { blocks: { id: string; fingerprint: string }[] };
type WrittenNode = { id: string; value: string; children: WrittenNode[] };
type AppendIntent = Position & { priorIds: string[]; expected: JsonObject[]; imageHashes: (string | null)[] };
export type PlainProgress = Position & {
  nodes: WrittenNode[];
  pending?: AppendIntent;
  removalIntents: string[];
  ready?: boolean;
  binding?: PlainBinding;
};
function conflict(message: string): never { throw new NotionError(message, 409); }
const imageUrl = (block: RemoteBlock) => {
  const data = block.image as { file?: { url?: string }; external?: { url?: string } } | undefined;
  return data?.file?.url ?? data?.external?.url;
};
const blockValue = (block: RemoteBlock) => ({ value: managedBlockValue(block), image: imageUrl(block) ? new URL(imageUrl(block)!).pathname : undefined });

/** Include descendants, order and file identity, excluding expiring URL signatures. */
export async function fingerprint(id: string): Promise<string> {
  let count = 0;
  async function value(block: RemoteBlock): Promise<unknown> {
    if (++count > 1500) throw new NotionError("The managed Notion section is too large to verify safely.", 409);
    return { id: block.id, ...blockValue(block), children: block.has_children ? await Promise.all((await notionChildren(block.id)).map(value)) : [] };
  }
  const block = await notionRequest<RemoteBlock>(`/blocks/${id}`);
  if (block.archived || block.in_trash) conflict("App-managed Notion content was removed. Review this conflict before publishing.");
  return jsonHash(await value(block));
}

async function placement(position: Position, ids: string[], ignore: string[] = [], checkEnd = true) {
  const blocks = (await notionChildren(position.parent)).filter(b => !ignore.includes(b.id)), siblings = blocks.map(b => b.id);
  const start = position.after === null ? 0 : siblings.indexOf(position.after) + 1;
  if (position.after !== null && start === 0 || jsonHash(siblings.slice(start, start + ids.length)) !== jsonHash(ids) || checkEnd && (siblings[start + ids.length] ?? null) !== position.before)
    conflict("App-managed Notion blocks or their section boundaries were moved or changed. Review the conflict before publishing.");
  return blocks;
}

export async function verifyPlainBinding(binding: PlainBinding, ignore: string[] = []) {
  // Unrelated content after this owned range may change between publications.
  // The anchored start, owned IDs/order and complete subtrees must stay intact.
  const siblings = await placement(binding, binding.blocks.map(b => b.id), ignore, false);
  for (const block of binding.blocks) if (await plainFingerprint(block.id, siblings.find(b => b.id === block.id)) !== block.fingerprint)
    conflict("App-managed Notion section content was edited. Review the conflict before publishing.");
}

export async function verifyPlainAnchor(anchor: SectionAnchor) {
  const block = (await notionChildren(anchor.parent)).find(b => b.id === anchor.id);
  if (!block || block.type !== anchor.type) conflict("The Notion section anchor moved or was removed. Review the page layout.");
}

export async function createPlainProgress(anchor: SectionAnchor, old?: PlainBinding): Promise<PlainProgress> {
  if (old) {
    const siblings = await notionChildren(old.parent), last = old.blocks.at(-1)?.id ?? old.after;
    return { parent: old.parent, after: old.after, before: siblings[last === null ? 0 : siblings.findIndex(b => b.id === last) + 1]?.id ?? null, nodes: [], removalIntents: [] };
  }
  const parent = anchor.type === "toggle" ? anchor.id : anchor.parent;
  const anchorBlock = await notionRequest<RemoteBlock>(`/blocks/${anchor.id}`);
  if (anchorBlock.archived || anchorBlock.in_trash || anchorBlock.type !== anchor.type) conflict("The Notion section anchor changed. Review the page layout.");
  const siblings = await notionChildren(parent);
  const index = siblings.findIndex(b => b.id === anchor.id);
  if (anchor.type !== "toggle" && index < 0) conflict("The Notion section anchor moved. Review the page layout.");
  return { parent, after: anchor.type === "toggle" ? siblings.at(-1)?.id ?? null : anchor.id,
    before: anchor.type === "toggle" ? null : siblings[index + 1]?.id ?? null, nodes: [], removalIntents: [] };
}

// Lost image responses cannot be reconciled by an empty caption. Verify the
// exact uploaded bytes from Notion's hosted file, without sending credentials.
async function verifyRecoveredImage(block: RemoteBlock, expected: string) {
  const raw = (block.image as { type?: string; file?: { url?: string } })?.file?.url;
  if (!raw) conflict("An unconfirmed image cannot be identified safely. Review the Notion append.");
  const url = new URL(raw!);
  if (url.protocol !== "https:" || url.username || url.password || url.port || ![".amazonaws.com", ".notion-static.com", ".notion.so"].some(suffix => url.hostname.endsWith(suffix)))
    conflict("The unconfirmed image is not a supported Notion-hosted file. No duplicate image was sent.");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store" });
  if (!response.ok || !response.body) throw new NotionError("The unconfirmed image could not be verified. Resume when Notion file access recovers.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > IMAGE_MAX_BYTES) conflict("The unconfirmed image exceeds the original-image allowance.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  if (jsonHash(Buffer.concat(chunks).toString("base64")) !== expected) conflict("The unconfirmed image differs from the frozen evidence. Review the Notion content.");
}

const stripChildren = (block: JsonObject) => {
  const type = String(block.type), data = { ...block[type] as JsonObject }; delete data.children;
  return { ...block, [type]: data };
};
const written = (block: RemoteBlock): WrittenNode => ({ id: block.id, value: jsonHash(blockValue(block)), children: [] });
async function plainFingerprint(id: string, block?: RemoteBlock): Promise<string> {
  let count = 0;
  async function read(block: RemoteBlock, depth = 0): Promise<WrittenNode> {
    if (++count > 1500 || depth > 12) conflict("The published section exceeds the safe verification limit.");
    if (block.archived || block.in_trash) conflict("Published Notion content was removed.");
    return { ...written(block), children: block.has_children ? await Promise.all((await notionChildren(block.id)).map(child => read(child, depth + 1))) : [] };
  }
  return jsonHash(await read(block ?? await notionRequest<RemoteBlock>(`/blocks/${id}`)));
}
async function verifyNodes(parent: string, nodes: WrittenNode[], roots = false): Promise<void> {
  const actual = await notionChildren(parent);
  if (!roots && jsonHash(actual.map(b => b.id)) !== jsonHash(nodes.map(b => b.id))) conflict("An in-progress Notion list was edited. Resolve the conflict before resuming.");
  for (const node of nodes) {
    const block = actual.find(b => b.id === node.id);
    if (!block || jsonHash(blockValue(block)) !== node.value) conflict("In-progress Notion content was edited or removed. Resolve the conflict before resuming.");
    if (node.children.length || block.has_children) await verifyNodes(node.id, node.children);
  }
}

type Write = <T = JsonObject>(path: string, method: string, body?: unknown) => Promise<T>;
/** Durable ordinary blocks; no visible ownership marker is inserted in Notion. */
export async function publishPlainSection(state: PlainProgress, desired: JsonObject[], old: PlainBinding | undefined, botId: string,
  imageHashes: Map<string, string>, checkpoint: () => Promise<void>, write: Write): Promise<void> {
  const oldIds = old?.blocks.map(b => b.id) ?? [];
  const freshIds = () => state.nodes.map(b => b.id);
  async function reconcile(parent: string, nodes: WrittenNode[]) {
    const pending = state.pending!;
    if (pending.parent !== parent) return;
    const siblings = await notionChildren(parent), prior = new Set(pending.priorIds);
    if (jsonHash(siblings.filter(b => prior.has(b.id)).map(b => b.id)) !== jsonHash(pending.priorIds)) conflict("Notion content changed during an unconfirmed append. Review the section before resuming.");
    const added = siblings.filter(b => !prior.has(b.id));
    if (added.length !== pending.expected.length) conflict("A content append is unconfirmed or ambiguous. No duplicate text or images will be sent.");
    await placement(pending, added.map(b => b.id));
    for (let i = 0; i < added.length; i++) {
      const block = added[i], creator = block.created_by as { id?: string } | undefined;
      if (creator?.id !== botId || block.has_children || jsonHash(managedBlockValue(block)) !== jsonHash(managedBlockValue({ id: "", ...pending.expected[i] } as RemoteBlock)))
        conflict("Unconfirmed blocks do not match this connection's frozen append. Review the conflict.");
      if (pending.imageHashes[i]) await verifyRecoveredImage(block, pending.imageHashes[i]!);
    }
    nodes.push(...added.map(written)); delete state.pending; await checkpoint();
  }
  async function append(parent: string, nodes: WrittenNode[], blocks: JsonObject[], root = false, depth = 0): Promise<void> {
    if (depth > 12) throw new NotionError("This section's nesting exceeds the safe publishing limit.", 422);
    if (state.pending?.parent === parent) await reconcile(parent, nodes);
    // Verify nested appends at their own level, after reconciling any uncertain
    // request there. Otherwise a successfully committed child looks unowned.
    const actual = await notionChildren(parent);
    if (!root && jsonHash(actual.map(b => b.id)) !== jsonHash(nodes.map(b => b.id))) conflict("In-progress Notion list content was changed.");
    for (const node of nodes) {
      const block = actual.find(b => b.id === node.id);
      if (!block || jsonHash(blockValue(block)) !== node.value) conflict("An in-progress Notion block was edited or removed.");
    }
    while (nodes.length < blocks.length) {
      const expected = blocks.slice(nodes.length, nodes.length + 80).map(stripChildren);
      const siblings = await notionChildren(parent);
      const after = nodes.at(-1)?.id ?? (root ? oldIds.at(-1) ?? state.after : null);
      const before = root ? state.before : null;
      await placement({ parent, after, before }, []);
      state.pending = { parent, after, before, priorIds: siblings.map(b => b.id), expected,
        imageHashes: expected.map(b => b.type === "image" ? imageHashes.get(((b.image as JsonObject).file_upload as { id: string }).id) ?? null : null) };
      await checkpoint();
      let result: { results: RemoteBlock[] };
      try {
        result = await write(`/blocks/${parent}/children`, "PATCH", { children: expected, position: after ? { type: "after_block", after_block: { id: after } } : { type: "start" } });
      } catch (error) {
        if (error instanceof NotionError && !error.uncertain) { delete state.pending; await checkpoint(); }
        throw error;
      }
      if (result.results.length !== expected.length || result.results.some((b, i) => jsonHash(managedBlockValue(b)) !== jsonHash(managedBlockValue({ id: "", ...expected[i] } as RemoteBlock))))
        conflict("Notion did not confirm the expected block batch. Resume to reconcile its placement.");
      nodes.push(...result.results.map(written)); actual.push(...result.results); delete state.pending; await checkpoint();
    }
    for (let i = 0; i < blocks.length; i++) {
      const nested = (blocks[i][String(blocks[i].type)] as { children?: JsonObject[] }).children ?? [];
      if (nested.length || nodes[i].children.length || actual.find(b => b.id === nodes[i].id)?.has_children)
        await append(nodes[i].id, nodes[i].children, nested, false, depth + 1);
    }
  }
  if (state.pending) {
    const find = (nodes: WrittenNode[], parent: string): WrittenNode[] | undefined => {
      for (const node of nodes) { if (node.id === parent) return node.children; const nested = find(node.children, parent); if (nested) return nested; }
    };
    const nodes = state.pending.parent === state.parent ? state.nodes : find(state.nodes, state.pending.parent);
    if (!nodes) conflict("The pending Notion append has no saved parent. Review the publication.");
    await reconcile(state.pending.parent, nodes!);
  }
  if (!state.ready) {
    if (old) await verifyPlainBinding(old, freshIds());
    await append(state.parent, state.nodes, desired, true);
    await placement(state, freshIds(), oldIds);
    await verifyNodes(state.parent, state.nodes, true);
    state.ready = true; await checkpoint();
  }
  // Every retry verifies the replacement and remaining originals before cleanup.
  await placement(state, freshIds(), oldIds);
  await verifyNodes(state.parent, state.nodes, true);
  const liveOld: string[] = [];
  const siblings = oldIds.length ? await notionChildren(state.parent) : [];
  for (const block of old?.blocks ?? []) {
    const actual = siblings.find(b => b.id === block.id) ?? await notionRequest<RemoteBlock>(`/blocks/${block.id}`);
    if (actual.archived || actual.in_trash) {
      if (!state.removalIntents.includes(block.id)) conflict("Published Notion content was removed outside this job.");
    } else {
      if (await plainFingerprint(block.id, actual) !== block.fingerprint) conflict("Previous Notion content was edited. Both versions are preserved for review.");
      liveOld.push(block.id);
    }
  }
  if (old) await placement({ ...old, before: state.before }, liveOld, freshIds());
  for (const id of liveOld) {
    if (!state.removalIntents.includes(id)) { state.removalIntents.push(id); await checkpoint(); }
    await write(`/blocks/${id}`, "DELETE");
  }
  state.binding = { parent: state.parent, after: state.after, before: state.before,
    blocks: state.nodes.map(node => ({ id: node.id, fingerprint: jsonHash(node) })) };
  await verifyPlainCompletion(state);
  await checkpoint();
}

export async function verifyPlainCompletion(state: PlainProgress) {
  if (!state.binding) conflict("Plain-content publication has not completed its block tracking.");
  await verifyPlainBinding(state.binding!);
  for (const id of state.removalIntents) {
    const block = await notionRequest<RemoteBlock>(`/blocks/${id}`);
    if (!block.archived && !block.in_trash) conflict("Removed Notion content was restored during publication. Review the conflict.");
  }
}
