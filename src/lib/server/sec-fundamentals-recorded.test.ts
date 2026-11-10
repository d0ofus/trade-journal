import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../../fixtures/sec-fundamentals/manifest.json";
import { readFundamentalDocument, type FilingContext } from "./sec-fundamentals-document";
import { extractFundamentalFacts, fundamentalCurrency, mergeFundamentalFacts, parseFundamentalQuarters } from "./sec-fundamentals-parser";

const fixture = (name: string) => readFileSync(path.resolve("fixtures/sec-fundamentals", name), "utf8");
describe("recorded SEC financial statements across issuers", () => {
  for (const issuer of manifest.issuers) it(`${issuer.symbol}: reconciles reported figures, currency and point-in-time sources`, () => {
    const structured = extractFundamentalFacts(JSON.parse(fixture(`${issuer.symbol}-companyfacts.json`)));
    const documents = issuer.documents.map(doc => readFundamentalDocument(fixture(doc.file), doc.context as FilingContext).facts);
    const facts = mergeFundamentalFacts(structured, ...documents), currency = fundamentalCurrency(facts, manifest.cutoff);
    const rows = parseFundamentalQuarters(facts, manifest.cutoff, currency), latest = rows.at(-1);
    expect(currency).toBe(issuer.currency);
    expect(latest).toMatchObject({ periodEnd: issuer.expected.period, revenue: { value: issuer.expected.revenue }, netIncome: { value: issuer.expected.netIncome } });
    expect(rows.every(q => q.periodEnd < manifest.cutoff && [q.revenue, q.netIncome].every(m => !m || m.sources.every(s => s.filed < manifest.cutoff)))).toBe(true);
    for (const doc of issuer.documents) {
      const relabeled = { ...doc.context, accn: "0000098765-25-123456" } as FilingContext;
      const anonymous = readFundamentalDocument(fixture(doc.file), relabeled);
      expect(Object.values(anonymous.facts).flat().length).toBeGreaterThan(0);
    }
  });
});
