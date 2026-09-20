import { decodeText, richHtml } from "@/lib/workstation/rich-text";
import type { JsonObject, RemoteBlock } from "./notion-client";

type Node = { tag: string; text?: string; children: Node[] };
export function notionRichText(text: string): JsonObject[] {
  const output: JsonObject[] = [];
  for (let offset = 0; offset < text.length; offset += 1900) output.push({ type: "text", text: { content: text.slice(offset, offset + 1900) } });
  return output;
}
/** The application's sanitizer already restricts the editor's HTML vocabulary. */
export function htmlToNotionBlocks(html: string): JsonObject[] {
  if (!html.trim()) return [];
  const root: Node = { tag: "root", children: [] }, stack = [root];
  for (const token of richHtml(html).match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); }
    else if (token.startsWith("<")) {
      const tag = token.slice(1, -1), node: Node = { tag, children: [] };
      stack.at(-1)!.children.push(node); if (tag !== "br") stack.push(node);
    } else stack.at(-1)!.children.push({ tag: "text", text: decodeText(token), children: [] });
  }
  const structural = new Set(["p", "h2", "h3", "blockquote", "li", "ul", "ol"]);
  function inline(node: Node, annotations: JsonObject = {}): JsonObject[] {
    if (node.tag === "text" || node.tag === "br") return notionRichText(node.text ?? "\n").map(part => ({ ...part, annotations }));
    const style = { ...annotations, ...["strong", "b"].includes(node.tag) ? { bold: true } : {}, ...["em", "i"].includes(node.tag) ? { italic: true } : {}, ...node.tag === "u" ? { underline: true } : {}, ...node.tag === "s" ? { strikethrough: true } : {} };
    return node.children.flatMap(child => inline(child, style));
  }
  function blocks(nodes: Node[], list?: string): JsonObject[] {
    const result: JsonObject[] = [];
    for (const node of nodes) {
      if (node.tag === "ul" || node.tag === "ol") { result.push(...blocks(node.children, node.tag)); continue; }
      if (node.tag === "text" && !node.text?.trim()) continue;
      const type = node.tag === "li" ? list === "ol" ? "numbered_list_item" : "bulleted_list_item" : node.tag === "h2" ? "heading_2" : node.tag === "h3" ? "heading_3" : node.tag === "blockquote" ? "quote" : "paragraph";
      const nested = node.children.filter(child => child.tag === "ul" || child.tag === "ol");
      const text = inline({ ...node, children: node.children.filter(child => !nested.includes(child)) });
      if (text.length > 100) throw new Error("A paragraph has too many formatting runs for Notion. Divide it into smaller paragraphs.");
      const children = blocks(nested);
      result.push({ object: "block", type, [type]: { rich_text: text, ...children.length ? { children } : {} } });
      if (!structural.has(node.tag) && node.tag !== "text") continue;
    }
    return result;
  }
  return blocks(root.children);
}
/** Strip response-only fields and signed file URLs before conflict comparison. */
export function managedBlockValue(block: RemoteBlock): JsonObject {
  const data = block[block.type] as JsonObject ?? {};
  const text = (value: unknown) => (value as JsonObject[] ?? []).map(part => ({ text: (part.text as JsonObject)?.content ?? part.plain_text ?? "", link: (part.text as JsonObject)?.link ?? null,
    annotations: Object.fromEntries(Object.entries(part.annotations as JsonObject ?? {}).filter(([, value]) => value !== false && value !== "default")) }));
  if (block.type === "image") return { type: block.type, caption: text(data.caption) };
  return { type: block.type, rich_text: text(data.rich_text), color: data.color ?? "default", icon: data.icon ?? null };
}
