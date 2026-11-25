import { describe, expect, it } from "vitest";
import { blockMatchesRequest, htmlToNotionBlocks, managedBlockValue, notionRichText } from "./notion-format";
import { propertyMatchesRequest, propertyValue } from "./notion-publisher";
import { jsonHash, type JsonObject, type RemoteBlock } from "./notion-client";
import { notionPublicationProperties } from "./notion-properties";
import dateConfirmation from "../../../fixtures/notion-confirmation/entry-date-minute-precision.json";
describe("Notion formatting and conflict normalization", () => {
  it.each(["", " \n\t", "<p></p>", "<p><br></p>", "<ul><li><p>&nbsp;&#160;</p></li></ul>", "<p><strong> </strong></p>"])("omits visually empty rich text %s", html => {
    expect(htmlToNotionBlocks(html)).toEqual([]);
  });
  it("retains nonempty nested lists even with an empty parent item", () => {
    expect(htmlToNotionBlocks("<ul><li><p></p><ul><li>Real content</li></ul></li></ul>")).toHaveLength(1);
  });
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
  it("accepts equivalent rich-text runs without changing ownership fingerprints", () => {
    const expected = { type: "paragraph", paragraph: { rich_text: [{ text: { content: "First " } }, { text: { content: "second" }, annotations: { bold: false } }] } };
    const actual: RemoteBlock = { id: "confirmed", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "First second", link: null }, annotations: { color: "default", bold: false } }] } };
    expect(blockMatchesRequest(actual, expected)).toBe(true);
    expect(managedBlockValue(actual)).not.toEqual(managedBlockValue({ id: "", ...expected }));
    expect(propertyMatchesRequest({ type: "rich_text", rich_text: (actual.paragraph as JsonObject).rich_text }, { rich_text: expected.paragraph.rich_text })).toBe(true);
  });
  it("requires full block content and preserves meaningful text, style, link and type changes", () => {
    const expected = htmlToNotionBlocks("<p>First second</p>")[0];
    expect(blockMatchesRequest({ id: "partial" }, expected)).toBe(false);
    for (const rich_text of [[{ text: { content: "Firstsecond" } }], [{ text: { content: "First second" }, annotations: { bold: true } }], [{ text: { content: "First second", link: { url: "https://example.invalid/changed" } } }], [{ type: "mention", plain_text: "First second", mention: { type: "page", page: { id: "other" } } }]]) {
      expect(blockMatchesRequest({ id: "changed", type: "paragraph", paragraph: { rich_text } }, expected)).toBe(false);
      expect(propertyMatchesRequest({ rich_text }, { rich_text: (expected.paragraph as JsonObject).rich_text })).toBe(false);
    }
    expect(propertyMatchesRequest({ number: 100.01 }, { number: 100 })).toBe(false);
    expect(propertyMatchesRequest({ date: { start: "2026-07-01T13:30:01Z" } }, { date: { start: "2026-07-01T13:30:00Z" } })).toBe(false);
  });
  it("reproduces the recorded Entry Date mismatch with an explicit outbound projection", () => {
    const frozen = structuredClone(dateConfirmation.request);
    const projected = notionPublicationProperties({ entryDate: frozen }).entryDate;
    expect(propertyValue(frozen)).not.toEqual(dateConfirmation.canonicalResponse);
    expect(propertyValue(projected)).toEqual(dateConfirmation.canonicalResponse);
    expect(frozen).toEqual(dateConfirmation.request);
    const changed = { date: { ...dateConfirmation.canonicalResponse.value, start: "2026-07-01T13:31:00.000Z" } };
    expect(propertyMatchesRequest(changed, projected)).toBe(false);
  });
});
