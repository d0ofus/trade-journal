import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { demoTrades } from "./demo";
import { demoFundamentals } from "./fundamentals-demo";
import { attachEvidence, removeEvidence, sectionEvidenceIds } from "./evidence";
import { emptyDocument, type Evidence } from "./types";
import { workstationDocumentSchema } from "./schema";
import { notionBlocks } from "./notion-export";
import { notionImportCsv, notionPageArchive } from "./notion-import";
import { reviewArchive, exportColumns } from "./export";
import { allFundamentalsSeries } from "./fundamentals-series";

function snapshot(): Evidence {
  const { symbol, mode, cutoff, issuer, quarters, fetchedAt, stale } = demoFundamentals(demoTrades[0], "before-entry");
  return { id: "fundamentals-one", name: "NVDA fundamentals before entry", image: "data:image/png;base64,aGVsbG8=", time: 1, revision: 0, timeframe: "quarterly", fundamentalsCapture: { symbol, mode, cutoff, issuer, quarters, fetchedAt, stale, capturedAt: "2026-09-28T00:00:00.000Z" } };
}
describe("fundamentals evidence", () => {
  it("round-trips the selected series while accepting older captures without visibility metadata", () => {
    const doc = attachEvidence(emptyDocument(), snapshot(), "fundamentals");
    expect(workstationDocumentSchema.parse(doc).evidence[0].fundamentalsCapture?.seriesVisibility).toBeUndefined();
    doc.evidence[0].fundamentalsCapture!.seriesVisibility = { ...allFundamentalsSeries, revenue: false, netIncomeQoQ: false };
    expect(workstationDocumentSchema.parse(JSON.parse(JSON.stringify(doc))).evidence[0].fundamentalsCapture).toEqual(doc.evidence[0].fundamentalsCapture);
    const malformed = JSON.parse(JSON.stringify(doc));
    delete malformed.evidence[0].fundamentalsCapture.seriesVisibility.revenue;
    expect(workstationDocumentSchema.safeParse(malformed).success).toBe(false);
    malformed.evidence[0].fundamentalsCapture.seriesVisibility = { ...allFundamentalsSeries, unexpected: true };
    expect(workstationDocumentSchema.safeParse(malformed).success).toBe(false);
  });
  it("preserves provenance and existing commentary through validation and removal", () => {
    const doc = attachEvidence(emptyDocument(), snapshot(), "fundamentals");
    doc.review.notion!.analysis.fundamentals = "<p>Revenue expanded before entry.</p>";
    const roundTrip = workstationDocumentSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(roundTrip.evidence[0].fundamentalsCapture).toEqual(doc.evidence[0].fundamentalsCapture);
    expect(sectionEvidenceIds(roundTrip.review.notion, "fundamentals")).toEqual(["fundamentals-one"]);
    const removed = removeEvidence(roundTrip, "fundamentals-one");
    expect(sectionEvidenceIds(removed.review.notion, "fundamentals")).toEqual([]);
    expect(removed.review.notion!.analysis.fundamentals).toContain("Revenue expanded");
    expect(workstationDocumentSchema.safeParse(emptyDocument()).success).toBe(true);
  });
  it("rejects historical evidence with a same-day or later filing", () => {
    const doc = attachEvidence(emptyDocument(), snapshot(), "fundamentals");
    doc.evidence[0].fundamentalsCapture!.quarters[0].revenue!.sources[0].filed = "2099-01-01";
    expect(workstationDocumentSchema.safeParse(doc).success).toBe(false);
  });
  it("exports only authored commentary and attached images; the live preview never becomes content", async () => {
    const doc = attachEvidence(emptyDocument(), snapshot(), "fundamentals"); doc.review.notion!.analysis.fundamentals = "<p>Saved analysis</p>";
    const row = { trade: demoTrades[0], doc, url: "https://example.test/trades" };
    const fundamentals = notionBlocks(row.trade, doc).filter(b => b.title === "Fundamentals");
    expect(fundamentals).toHaveLength(1); expect(fundamentals[0].html).toContain("Saved analysis");
    const files = unzipSync(new Uint8Array(await notionPageArchive(row).arrayBuffer()));
    const html = strFromU8(files["review.html"]);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html.indexOf("<img")).toBeGreaterThan(html.indexOf(">Fundamentals</h2>"));
    for (const output of [html, notionImportCsv(row), JSON.stringify(fundamentals)]) {
      expect(output).not.toContain("Illustrative demo fundamentals"); expect(output).not.toContain("revenueYoY"); expect(output).not.toContain("ws-fundamentals-mini");
    }
    const portable = unzipSync(new Uint8Array(await (await reviewArchive([row], exportColumns, {})).arrayBuffer()));
    const review = strFromU8(Object.entries(portable).find(([name]) => name.endsWith("review.html"))![1]);
    expect(review.match(/<img /g)).toHaveLength(1); expect(review).toContain("Saved analysis");
  });
});
