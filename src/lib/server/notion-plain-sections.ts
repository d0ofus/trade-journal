import { IMAGE_MAX_BYTES } from "@/lib/workstation/image-assets";
import { jsonHash, NotionError, notionChildren, notionRequest, yieldNotion, type JsonObject, type RemoteBlock } from "./notion-client";
import { managedBlockValue } from "./notion-format";
import { readFingerprint, blockValue, written, type WrittenNode, type VerificationState } from "./notion-block-verification";
export type { VerificationState } from "./notion-block-verification";

export type SectionAnchor = { id: string; parent: string; sourceId: string; type: string };
type Position = { parent: string; after: string | null; before: string | null };
export type PlainBinding = Position & { blocks: { id: string; fingerprint: string }[] };
type AppendIntent = Position & { priorIds: string[]; expected: JsonObject[]; imageHashes: (string | null)[] };
export type PlainProgress = Position & {
  nodes: WrittenNode[];
  pending?: AppendIntent;
  removalIntents: string[];
  ready?: boolean;
  binding?: PlainBinding;
  verification?: VerificationState;
  cleanupIndex?: number;
  oldChecked?: boolean;
  appended?: string[];
  removalCheckIndex?: number;
};
function conflict(message: string): never { throw new NotionError(message, 409); }

/** Include descendants, order and file identity, excluding expiring URL signatures. */
export const fingerprint = (id: string, cursors?: VerificationState, checkpoint?: () => Promise<void>) => readFingerprint(id, false, cursors, checkpoint);

async function placement(position: Position, ids: string[], ignore: string[] = [], checkEnd = true) {
  const blocks = (await notionChildren(position.parent)).filter(b => !ignore.includes(b.id)), siblings = blocks.map(b => b.id);
  const start = position.after === null ? 0 : siblings.indexOf(position.after) + 1;
  if (position.after !== null && start === 0 || jsonHash(siblings.slice(start, start + ids.length)) !== jsonHash(ids) || checkEnd && (siblings[start + ids.length] ?? null) !== position.before)
    conflict("App-managed Notion blocks or their section boundaries were moved or changed. Review the conflict before publishing.");
  return blocks;
}

export async function inspectPlainBinding(binding: PlainBinding, ignore: string[] = [], cursors?: VerificationState, checkpoint?: () => Promise<void>): Promise<PlainBinding> {
  // Unrelated content after this owned range may change between publications.
  // The anchored start, owned IDs/order and complete subtrees must stay intact.
  const siblings = await placement(binding, binding.blocks.map(b => b.id), ignore, false);
  const blocks = [];
  for (const block of binding.blocks) blocks.push({ id: block.id, fingerprint: await readFingerprint(block.id, true, cursors, checkpoint, siblings.find(b => b.id === block.id)) });
  return { ...binding, blocks };
}
export async function verifyPlainBinding(binding: PlainBinding, ignore: string[] = [], cursors?: VerificationState, checkpoint?: () => Promise<void>) {
  if (jsonHash(await inspectPlainBinding(binding, ignore, cursors, checkpoint)) !== jsonHash(binding))
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
async function verifyNodes(parent: string, nodes: WrittenNode[], roots = false, cursors?: VerificationState, checkpoint?: () => Promise<void>): Promise<void> {
  const actual = await notionChildren(parent);
  if (!roots && jsonHash(actual.map(b => b.id)) !== jsonHash(nodes.map(b => b.id))) conflict("An in-progress Notion list was edited. Resolve the conflict before resuming.");
  for (const node of nodes) {
    const block = actual.find(b => b.id === node.id);
    if (!block || await readFingerprint(node.id, true, cursors, checkpoint, block) !== jsonHash(node)) conflict("In-progress Notion content was edited or removed. Resolve the conflict before resuming.");
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
    if (state.appended?.includes(parent)) return;
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
    (state.appended ??= []).push(parent); await checkpoint();
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
    // This verification belongs to the pre-append phase; cleanup verifies again.
    if (old && !state.oldChecked) await verifyPlainBinding(old, freshIds(), state.verification ??= {}, checkpoint);
    state.oldChecked = true;
    delete state.verification;
    await append(state.parent, state.nodes, desired, true);
    await placement(state, freshIds(), oldIds);
    await verifyNodes(state.parent, state.nodes, true, state.verification ??= {}, checkpoint);
    delete state.verification;
    state.ready = true; await checkpoint();
  }
  // Every retry verifies the replacement and remaining originals before cleanup.
  await placement(state, freshIds(), oldIds);
  await verifyNodes(state.parent, state.nodes, true, state.verification ??= {}, checkpoint);
  delete state.verification;
  const siblings = oldIds.length ? await notionChildren(state.parent) : [];
  const liveOld = oldIds.slice(state.cleanupIndex ?? 0).filter(id => siblings.some(block => block.id === id) || !state.removalIntents.includes(id));
  if (old) await placement({ ...old, before: state.before }, liveOld, freshIds());
  for (let index = state.cleanupIndex ?? 0; index < (old?.blocks.length ?? 0); index++) {
    const block = old!.blocks[index];
    const actual = siblings.find(b => b.id === block.id) ?? await notionRequest<RemoteBlock>(`/blocks/${block.id}`);
    if (actual.archived || actual.in_trash) {
      if (!state.removalIntents.includes(block.id)) conflict("Published Notion content was removed outside this job.");
    } else {
      if (await readFingerprint(block.id, true, state.verification ??= {}, checkpoint, actual) !== block.fingerprint) conflict("Previous Notion content was edited. Both versions are preserved for review.");
      if (!state.removalIntents.includes(block.id)) { state.removalIntents.push(block.id); await checkpoint(); }
      await write(`/blocks/${block.id}`, "DELETE");
    }
    delete state.verification;
    state.cleanupIndex = index + 1;
    await checkpoint();
    if (index + 1 < old!.blocks.length) yieldNotion();
  }
  state.binding = { parent: state.parent, after: state.after, before: state.before,
    blocks: state.nodes.map(node => ({ id: node.id, fingerprint: jsonHash(node) })) };
  await verifyPlainCompletion(state, checkpoint);
  await checkpoint();
}

export async function verifyPlainCompletion(state: PlainProgress, checkpoint?: () => Promise<void>) {
  if (!state.binding) conflict("Plain-content publication has not completed its block tracking.");
  await verifyPlainBinding(state.binding!, [], state.verification ??= {}, checkpoint);
  for (let index = state.removalCheckIndex ?? 0; index < state.removalIntents.length; index++) {
    const id = state.removalIntents[index];
    const block = await notionRequest<RemoteBlock>(`/blocks/${id}`);
    if (!block.archived && !block.in_trash) conflict("Removed Notion content was restored during publication. Review the conflict.");
    state.removalCheckIndex = index + 1;
    if (checkpoint) await checkpoint();
  }
  delete state.verification;
  delete state.removalCheckIndex;
}
