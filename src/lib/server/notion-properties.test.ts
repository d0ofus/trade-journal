import { beforeEach, describe, expect, it, vi } from "vitest";
import { planNotionProperties, requiredRelations, type RemoteProperty } from "./notion-properties";
import { notionProperties, emptyNotionReview } from "@/lib/workstation/notion-template";
import { emptyDocument } from "@/lib/workstation/types";
import { demoTrades } from "@/lib/workstation/demo";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./notion-client", () => ({ notionRequest: mock.request }));
function schema() {
  const result: Record<string, RemoteProperty> = { Trade: { id: "title", name: "Trade", type: "title" } };
  for (const name of ["Entry", "Exit", "S/L"]) result[name] = { id: name, name, type: "number" };
  for (const property of notionProperties) {
    const type = property.kind === "multi" ? "multi_select" : ["text", "takeaways"].includes(property.kind) ? "rich_text" : property.kind;
    result[property.label] = { id: property.key, name: property.label, type, ...type === "relation" ? { relation: { data_source_id: `related-${property.key}` } } : {} };
  }
  return result;
}
function inputs() {
  const trade = structuredClone(demoTrades[0]);
  trade.executions.forEach(e => e.provenance = { timezoneStatus: "verified", timezone: "UTC", source: "test" });
  const doc = emptyDocument(); doc.review.notion = emptyNotionReview(); return { trade, doc };
}
beforeEach(() => {
  mock.request.mockReset(); mock.request.mockImplementation(async (_path: string, method = "GET", body?: { filter: { or: { title: { equals: string } }[] } }) => method === "GET" ? { properties: { Name: { id: "title", type: "title" } } }
    : { results: body!.filter.or.map((filter, index) => ({ id: `related-page-${index}`, properties: { Name: { title: [{ plain_text: filter.title.equals }] } } })), has_more: false });
});
describe("live Notion property mapping", () => {
  it("maps actual entry/exit, planned stop and resolved New York execution range", async () => {
    const { trade, doc } = inputs(); doc.review.notion!.properties.plannedEntry = 999; doc.review.notion!.properties.plannedStop = 95;
    const plan = await planNotionProperties(trade, doc, schema());
    expect(plan.errors).toEqual([]); expect(plan.values.Entry).toEqual({ number: trade.entry }); expect(plan.values.Exit).toEqual({ number: trade.exit }); expect(plan.values["S/L"]).toEqual({ number: 95 });
    expect(plan.values.entryDate).toMatchObject({ date: { time_zone: "America/New_York" } }); expect(plan.values.stopLossPercent).toBeUndefined();
  });
  it("reports all six missing relation permissions rather than omitting them silently", async () => {
    const { trade, doc } = inputs(), properties = schema(); requiredRelations.forEach(name => delete properties[name]);
    const plan = await planNotionProperties(trade, doc, properties);
    expect(requiredRelations.every(name => plan.errors.some(error => error.includes(name)))).toBe(true);
  });
  it("verifies related database access for empty reviews without clearing unset values", async () => {
    const { trade, doc } = inputs();
    const plan = await planNotionProperties(trade, doc, schema());
    expect(mock.request.mock.calls.filter(([path]) => path.startsWith("/data_sources/related-"))).toHaveLength(6);
    expect(plan.values.typeOfReview).toBeUndefined();
    mock.request.mockRejectedValue(new Error("No access"));
    const denied = await planNotionProperties(trade, doc, schema());
    expect(requiredRelations.every(name => denied.errors.some(error => error.includes(name)))).toBe(true);
  });
  it("blocks unresolved execution time and missing numeric Exit", async () => {
    const { trade, doc } = inputs(), properties = schema(); delete properties.Exit; trade.executions[0].provenance!.timezoneStatus = "unverified";
    const plan = await planNotionProperties(trade, doc, properties);
    expect(plan.errors).toContain("Exit must exist as a Notion number property."); expect(plan.errors.some(error => error.includes("timestamps"))).toBe(true);
  });
  it("resolves multiple relation values in a bounded batch without creating related pages", async () => {
    const { trade, doc } = inputs(); doc.review.notion!.properties.confluences = ["A", "B", "C"];
    const plan = await planNotionProperties(trade, doc, schema());
    expect(plan.values.confluences).toEqual({ relation: [{ id: "related-page-0" }, { id: "related-page-1" }, { id: "related-page-2" }] });
    expect(mock.request.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
  });
  it("blocks ambiguous or unmatched relation choices", async () => {
    const { trade, doc } = inputs(); doc.review.notion!.properties.typeOfReview = ["Duplicate"];
    mock.request.mockImplementation(async (_path: string, method = "GET") => method === "GET" ? { properties: { Name: { id: "title", type: "title" } } } : { results: [1, 2].map(id => ({ id: String(id), properties: { Name: { title: [{ plain_text: "Duplicate" }] } } })), has_more: false });
    expect((await planNotionProperties(trade, doc, schema())).errors.some(error => error.includes("exactly one"))).toBe(true);
  });
});
