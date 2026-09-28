import { describe, it, expect } from "vitest";
import { extractFundamentalFacts, parseFundamentalQuarters } from "./sec-fundamentals-parser";
import { testCompanyFacts, testFact, testFundamentalFacts } from "./sec-fundamentals-fixtures";

describe("point-in-time SEC fundamentals", () => {
  it("derives Q4 and growth with all earlier inputs, including negative/zero net income", () => {
    const rows = parseFundamentalQuarters(testFundamentalFacts(), null);
    expect(rows).toHaveLength(6);
    expect(rows[3]).toMatchObject({ fiscalQuarter: 4, revenue: { value: 150, derived: true }, netIncome: { value: 20, derived: true } });
    expect(rows[3].revenue?.sources).toHaveLength(4);
    expect(rows[4]).toMatchObject({ revenueYoY: 50, revenueQoQ: 0, netIncomeYoY: 400, netIncomeQoQ: 50 });
    expect(rows[5].netIncomeYoY).toBeNull();
  });
  it("excludes same-day filings, unfiled completed quarters, and later restatements before selection", () => {
    const facts = testFundamentalFacts();
    facts.Revenues.push({ ...facts.Revenues[0], val: 900, filed: "2025-06-01", fy: 2025, accn: "0000000001-25-000002" });
    const historical = parseFundamentalQuarters(facts, "2025-05-01");
    expect(historical).toHaveLength(4);
    expect(historical[0].revenue?.value).toBe(100);
    expect(historical[3].revenue?.value).toBe(150);
    const nextDay = parseFundamentalQuarters(facts, "2025-05-02");
    expect(nextDay.at(-1)?.revenueYoY).toBe(50);
    expect(parseFundamentalQuarters(facts, null)[0].revenue?.value).toBe(900);
    expect(historical.flatMap(q => [q.revenue, q.netIncome].flatMap(m => m?.sources ?? [])).every(s => s.filed < "2025-05-01")).toBe(true);
  });
  it("keeps missing quarters missing and does not derive Q4 without Q1–Q3", () => {
    const facts = testFundamentalFacts(); facts.Revenues.splice(1, 1); facts.NetIncomeLoss.splice(1, 1);
    const rows = parseFundamentalQuarters(facts, null);
    expect(rows.map(q => [q.fiscalYear, q.fiscalQuarter])).toEqual([[2024, 1], [2024, 3], [2025, 1], [2025, 2]]);
    expect(rows[1].revenueQoQ).toBeNull(); expect(rows[3].revenueYoY).toBeNull();
  });
  it("uses each company's disclosed fiscal year and handles a September year-end", () => {
    const Revenues = [
      testFact(90, "2023-10-01", "2023-12-31", "2024-02-01", "Q1", 2024),
      testFact(100, "2024-01-01", "2024-03-31", "2024-05-01", "Q2", 2024),
      testFact(110, "2024-04-01", "2024-06-30", "2024-08-01", "Q3", 2024),
      testFact(420, "2023-10-01", "2024-09-30", "2024-11-01", "FY", 2024),
      testFact(130, "2024-10-01", "2024-12-31", "2025-02-01", "Q1", 2025),
    ];
    expect(parseFundamentalQuarters({ Revenues }, "2025-02-02").map(q => [q.fiscalYear, q.fiscalQuarter, q.revenue?.value])).toEqual([[2024, 1, 90], [2024, 2, 100], [2024, 3, 110], [2024, 4, 120], [2025, 1, 130]]);
    expect(parseFundamentalQuarters({ Revenues }, "2024-06-01").map(q => q.fiscalQuarter)).toEqual([1, 2]);
  });
  it("supports amended forms, tag precedence and partial metrics without treating absence as zero", () => {
    const facts = testFundamentalFacts();
    facts.RevenueFromContractWithCustomerExcludingAssessedTax = [{ ...facts.Revenues[4], val: 155, form: "10-Q/A" }];
    facts.ProfitLoss = facts.NetIncomeLoss; delete facts.NetIncomeLoss;
    expect(parseFundamentalQuarters(facts, null)[4].revenue?.value).toBe(155);
    expect(parseFundamentalQuarters({ Revenues: facts.Revenues }, null)[0].netIncome).toBeNull();
    expect(parseFundamentalQuarters(facts, null)[0].netIncome?.value).toBe(-10);
  });
  it("retains all source versions but only supported, valid USD duration facts", () => {
    const input = testCompanyFacts();
    input.facts["us-gaap"].Revenues.units.USD.push({ ...input.facts["us-gaap"].Revenues.units.USD[0], val: 105, filed: "2026-05-01" });
    expect(extractFundamentalFacts(input).Revenues).toHaveLength(7);
    expect(extractFundamentalFacts({ facts: { "ifrs-full": {} } }).Revenues).toEqual([]);
    expect(() => extractFundamentalFacts(null)).toThrow();
  });
  it("calculates growth before trimming the displayed history to eight quarters", () => {
    const facts = testFundamentalFacts();
    for (let year = 2026; year < 2029; year++) for (const f of facts.Revenues.slice(0, 4)) facts.Revenues.push({ ...f, fy: year, start: f.start.replace("2024", String(year)), end: f.end.replace("2024", String(year)), filed: f.filed.replace("2024", String(year)).replace("2025", String(year + 1)) });
    const rows = parseFundamentalQuarters(facts, null);
    expect(rows).toHaveLength(8); expect(rows[0].revenueYoY).toBe(0);
  });
});
