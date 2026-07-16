import { describe, expect, it } from "vitest";
import {
  appendVisibleImportNote,
  assertImportAccountingConservesRows,
  createImportAccounting,
  parseImportAccounting,
  serializeImportAccounting,
} from "@/lib/import/import-accounting";

describe("import accounting", () => {
  it("round-trips its versioned envelope while keeping notes readable", () => {
    const accounting = createImportAccounting({
      kind: "executions",
      rawRowCount: 2,
      executions: [],
      positions: [],
      snapshots: [],
      rowErrors: [],
      sourceDispositions: { idealFxExcluded: 1 },
    });
    accounting.primary.executionInserted = 1;
    assertImportAccountingConservesRows(accounting, 2);

    const notes = appendVisibleImportNote(serializeImportAccounting(accounting, "Applied safely."), "Refreshed.");
    expect(parseImportAccounting(notes)).toEqual({
      accounting,
      visibleNotes: "Applied safely. Refreshed.",
    });
  });

  it("rejects a disposition ledger that does not conserve source rows", () => {
    const accounting = createImportAccounting({
      kind: "executions",
      rawRowCount: 2,
      executions: [],
      positions: [],
      snapshots: [],
      rowErrors: [],
    });
    accounting.primary.executionInserted = 1;

    expect(() => assertImportAccountingConservesRows(accounting, 2)).toThrow("accounting mismatch");
  });
});
