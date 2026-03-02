import fs from "node:fs";
import path from "node:path";
import { filterOutIdealFxCommissionRows, parseFlexStatementCsv, splitFlexSections } from "@/lib/import/ibkr-flex";

describe("IBKR flex parser", () => {
  it("splits sectioned CSV", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-flex.csv"), "utf-8");
    const sections = splitFlexSections(csv);

    expect(sections.tradesCsv).toContain("Date/Time");
    expect(sections.positionsCsv).toContain("Avg Cost");
    expect(sections.commissionsCsv).toContain("Commission");
  });

  it("parses trades/positions and merges commissions", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-flex.csv"), "utf-8");
    const parsed = parseFlexStatementCsv(csv);

    expect(parsed.trades.executions).toHaveLength(2);
    expect(parsed.positions.positions).toHaveLength(1);
    expect(parsed.trades.executions[0].commission).toBe(0.8);
    expect(parsed.trades.executions[0].fees).toBe(0.1);
    expect(parsed.commissionsSeen).toBe(2);
  });

  it("parses real IBKR BOS/HEADER/DATA flex sample", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/OpenClaw_-_Trades___Positions.csv"), "utf-8");
    const parsed = parseFlexStatementCsv(csv);

    expect(parsed.trades.executions.length).toBe(9);
    expect(parsed.positions.positions.length).toBe(3);
    expect(parsed.commissionsSeen).toBe(9);
  });

  it("filters IDEALFX commission rows", () => {
    const rows = [
      { Exchange: "IDEALFX", TradeID: "87254631", TotalCommission: "-0.5" },
      { Exchange: "NASDAQ", TradeID: "123", TotalCommission: "-1.0" },
    ];

    const filtered = filterOutIdealFxCommissionRows(rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].TradeID).toBe("123");
  });
});
