import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { strFromU8, unzipSync } from "fflate";
import { demoTrades } from "./demo";
import { emptyDocument, type Evidence } from "./types";
import { emptyNotionReview } from "./notion-template";
import { attachEvidence, removeEvidence } from "./evidence";
import { notionImportCsv, notionPageArchive } from "./notion-import";

const evidence: Evidence = { id: "one", name: "Exit & context.png", image: "data:image/png;base64,aGVsbG8=", time: 1, revision: 0, timeframe: "5m" };
describe("Notion file import", () => {
  it("serializes template properties without display units and protects text formulas", () => {
    const doc = emptyDocument(); doc.review.notion = emptyNotionReview();
    doc.review.notion.properties = { exitMarked: true, indexSupportive: false, xFrom50Sma: -1.5, typeOfReview: ["Sector Thematic"], plannedEntry: 20, plannedStop: 19, bestPeerTickers: '=HYPERLINK("test")', themeBreadthNotes: "<p>Strong <b>peers</b></p>" };
    doc.review.takeaway = "<p>Wait, then enter</p>";
    const [row] = parse(notionImportCsv({ trade: demoTrades[0], doc, url: "https://example.test/trades" }), { bom: true, columns: true }) as Record<string, string>[];
    expect(row).toMatchObject({ "Exit?": "TRUE", "Index Supportive?": "FALSE", "X from 50 SMA": "-1.5", "S/L % (snapshot)": "5", "Planned entry": "20", "Planned stop": "19", Takeaways: "Wait, then enter", "Theme Breadth Notes": "Strong peers" });
    expect(row["Entry Date"]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(row["Best Peer Tickers"]).toMatch(/^'=/);
    expect(row).not.toHaveProperty("S/L %");
    const unresolved = { ...demoTrades[0], executions: demoTrades[0].executions.map(e => ({ ...e, provenance: undefined })) };
    expect((parse(notionImportCsv({ trade: unresolved, doc, url: "" }), { bom: true, columns: true }) as Record<string, string>[])[0]["Entry Date"]).toBe("");
  });
  it("packages one formatted page with reusable local images at their assigned sections", async () => {
    let doc = attachEvidence(emptyDocument(), evidence, "exit");
    doc.review.notion!.sections.index = { html: "<p><u>Market context</u></p>", evidenceIds: [evidence.id] };
    doc.review.notion!.sections.exit!.html = "<p><strong>Exit review</strong></p>";
    doc.review.setup = "Preserved legacy setup";
    const files = unzipSync(new Uint8Array(await notionPageArchive({ trade: demoTrades[0], doc, url: "https://example.test/" }).arrayBuffer()));
    expect(Object.keys(files)).toEqual(["assets/chart-1.png", "review.html"]);
    const html = strFromU8(files["review.html"]);
    expect(html).toContain("<u>Market context</u>"); expect(html).toContain("Preserved legacy setup");
    expect(html.split('src="assets/chart-1.png"')).toHaveLength(3);
    expect(html.indexOf('<img')).toBeGreaterThan(html.indexOf("<h2>Exit Screen</h2>"));
    expect(html.slice(html.indexOf("<h2>Entry Screen</h2>"), html.indexOf("<h2>Exit Screen</h2>"))).not.toContain("<img");
    doc = removeEvidence(doc, evidence.id);
    expect(doc.evidence).toEqual([]);
    expect(doc.review.notion!.sections.exit!.evidenceIds).toEqual([]);
    expect(doc.review.notion!.sections.index!.evidenceIds).toEqual([]);
    expect(doc.review.notion!.sections.index!.html).toContain("Market context");
  });
  it("fails visibly for missing image bytes and enforces section capacity before modifying a document", () => {
    const doc = emptyDocument(); doc.evidence = [{ ...evidence, image: "https://example.test/private.png" }];
    expect(() => notionPageArchive({ trade: demoTrades[0], doc, url: "" })).toThrow("Unable to include chart");
    doc.review.notion = emptyNotionReview(); doc.review.notion.sections.exit = { html: "keep", evidenceIds: Array.from({ length: 30 }, (_, i) => String(i)) };
    expect(() => attachEvidence(doc, evidence, "exit")).toThrow("30 images");
    expect(doc.evidence).toHaveLength(1);
  });
  it("stores identical originals once while preserving separate evidence captions and assignments", async () => {
    const doc = attachEvidence(attachEvidence(emptyDocument(), evidence, "entry"), { ...evidence, id: "two", name: "Reused original" }, "exit");
    const files = unzipSync(new Uint8Array(await notionPageArchive({ trade: demoTrades[0], doc, url: "" }).arrayBuffer()));
    expect(Object.keys(files).filter(name => name.endsWith(".png"))).toEqual(["assets/chart-1.png"]);
    const html = strFromU8(files["review.html"]);
    expect(html).toContain("Reused original"); expect(html.split('src="assets/chart-1.png"')).toHaveLength(3);
  });
});
