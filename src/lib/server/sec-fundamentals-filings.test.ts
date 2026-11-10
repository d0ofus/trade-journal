import { expect, it, vi } from "vitest";
import { loadFundamentalFilings, needsFundamentalFilingCheck, hasCompleteFundamentalCoverage } from "./sec-fundamentals-filings";
import { parseFundamentalQuarters, type FundamentalFacts } from "./sec-fundamentals-parser";
import { testFact } from "./sec-fundamentals-fixtures";

const annual = { ...testFact(400, "2024-01-01", "2024-12-31", "2025-04-30", "FY"), form: "20-F", currency: "USD", taxonomy: "us-gaap" as const };
const initial = { Revenues: [annual] };
const statement = `<h2>Consolidated statements of operations</h2><p>U.S. dollars in millions</p><table><tr><th></th><th>Three months ended September 30, 2025</th></tr><tr><td>Revenue</td><td>120</td></tr><tr><td>Net income attributable to the company</td><td>10</td></tr></table>`;
const accn = "0000000999-25-000001";
const columns = (filed = "2025-11-10", document = "report.htm") => ({ form: ["6-K"], filingDate: [filed], accessionNumber: [accn], primaryDocument: [document] });
function setup() {
  const cache = new Map<string, { value: unknown; fetchedAt: string; stale: boolean }>();
  const deps = {
    json: vi.fn<(url: string, signal: AbortSignal) => Promise<unknown>>().mockResolvedValue({ filings: { recent: columns(), files: [] } }),
    text: vi.fn(async (url: string): Promise<string> => url.endsWith("report.htm") ? '<p>Quarterly financial results</p><a href="ex99.htm">Exhibit 99.1</a>' : statement),
    cached: vi.fn(async (key: string, _age: number, fetch: (signal: AbortSignal) => Promise<unknown>) => {
      const old = cache.get(key); if (old) return old;
      const entry = { value: await fetch(new AbortController().signal), fetchedAt: "2026-01-14T00:00:00.000Z", stale: false }; cache.set(key, entry); return entry;
    }),
  };
  return { deps, cache };
}
it("discovers exhibits for arbitrary issuers, caches observations and preserves exact source dates", async () => {
  const { deps } = setup();
  const data = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(parseFundamentalQuarters(data.facts, "2026-01-13").at(-1)).toMatchObject({ periodEnd: "2025-09-30", revenue: { value: 120000000 }, netIncome: { value: 10000000 } });
  expect(data.incomplete).toBe(false); expect(deps.text).toHaveBeenCalledTimes(2);
  await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(deps.text).toHaveBeenCalledTimes(2);
  const source = (data.facts as FundamentalFacts).Revenues.at(-1)!.source!;
  expect(source).toMatchObject({ filed: "2025-11-10", accession: accn, document: "ex99.htm" });
});
it("excludes same-day and future filings before downloading their statements", async () => {
  const { deps } = setup();
  deps.json.mockResolvedValue({ filings: { recent: columns("2026-01-13"), files: [] } });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result.scanned).toBe(0); expect(deps.text).not.toHaveBeenCalled();
});
it("does not reuse later inferred accounting or fiscal context in a historical request", async () => {
  const { deps } = setup();
  deps.json.mockResolvedValue({ filings: { recent: columns("2025-02-01"), files: [] } });
  deps.text.mockImplementation(async url => url.endsWith("report.htm") ? '<p>Financial results</p><a href="ex99.htm">Statements</a>' : statement.replaceAll("2025", "2024"));
  const latest = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(latest.facts.Revenues).toHaveLength(2);
  const historical = await loadFundamentalFilings("0000000999", initial, "2025-03-01", new AbortController().signal, deps);
  expect(historical.facts.Revenues).toEqual([annual]);
  expect(historical.ambiguous).toBe(true);
});
it("follows historical submissions files and rejects links outside the source accession", async () => {
  const { deps } = setup();
  deps.json.mockImplementation(async url => url.includes("-submissions-") ? columns() : { filings: { recent: { form: [] }, files: [{ name: "CIK0000000999-submissions-001.json", filingFrom: "2024-01-01", filingTo: "2025-12-31" }] } });
  deps.text.mockImplementation(async url => url.endsWith("report.htm") ? '<p>Financial results</p><a href="https://outside.test/evil.htm">Exhibit</a><a href="../different/other.htm">Other</a><a href="report.htm#table">Self</a><a href="ex99.htm">Financials</a>' : statement);
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result.scanned).toBe(1); expect(deps.json).toHaveBeenCalledTimes(2);
  expect(deps.text.mock.calls.every(([url]) => url.startsWith(`https://www.sec.gov/Archives/edgar/data/999/${accn.replaceAll("-", "")}/`))).toBe(true);
  expect(deps.text).toHaveBeenCalledTimes(2);
});
it("uses filing indexes for attachments and classifies PDF-only coverage explicitly", async () => {
  const { deps } = setup(); deps.text.mockResolvedValue("Quarterly financial results are attached.");
  deps.json.mockImplementation(async url => url.endsWith("index.json") ? { directory: { item: [{ name: "results.pdf" }] } } : { filings: { recent: columns(), files: [] } });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result).toMatchObject({ unsupported: true, incomplete: false });
  expect(deps.text).toHaveBeenCalledTimes(1);
});
it("uses the filing index when a cover page only links to an external website", async () => {
  const { deps } = setup();
  deps.text.mockImplementation(async url => url.endsWith("report.htm") ? '<p>Exhibit 99.1: financial results</p><a href="https://issuer.test/release.htm">Company website</a>' : statement);
  deps.json.mockImplementation(async url => url.endsWith("index.json") ? { directory: { item: [{ name: "ex99.htm" }] } } : { filings: { recent: columns(), files: [] } });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(parseFundamentalQuarters(result.facts, "2026-01-13").at(-1)?.revenue?.value).toBe(120000000);
  expect(deps.text.mock.calls.every(([url]) => !url.startsWith("https://issuer.test"))).toBe(true);
});
it("still discovers smaller attachments when the primary document exceeds the size limit", async () => {
  const { deps } = setup();
  deps.text.mockImplementation(async url => { if (url.endsWith("report.htm")) throw Object.assign(new Error("Oversized"), { status: 413 }); return statement; });
  deps.json.mockImplementation(async url => url.endsWith("index.json") ? { directory: { item: [{ name: "ex99.htm" }] } } : { filings: { recent: columns(), files: [] } });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result.incomplete).toBe(false);
  expect(parseFundamentalQuarters(result.facts, "2026-01-13").at(-1)?.revenue?.value).toBe(120000000);
});
it("preserves completed observations and resumes after a subsequent provider failure", async () => {
  const { deps } = setup();
  deps.json.mockResolvedValue({ filings: { recent: { form: ["6-K", "6-K"], filingDate: ["2025-11-10", "2025-08-01"], accessionNumber: [accn, "0000000999-25-000002"], primaryDocument: ["report.htm", "broken.htm"] }, files: [] } });
  deps.text.mockImplementation(async url => { if (url.endsWith("broken.htm")) throw new Error("provider failed"); return url.endsWith("report.htm") ? '<p>Financial results</p><a href="ex99.htm">Results</a>' : statement; });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result.incomplete).toBe(true); expect(parseFundamentalQuarters(result.facts, "2026-01-13")).toHaveLength(1);
  deps.text.mockResolvedValue("Investor conference announcement");
  const second = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(second.incomplete).toBe(false); expect(deps.text).toHaveBeenCalledTimes(4);
});
it("honors caller cancellation instead of returning a false no-data result", async () => {
  const { deps } = setup(), controller = new AbortController(); controller.abort();
  await expect(loadFundamentalFilings("0000000999", initial, null, controller.signal, deps)).rejects.toBeDefined();
});
it("preserves and caches completed documents when another attachment in the same filing fails", async () => {
  const { deps } = setup();
  deps.text.mockImplementation(async url => {
    if (url.endsWith("broken.htm")) throw new Error("SEC attachment timed out");
    return url.endsWith("report.htm") ? '<p>Financial results</p><a href="ex99.htm">Statements</a><a href="broken.htm">Other attachment</a>' : statement;
  });
  const partial = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(partial).toMatchObject({ incomplete: true, retrievalError: "SEC attachment timed out" });
  expect(parseFundamentalQuarters(partial.facts, "2026-01-13").at(-1)?.revenue?.value).toBe(120000000);
  deps.text.mockClear(); deps.text.mockResolvedValue("Investor presentation");
  const resumed = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(resumed.incomplete).toBe(false);
  expect(parseFundamentalQuarters(resumed.facts, "2026-01-13").at(-1)?.revenue?.value).toBe(120000000);
  expect(deps.text).toHaveBeenCalledTimes(1);
  expect(deps.text.mock.calls[0][0]).toContain("broken.htm");
});
it("continues past a missing filing rather than blocking all older history", async () => {
  const { deps } = setup();
  deps.json.mockResolvedValue({ filings: { recent: { form: ["6-K", "6-K"], filingDate: ["2025-12-01", "2025-11-10"], accessionNumber: ["0000000999-25-000002", accn], primaryDocument: ["missing.htm", "report.htm"] }, files: [] } });
  deps.text.mockImplementation(async url => { if (url.endsWith("missing.htm")) throw Object.assign(new Error("Not found"), { status: 404 }); return url.endsWith("report.htm") ? '<p>Financial results</p><a href="ex99.htm">Results</a>' : statement; });
  const result = await loadFundamentalFilings("0000000999", initial, "2026-01-13", new AbortController().signal, deps);
  expect(result).toMatchObject({ unsupported: true, incomplete: false, scanned: 2 });
  expect(parseFundamentalQuarters(result.facts, "2026-01-13").at(-1)?.revenue?.value).toBe(120000000);
});
it("checks newer exhibits when eight complete structured quarters stop before a newly reported quarter", async () => {
  const { deps } = setup();
  const facts: FundamentalFacts = { Revenues: [annual], NetIncomeLoss: [] };
  for (let i = 0; i < 8; i++) {
    const end = new Date(Date.UTC(2023, 9 + i * 3, 0)).toISOString().slice(0, 10), start = new Date(Date.UTC(2023, 6 + i * 3, 1)).toISOString().slice(0, 10);
    const f = { ...testFact(100, start, end, new Date(Date.parse(end) + 30 * 86400000).toISOString().slice(0, 10), `Q${Number(end.slice(5, 7)) / 3}`, Number(end.slice(0, 4))), currency: "USD", taxonomy: "us-gaap" as const };
    facts.Revenues.push(f); facts.NetIncomeLoss.push({ ...f, val: 10 });
  }
  expect(hasCompleteFundamentalCoverage(facts, "2025-11-11")).toBe(true);
  expect(needsFundamentalFilingCheck(facts, "2025-08-01")).toBe(false);
  expect(needsFundamentalFilingCheck(facts, "2025-11-11")).toBe(true);
  const result = await loadFundamentalFilings("0000000999", facts, "2025-11-11", new AbortController().signal, deps);
  expect(parseFundamentalQuarters(result.facts, "2025-11-11").at(-1)?.periodEnd).toBe("2025-09-30");
  expect(deps.text).toHaveBeenCalled();
});
