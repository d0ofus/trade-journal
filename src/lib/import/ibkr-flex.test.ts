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
    expect(parsed.trades.executions[0].commission).toBe(0.5);
    expect(parsed.trades.executions[0].fees).toBe(0.05);
    expect(parsed.commissionsSeen).toBe(2);
  });

  it("parses a synthetic IBKR BOS/HEADER/DATA flex sample", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-full-statement.csv"), "utf-8");
    const parsed = parseFlexStatementCsv(csv);

    expect(parsed.trades.executions.length).toBe(9);
    expect(parsed.positions.positions.length).toBe(3);
    expect(parsed.commissionsSeen).toBe(9);
    expect(parsed.trades.sourceDispositions?.flexCommissions?.matched).toBe(9);
    expect(parsed.trades.executions.every((execution) => execution.assetType === "STOCK")).toBe(true);
    expect(parsed.positions.positions.every((position) => position.assetType === "STOCK")).toBe(true);
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

  it("filters cash forex pair commission rows when exchange is blank", () => {
    const rows = [
      { Exchange: "", AssetClass: "CASH", Symbol: "USD.SGD", TradeID: "87254631", TotalCommission: "-0.5" },
      { Exchange: "", AssetClass: "CASH", Symbol: "USD.SGD", TradeID: "87254690", TotalCommission: "-0.5" },
      { Exchange: "NASDAQ", AssetClass: "STK", Symbol: "AAPL", TradeID: "111", TotalCommission: "-1.0" },
    ];

    const filtered = filterOutIdealFxCommissionRows(rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].TradeID).toBe("111");
  });

  it("does not copy one parent-order commission onto multiple fills", () => {
    const csv = [
      "Trades",
      "ClientAccountID,Date/Time,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBOrderID,TradeID",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190,PARENT-1,T-1",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190,PARENT-1,T-2",
      "Commissions",
      "OrderID,TotalCommission",
      "PARENT-1,-2.00",
    ].join("\n");

    const parsed = parseFlexStatementCsv(csv);
    expect(parsed.trades.executions).toHaveLength(2);
    expect(parsed.trades.executions.every((execution) => execution.commission == null)).toBe(true);
    expect(parsed.trades.sourceDispositions?.flexCommissions).toEqual({
      seen: 1,
      matched: 0,
      excluded: 0,
      unmatched: 0,
      ambiguous: 1,
    });
  });

  it("matches commission details by TradeID when fills share a parent order", () => {
    const csv = [
      "Trades",
      "ClientAccountID,Date/Time,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBOrderID,TradeID",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190,PARENT-1,T-1",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190,PARENT-1,T-2",
      "Commissions",
      "TradeID,TotalCommission",
      "T-1,-0.75",
      "T-2,-1.25",
    ].join("\n");

    const parsed = parseFlexStatementCsv(csv);
    expect(parsed.trades.executions.map((execution) => execution.commission)).toEqual([0.75, 1.25]);
    expect(parsed.trades.sourceDispositions?.flexCommissions?.matched).toBe(2);
  });
});
