import fs from "node:fs";
import path from "node:path";
import { parseCsvWithMapping, previewCsv } from "@/lib/import/ibkr-parser";

describe("IBKR parser", () => {
  it("detects and parses execution csv", () => {
    const csv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-executions.csv"), "utf-8");
    const preview = previewCsv("sample-ibkr-executions.csv", csv);

    expect(preview.kind).toBe("executions");
    expect(preview.errors).toHaveLength(0);

    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);
    expect(parsed.executions).toHaveLength(5);
    expect(parsed.executions[0].symbol).toBe("SPY");
  });

  it("parses positions and snapshots", () => {
    const posCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-positions.csv"), "utf-8");
    const snapCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-snapshots.csv"), "utf-8");

    const posPreview = previewCsv("sample-ibkr-positions.csv", posCsv);
    const snapPreview = previewCsv("sample-ibkr-snapshots.csv", snapCsv);

    const positions = parseCsvWithMapping("positions", posCsv, posPreview.mapping);
    const snapshots = parseCsvWithMapping("snapshots", snapCsv, snapPreview.mapping);

    expect(positions.positions[0].symbol).toBe("TSLA");
    expect(snapshots.snapshots).toHaveLength(3);
  });

  it("omits execution rows from IDEALFX exchange", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-01-02 10:00:00,EUR.USD,IDEALFX,FOREX,BUY,1000,1.05,1.00",
      "U1,2026-01-02 10:01:00,AAPL,NASDAQ,STK,BUY,1,190.5,0.5",
    ].join("\n");

    const preview = previewCsv("fx-filter.csv", csv);
    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);

    expect(parsed.executions).toHaveLength(1);
    expect(parsed.executions[0].symbol).toBe("AAPL");
    expect(parsed.executions[0].exchange).toBe("NASDAQ");
  });

  it("omits IDEALFX even when ListingExchange appears before Exchange", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,ListingExchange,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-01-02 10:00:00,USD.SGD,,IDEALFX,CASH,SELL,1000,1.35,0.8",
      "U1,2026-01-02 10:01:00,MSFT,NASDAQ,NASDAQ,STK,BUY,1,420.5,0.5",
    ].join("\n");

    const preview = previewCsv("fx-listing-exchange.csv", csv);
    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);

    expect(parsed.executions).toHaveLength(1);
    expect(parsed.executions[0].symbol).toBe("MSFT");
  });
});
