import { describe, expect, it } from "vitest";
import { readFundamentalDocument, type FilingContext } from "./sec-fundamentals-document";
import { fundamentalCurrency, mergeFundamentalFacts, parseFundamentalQuarters } from "./sec-fundamentals-parser";
import { testFact } from "./sec-fundamentals-fixtures";

const context: FilingContext = { accn: "0000000999-25-000001", filed: "2025-11-10", form: "6-K", document: "earnings.htm", currency: "EUR", standard: "ifrs-full", fiscalYearEnd: "1231" };
const statement = (currency = "EUR", scale = "millions") => `<h2>Condensed consolidated statements of income (unaudited)</h2><p>${currency} in ${scale}</p><table><tr><th></th><th colspan="2">Three months ended</th></tr><tr><td></td><th>September 30, 2025</th><th>September 30, 2024</th></tr><tr><td>Revenue</td><td>123.5</td><td>100</td></tr><tr><td>Profit for the period</td><td>(8)</td><td>10</td></tr><tr><td>Net profit attributable to owners of the parent</td><td>(7)</td><td>9</td></tr><tr><td>Adjusted net profit</td><td>999</td><td>999</td></tr></table>`;
describe("shared SEC filing document reader", () => {
  it("reads dated GAAP/IFRS tables, currency, scale, losses and owner-attributable profit", () => {
    const { facts } = readFundamentalDocument(statement(), context);
    expect(facts.Revenues.map(f => f.val)).toEqual([123500000, 100000000]);
    expect(facts.NetIncomeLoss.map(f => f.val)).toEqual([-7000000, 9000000]);
    expect(facts.ProfitLoss.map(f => f.val)).toEqual([-8000000, 10000000]);
    expect(facts.NetIncomeLoss[0]).toMatchObject({ currency: "EUR", taxonomy: "ifrs-full", incomeBasis: "owners", source: { kind: "statement", document: "earnings.htm" } });
    expect(Object.values(facts).flat().some(f => f.val === 999000000)).toBe(false);
  });
  it.each(["0000000999-25-000001", "0000099999-25-123456"])("uses document structure rather than issuer identity (%s)", accn => {
    expect(readFundamentalDocument(statement(), { ...context, accn }).facts.Revenues[0].val).toBe(123500000);
  });
  it("does not interpret guidance, segment disclosures or adjusted reconciliations as consolidated statements", () => {
    for (const title of ["Segment revenue", "Revenue outlook and guidance", "Reconciliation of non-GAAP results"]) {
      const html = statement().replace("Condensed consolidated statements of income (unaudited)", title);
      expect(readFundamentalDocument(html, context).facts).toEqual({});
    }
  });
  it("requires currency and accounting identification instead of assuming USD", () => {
    const parsed = readFundamentalDocument(statement().replace("EUR in millions", "in millions"), { ...context, currency: undefined, standard: undefined });
    expect(parsed).toMatchObject({ facts: {}, financial: true, ambiguous: true });
  });
  it("aligns column spans and ignores missing values rather than converting them to zero", () => {
    const html = `<h2>Consolidated statements of operations</h2><p>USD in thousands</p><table><tr><td></td><th colspan="3">Three months ended September 30, 2025</th></tr><tr><td>Net revenues</td><td>$</td><td>120,000</td><td></td></tr><tr><td>Net loss</td><td></td><td>(200</td><td>)</td></tr><tr><td>Net income attributable to the company</td><td></td><td>--</td><td></td></tr></table>`;
    const { facts } = readFundamentalDocument(html, { ...context, currency: "USD", standard: "us-gaap" });
    expect(facts.Revenues[0].val).toBe(120000000);
    expect(facts.ProfitLoss[0].val).toBe(-200000);
    expect(facts.NetIncomeLoss).toBeUndefined();
  });
  it("reads inline XBRL units, scale and signs; excludes segment dimensions", () => {
    const html = `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><xbrli:context id="c"><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:context id="segment"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="x">Europe</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit><ix:nonFraction name="ifrs-full:Revenue" contextRef="c" unitRef="u" scale="6">120</ix:nonFraction><ix:nonFraction name="ifrs-full:ProfitLoss" contextRef="c" unitRef="u" scale="6" sign="-">3</ix:nonFraction><ix:nonFraction name="ifrs-full:Revenue" contextRef="segment" unitRef="u">999</ix:nonFraction></html>`;
    const { facts } = readFundamentalDocument(html, context);
    expect(facts.Revenue).toHaveLength(1); expect(facts.Revenue[0]).toMatchObject({ val: 120000000, currency: "TWD", taxonomy: "ifrs-full" });
    expect(facts.ProfitLoss[0].val).toBe(-3000000);
  });
  it("accepts custom concepts through their consolidated statement labels without guessing their tag names", () => {
    const { facts } = readFundamentalDocument(statement().replace("123.5", '<ix:nonFraction name="custom:UnusualSalesConcept">123.5</ix:nonFraction>'), context);
    expect(facts.Revenues[0].val).toBe(123500000);
    expect(facts.Revenues[0].source?.tag).toBe("statement:Revenues");
  });
  it("does not treat a custom XBRL concept as standard solely because its local name is Revenue", () => {
    const html = '<xbrli:context id="c"><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="custom:Revenue" contextRef="c" unitRef="u">999</ix:nonFraction>';
    expect(readFundamentalDocument(html, context).facts).toEqual({});
  });
  it("retains an unambiguous XBRL unit when no reporting-currency declaration exists", () => {
    const html = '<xbrli:context id="c"><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit><ix:nonFraction name="ifrs-full:Revenue" contextRef="c" unitRef="u">123</ix:nonFraction>';
    const { facts } = readFundamentalDocument(html, { ...context, currency: undefined });
    expect(facts.Revenue[0].reportingCurrency).toBeUndefined();
    expect(fundamentalCurrency(facts, null)).toBe("EUR");
  });
  it("honors declared comma-decimal XBRL transforms and rejects unknown transforms", () => {
    const prefix = '<xbrli:context id="c"><xbrli:period><xbrli:startDate>2025-07-01</xbrli:startDate><xbrli:endDate>2025-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="u"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>';
    const fact = '<ix:nonFraction name="ifrs-full:Revenue" contextRef="c" unitRef="u" format="ixt:num-comma-decimal">1.234,50</ix:nonFraction>';
    expect(readFundamentalDocument(prefix + fact, context).facts.Revenue[0].val).toBe(1234.5);
    expect(readFundamentalDocument(prefix + fact.replace("num-comma-decimal", "unknown-transform"), context).facts).toEqual({});
  });
  it("does not reinterpret unsupported or ambiguous numeric formats through the HTML fallback", () => {
    const unknown = statement().replace('123.5</td>', '<ix:nonFraction format="ixt:unknown">123.5</ix:nonFraction></td>');
    expect(readFundamentalDocument(unknown, context).facts.Revenues.some(f => f.end === "2025-09-30")).toBe(false);
    const comma = statement().replace('123.5</td>', '1.234,50</td>');
    expect(readFundamentalDocument(comma, context).facts.Revenues.some(f => f.end === "2025-09-30")).toBe(false);
  });
  it("filters future and same-day exhibits before fiscal construction and source selection", () => {
    const { facts } = readFundamentalDocument(statement(), context);
    const annual = { ...testFact(400, "2024-01-01", "2024-12-31", "2025-04-01", "FY"), currency: "EUR", taxonomy: "ifrs-full" as const, form: "20-F" };
    const combined = mergeFundamentalFacts(facts, { Revenues: [annual] });
    expect(parseFundamentalQuarters(combined, "2025-11-10")).toEqual([]);
    const rows = parseFundamentalQuarters(combined, "2025-11-11");
    expect(rows.at(-1)).toMatchObject({ periodEnd: "2025-09-30", netIncome: { value: -7000000, incomeBasis: "owners" } });
  });
  it("recognizes Q3 headers only with an established fiscal calendar", () => {
    const html = statement().replace("September 30, 2025", "Q3 2025").replace("September 30, 2024", "Q3 2024");
    expect(readFundamentalDocument(html, context).facts.Revenues[0].end).toBe("2025-09-30");
    expect(readFundamentalDocument(html, { ...context, fiscalYearEnd: undefined }).facts).toEqual({});
  });
  it("uses primary reporting currencies instead of convenience translations", () => {
    const f = testFact(100, "2024-01-01", "2024-12-31", "2025-04-01", "FY");
    expect(fundamentalCurrency({ Revenues: [{ ...f, currency: "USD" }, { ...f, currency: "TWD", reportingCurrency: true }] }, null)).toBe("TWD");
    expect(fundamentalCurrency({ Revenues: [{ ...f, currency: "USD" }, { ...f, currency: "EUR" }] }, null)).toBeNull();
    expect(fundamentalCurrency({ Revenues: [{ ...f, currency: "USD" }, { ...f, filed: "2025-05-01", currency: "EUR", reportingCurrency: false }] }, null)).toBe("USD");
  });
  it("uses statement units even when the preceding release discusses billions in investment", () => {
    const html = '<p>The board approved NT$60 billion in bonds.</p>' + statement("TWD", "thousands");
    expect(readFundamentalDocument(html, { ...context, currency: "TWD" }).facts.Revenues[0].val).toBe(123500);
  });
  it.each([["EURm", 123500000], ["EUR'000", 123500]])("recognizes abbreviated reporting units %s", (units, expected) => {
    const html = statement().replace("EUR in millions", String(units));
    expect(readFundamentalDocument(html, context).facts.Revenues[0].val).toBe(expected);
  });
  it("does not mistake Europe or ALL FIGURES text for a reporting currency", () => {
    const html = '<p>Our business operates in Europe.</p>' + statement().replace("EUR in millions", "ALL FIGURES in thousands");
    expect(readFundamentalDocument(html, { ...context, currency: "USD" }).facts.Revenues[0]).toMatchObject({ val: 123500, currency: "USD" });
  });
  it("never treats common-size statement percentages as currency amounts", () => {
    const html = statement().replace("123.5</td>", '40</td><td>%</td>').replace("100</td>", '35</td><td>%</td>');
    expect(readFundamentalDocument(html, context).facts.Revenues).toBeUndefined();
  });
  it("prefers total net revenues to a net-sales component in the same statement", () => {
    const html = statement().replace('<td>Revenue</td><td>123.5</td><td>100</td>', '<td>Net sales</td><td>120</td><td>90</td></tr><tr><td>Net revenues</td><td>123.5</td><td>100</td>');
    const result = readFundamentalDocument(html, context);
    const annual = { ...testFact(400, "2024-01-01", "2024-12-31", "2025-04-01", "FY"), currency: "EUR", taxonomy: "ifrs-full" as const };
    expect(parseFundamentalQuarters(mergeFundamentalFacts(result.facts, { Revenues: [annual] }), null).at(-1)?.revenue?.value).toBe(123500000);
  });
  it("recognizes total net sales as reported company revenue", () => {
    expect(readFundamentalDocument(statement().replace("<td>Revenue</td>", "<td>Total net sales</td>"), context).facts.SalesRevenueNet[0].val).toBe(123500000);
  });
});
