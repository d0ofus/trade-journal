export { jsonHash, NotionError, notionChildren, notionRequest, notionTree, requireNotionPublishing, type JsonObject, type RemoteBlock } from "./notion-client";
import type { RemoteBlock } from "./notion-client";
export function managedPlaceholder(block: RemoteBlock): string | null {
  if (block.type !== "callout") return null;
  const content = block.callout as { rich_text?: { text?: { link?: { url?: string } } }[] };
  return content.rich_text?.[0]?.text?.link?.url ?? null;
}
