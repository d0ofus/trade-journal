import { describe, expect, it } from "vitest";
import { selectShareFact } from "./historical-shares";
import { emptyNotionReview } from "@/lib/workstation/notion-template";
import { notionJournalPatch, readNotionReview } from "./notion-review-storage";
describe("historical shares and template persistence", () => {
  it("excludes future observations, later filings, same-session filings and averages", () => {
    const old = { val: 100, end: "2026-03-01", filed: "2026-04-01", accn: "old" };
    expect(selectShareFact([old, { ...old, val: 200, end: "2026-07-01" }, { ...old, val: 300, filed: "2026-06-04" }, { ...old, val: 400, start: "2026-01-01" }], "2026-06-04")).toEqual(old);
    expect(selectShareFact([old, { ...old, val: 101 }], "2026-06-04")).toBeNull();
  });
  it("stores template-only fields once while composing canonical columns and relations", () => {
    const n = emptyNotionReview(); n.properties.marketRegime = "Rotation"; n.properties.typeOfReview = ["Sector Thematic"]; n.properties.plannedEntry = 100; n.properties.plannedStop = 95; n.sections.entry = { html: "<p>Setup</p>", evidenceIds: ["e1"] };
    const patch = notionJournalPatch(n);
    expect(patch).toMatchObject({ plannedEntry: 100, plannedStop: 95, stopLossPercent: 5 });
    expect(patch.templateData).toMatchObject({ properties: { marketRegime: "Rotation" } });
    expect((patch.templateData as { properties: object }).properties).not.toHaveProperty("typeOfReview");
    const loaded = readNotionReview({ ...patch, notionRelations: [{ relationTag: { kind: "TYPE_OF_REVIEW", name: "Sector Thematic" } }] });
    expect(loaded.properties.typeOfReview).toEqual(["Sector Thematic"]); expect(loaded.sections.entry?.evidenceIds).toEqual(["e1"]);
  });
});
