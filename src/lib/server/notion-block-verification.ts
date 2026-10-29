import { jsonHash, NotionError, notionChildren, notionRequest, type JsonObject, type RemoteBlock } from "./notion-client";
import { managedBlockValue } from "./notion-format";

export type WrittenNode = { id: string; value: string; children: WrittenNode[] };
type ReadNode = { id: string; raw: JsonObject; children?: string[] };
export type VerificationCursor = { nodes: Record<string, ReadNode>; pending: string[] };
export type VerificationState = Record<string, VerificationCursor>;
export const blockValue = (block: RemoteBlock) => {
  const image = block.image as { file?: { url?: string }; external?: { url?: string } } | undefined;
  const url = image?.file?.url ?? image?.external?.url;
  return { value: managedBlockValue(block), image: url ? new URL(url).pathname : undefined };
};
export const written = (block: RemoteBlock): WrittenNode => ({ id: block.id, value: jsonHash(blockValue(block)), children: [] });

/** A bounded read can resume inside a large subtree instead of restarting it. */
export async function readFingerprint(id: string, plain: boolean, cursors: VerificationState = {}, checkpoint: () => Promise<void> = async () => {}, block?: RemoteBlock) {
  const cursor = cursors[id] ??= { nodes: {}, pending: [id] };
  while (cursor.pending.length) {
    const next = cursor.pending[0];
    if (!cursor.nodes[next]) {
      const actual = next === id && block ? block : await notionRequest<RemoteBlock>(`/blocks/${next}`);
      if (actual.archived || actual.in_trash) throw new NotionError("App-managed Notion content was removed. Review the page layout.", 409);
      cursor.nodes[next] = { id: next, raw: blockValue(actual), ...!actual.has_children ? { children: [] } : {} };
    }
    const node = cursor.nodes[next];
    if (!node.children) {
      const children = await notionChildren(next);
      node.children = children.map(child => child.id);
      for (const child of children) {
        if (cursor.nodes[child.id]) throw new NotionError("The Notion section contains repeated block identities.", 409);
        cursor.nodes[child.id] = { id: child.id, raw: blockValue(child), ...!child.has_children ? { children: [] } : {} };
        if (child.has_children) cursor.pending.push(child.id);
      }
    }
    if (Object.keys(cursor.nodes).length > 1500) throw new NotionError("The managed Notion section exceeds the safe verification limit.", 409);
    cursor.pending.shift();
    await checkpoint();
  }
  function render(key: string, depth = 0): unknown {
    if (depth > 15) throw new NotionError("The Notion section nesting exceeds the safe verification limit.", 409);
    const node = cursor.nodes[key], children = node.children!.map(child => render(child, depth + 1));
    return plain ? { id: key, value: jsonHash(node.raw), children } : { id: key, ...node.raw, children };
  }
  return jsonHash(render(id));
}
