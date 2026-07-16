import { describe, expect, it } from "vitest";
import { importPreflightFailures, parsedValidRowCount } from "@/lib/import/import-preflight";
import type { ParsedImport } from "@/lib/import/ibkr-parser";

function parsedImport(patch: Partial<ParsedImport>): ParsedImport {
  return {
    kind: "executions",
    rawRowCount: 0,
    executions: [],
    positions: [],
    snapshots: [],
    rowErrors: [],
    ...patch,
  };
}

describe("import preflight", () => {
  it("counts valid parsed rows across supported import kinds", () => {
    expect(parsedValidRowCount(parsedImport({ executions: [{} as ParsedImport["executions"][number]] }))).toBe(1);
    expect(parsedValidRowCount(parsedImport({ positions: [{} as ParsedImport["positions"][number]] }))).toBe(1);
    expect(parsedValidRowCount(parsedImport({ snapshots: [{} as ParsedImport["snapshots"][number]] }))).toBe(1);
  });

  it("rejects source sections with raw rows but no valid rows before durable writes start", () => {
    expect(
      importPreflightFailures([
        {
          filename: "activity.flex :: Trades",
          parsed: parsedImport({
            rawRowCount: 1,
            rowErrors: [
              {
                rowNumber: 4,
                severity: "ERROR",
                code: "EXECUTION_ROW_INVALID",
                message: "Quantity is required.",
                rawRow: { Quantity: "" },
              },
            ],
          }),
        },
      ]),
    ).toEqual([{ filename: "activity.flex :: Trades", message: "row 4: Quantity is required." }]);
  });

  it("allows empty sections and partially valid sections", () => {
    expect(
      importPreflightFailures([
        { filename: "empty.csv", parsed: parsedImport({ rawRowCount: 0 }) },
        {
          filename: "partial.csv",
          parsed: parsedImport({
            rawRowCount: 2,
            executions: [{} as ParsedImport["executions"][number]],
            rowErrors: [
              {
                rowNumber: 2,
                severity: "ERROR",
                code: "EXECUTION_ROW_INVALID",
                message: "Bad row.",
                rawRow: {},
              },
            ],
          }),
        },
      ]),
    ).toEqual([]);
  });

  it("allows an execution section made entirely of intentional IDEALFX exclusions", () => {
    expect(
      importPreflightFailures([
        {
          filename: "fx.csv",
          parsed: parsedImport({
            rawRowCount: 2,
            sourceDispositions: { idealFxExcluded: 2 },
          }),
        },
      ]),
    ).toEqual([]);
  });

  it("rejects full position snapshots with parser row errors before durable writes start", () => {
    expect(
      importPreflightFailures([
        {
          filename: "positions.csv",
          positionSnapshotMode: "full",
          parsed: parsedImport({
            kind: "positions",
            rawRowCount: 2,
            positions: [{} as ParsedImport["positions"][number]],
            rowErrors: [
              {
                rowNumber: 3,
                severity: "ERROR",
                code: "POSITION_ROW_INVALID",
                message: "Symbol is required.",
                rawRow: { Symbol: "" },
              },
            ],
          }),
        },
      ]),
    ).toEqual([
      {
        filename: "positions.csv",
        message:
          "Full position snapshots require a clean parse; 1 row error(s) would make missing positions ambiguous. Fix parser errors or import as a partial position update.",
      },
    ]);
  });
});
