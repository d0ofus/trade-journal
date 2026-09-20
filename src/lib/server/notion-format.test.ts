import { describe, expect, it } from "vitest";
import { htmlToNotionBlocks, managedBlockValue, notionRichText } from "./notion-format";
import { propertyValue } from "./notion-publisher";
import { jsonHash, type JsonObject, type RemoteBlock } from "./notion-client";
describe("Notion formatting and conflict normalization", () => {
  it("retains inline emphasis, entities, paragraphs, lists and nested lists", () => {
    const blocks = htmlToNotionBlocks("<p><strong>Bold &amp; clear</strong><br><em>Context</em></p><ul><li>First<ul><li>Nested</li></ul></li></ul>");
    expect(blocks[0].type).toBe("paragraph");
    const text = (blocks[0].paragraph as { rich_text: JsonObject[] }).rich_text;
    expect(text[0]).toMatchObject({ text: { content: "Bold & clear" }, annotations: { bold: true } });
    expect(blocks[1]).toMatchObject({ type: "bulleted_list_item", bulleted_list_item: { children: [{ type: "bulleted_list_item" }] } });
  });
  it("does not publish active HTML or arbitrary attributes", () => {
    expect(JSON.stringify(htmlToNotionBlocks('<p onclick="bad()">Safe<script>unsafe()</script></p>'))).not.toMatch(/bad\(|unsafe\(/);
  });
  it("splits long text to fit the per-rich-text limit", () => {
    const text = notionRichText("x".repeat(6000)); expect(text).toHaveLength(4);
    expect(text.every(part => (part.text as { content: string }).content.length <= 1900)).toBe(true);
  });
  it("ignores response-only annotations for block comparison", () => {
    const desired = { id: "a", type: "paragraph", paragraph: { rich_text: notionRichText("Hello") } } as RemoteBlock;
    const actual = { id: "b", type: "paragraph", paragraph: { color: "default", rich_text: [{ type: "text", plain_text: "Hello", text: { content: "Hello", link: null }, annotations: { bold: false, italic: false, color: "default" } }] } } as RemoteBlock;
    expect(managedBlockValue(actual)).toEqual(managedBlockValue(desired));
  });
  it("recognizes equivalent New York dates when Notion returns offsets", () => {
    expect(propertyValue({ date: { start: "2026-07-01T09:30:00", end: "2026-07-01T10:00:00", time_zone: "America/New_York" } }))
      .toEqual(propertyValue({ type: "date", date: { start: "2026-07-01T09:30:00-04:00", end: "2026-07-01T10:00:00-04:00", time_zone: null } }));
  });
  it("does not treat reordered JSON annotation keys as conflicting edits", () => {
    expect(jsonHash({ annotations: { italic: true, bold: true } })).toBe(jsonHash({ annotations: { bold: true, italic: true } }));
  });
});
