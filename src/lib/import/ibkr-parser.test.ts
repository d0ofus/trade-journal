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
    expect(parsed.executions[0].symbol).toBe("DEMOA");
  });

  it("returns row-level validation errors for malformed execution rows", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,not-a-number,190.5,0.5",
      "U1,2026-01-02 10:01:00,MSFT,NASDAQ,STK,BUY,2,420.5,0.5",
    ].join("\n");

    const preview = previewCsv("invalid-row.csv", csv);
    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);

    expect(parsed.rawRowCount).toBe(2);
    expect(parsed.executions).toHaveLength(1);
    expect(parsed.rowErrors).toHaveLength(1);
    expect(parsed.rowErrors[0]).toMatchObject({
      rowNumber: 2,
      code: "EXECUTION_ROW_INVALID",
      severity: "ERROR",
    });
    expect(parsed.rowErrors[0].message).toContain("quantity");
  });

  it("parses positions and snapshots", () => {
    const posCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-positions.csv"), "utf-8");
    const snapCsv = fs.readFileSync(path.resolve("fixtures/sample-ibkr-snapshots.csv"), "utf-8");

    const posPreview = previewCsv("sample-ibkr-positions.csv", posCsv);
    const snapPreview = previewCsv("sample-ibkr-snapshots.csv", snapCsv);

    expect(posPreview.kind).toBe("positions");
    expect(snapPreview.kind).toBe("snapshots");

    const positions = parseCsvWithMapping("positions", posCsv, posPreview.mapping);
    const snapshots = parseCsvWithMapping("snapshots", snapCsv, snapPreview.mapping);

    expect(positions.positions[0].symbol).toBe("DEMOB");
    expect(snapshots.snapshots).toHaveLength(3);
  });

  it("parses compact position report dates as stable UTC calendar dates", () => {
    const csv = [
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      "U1,AAPL,NASDAQ,STK,20260226,3,190,12,USD",
      "U1,MSFT,NASDAQ,STK,02/27/2026,1,410,5,USD",
    ].join("\n");

    const preview = previewCsv("compact-position-date.csv", csv);
    const parsed = parseCsvWithMapping("positions", csv, preview.mapping);

    expect(parsed.positions.map((position) => position.reportDate?.toISOString().slice(0, 10))).toEqual([
      "2026-02-26",
      "2026-02-27",
    ]);
    expect(parsed.positions.map((position) => position.assetType)).toEqual(["STOCK", "STOCK"]);
  });

  it("rejects impossible and ambiguous dates instead of normalizing them", () => {
    const positionCsv = [
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      "U1,AAPL,NASDAQ,STK,2026-02-31,3,190,12,USD",
      "U1,MSFT,NASDAQ,STK,March 3 2026,1,410,5,USD",
    ].join("\n");
    const executionCsv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-02-31 10:00:00,AAPL,NASDAQ,STK,BUY,1,190.5,0.5",
      "U1,March 3 2026 10:00:00,MSFT,NASDAQ,STK,BUY,1,420.5,0.5",
    ].join("\n");

    const positions = parseCsvWithMapping("positions", positionCsv);
    const executions = parseCsvWithMapping("executions", executionCsv);

    expect(positions.positions).toHaveLength(0);
    expect(positions.rowErrors).toHaveLength(2);
    expect(positions.rowErrors.every((error) => error.message.includes("reportDate"))).toBe(true);
    expect(executions.executions).toHaveLength(0);
    expect(executions.rowErrors).toHaveLength(2);
  });

  it("parses supported execution timestamps as deterministic instants", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-03-03 10:15:30,AAPL,NASDAQ,STK,BUY,1,190.5,0.5",
      "U1,20260303;101531,MSFT,NASDAQ,STK,BUY,1,420.5,0.5",
      "U1,2026-03-03T10:15:32+11:00,NVDA,NASDAQ,STK,BUY,1,700,0.5",
    ].join("\n");

    const parsed = parseCsvWithMapping("executions", csv);

    expect(parsed.rowErrors).toHaveLength(0);
    expect(parsed.executions.map((execution) => execution.executedAt.toISOString())).toEqual([
      "2026-03-03T10:15:30.000Z",
      "2026-03-03T10:15:31.000Z",
      "2026-03-02T23:15:32.000Z",
    ]);
    expect(parsed.executions.map((execution) => execution.assetType)).toEqual(["STOCK", "STOCK", "STOCK"]);
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
    expect(parsed.sourceDispositions?.idealFxExcluded).toBe(1);
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

  it("omits forex cash pair rows even when exchange is blank", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-01-02 10:00:00,USD.SGD,,CASH,SELL,1000,1.35,0.8",
      "U1,2026-01-02 10:01:00,NVDA,NASDAQ,STK,BUY,1,700.0,0.5",
    ].join("\n");

    const preview = previewCsv("fx-blank-exchange.csv", csv);
    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);

    expect(parsed.executions).toHaveLength(1);
    expect(parsed.executions[0].symbol).toBe("NVDA");
  });

  it("prefers per-fill IDs over parent order IDs and preserves absent charges", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBOrderID,TradeID,IBExecID",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190.5,PARENT-1,TRADE-1,EXEC-1",
    ].join("\n");

    const parsed = parseCsvWithMapping("executions", csv);
    const execution = parsed.executions[0];

    expect(execution).toMatchObject({
      orderId: "PARENT-1",
      sourceExecutionId: "EXEC-1",
      sourceExecutionIdKind: "ibexecid",
      ibExecId: "EXEC-1",
      tradeId: "TRADE-1",
    });
    expect(execution.commission).toBeUndefined();
    expect(execution.fees).toBeUndefined();
  });

  it("normalizes IBKR negative charges to positive costs", () => {
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Fees",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,1,190.5,-1.25,-0.15",
    ].join("\n");

    const execution = parseCsvWithMapping("executions", csv).executions[0];
    expect(execution.commission).toBe(1.25);
    expect(execution.fees).toBe(0.15);
  });
});
