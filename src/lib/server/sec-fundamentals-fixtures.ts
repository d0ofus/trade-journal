import type { FundamentalFacts, SecFact } from "./sec-fundamentals-parser";
export function testFact(val: number, start: string, end: string, filed: string, fp: string, fy = Number(end.slice(0, 4))): SecFact {
  return { val, start, end, filed, fp, fy, accn: "0000000001-24-000001", form: fp === "FY" ? "10-K" : "10-Q" };
}
export function testFundamentalFacts(): FundamentalFacts {
  const revenue = [
    testFact(100, "2024-01-01", "2024-03-31", "2024-05-01", "Q1"),
    testFact(120, "2024-04-01", "2024-06-30", "2024-08-01", "Q2"),
    testFact(130, "2024-07-01", "2024-09-30", "2024-11-01", "Q3"),
    testFact(500, "2024-01-01", "2024-12-31", "2025-02-01", "FY"),
    testFact(150, "2025-01-01", "2025-03-31", "2025-05-01", "Q1"),
    testFact(180, "2025-04-01", "2025-06-30", "2025-08-01", "Q2"),
  ];
  return { Revenues: revenue, NetIncomeLoss: revenue.map((f, i) => ({ ...f, val: [-10, 0, 10, 20, 30, 40][i] })) };
}
export function testCompanyFacts(facts = testFundamentalFacts()) { return { facts: { "us-gaap": Object.fromEntries(Object.entries(facts).map(([tag, USD]) => [tag, { units: { USD } }])) } }; }
