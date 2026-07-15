import { describe, expect, it } from "vitest";

import {
  deriveImportHistoryPresentation,
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "@/lib/import/import-history";

describe("deriveImportHistoryPresentation", () => {
  it("shows marked direct failures as Failed without leaking the ledger envelope", () => {
    const result = deriveImportHistoryPresentation({
      status: "FAILED",
      notes: `${IMPORT_FAILURE_DIRECT_MARKER} cohort=test; stage=preflight; causes=positions.csv\nThe position file failed validation.`,
    });

    expect(result).toEqual({
      kind: "failed",
      label: "Failed",
      tone: "danger",
      visibleNotes: "The position file failed validation.",
    });
  });

  it("shows marked siblings as Rolled back without claiming they failed parsing", () => {
    const result = deriveImportHistoryPresentation({
      status: "FAILED",
      notes: `${IMPORT_FAILURE_ROLLED_BACK_MARKER} cohort=test; stage=apply; causes=positions.csv\nRolled back because \"positions.csv\" failed. No rows from this file were committed.`,
    });

    expect(result.kind).toBe("rolled-back");
    expect(result.label).toBe("Rolled back");
    expect(result.tone).toBe("warning");
    expect(result.visibleNotes).toBe(
      'Rolled back because "positions.csv" failed. No rows from this file were committed.',
    );
  });

  it("keeps legacy unmarked failures as Failed", () => {
    const result = deriveImportHistoryPresentation({ status: "FAILED", notes: "Legacy failure note." });

    expect(result.kind).toBe("failed");
    expect(result.visibleNotes).toBe("Legacy failure note.");
  });

  it("does not trust a rollback marker on a non-failed batch", () => {
    const notes = `${IMPORT_FAILURE_ROLLED_BACK_MARKER} unexpected`;
    const result = deriveImportHistoryPresentation({ status: "MATERIALIZED", notes });

    expect(result.kind).toBe("default");
    expect(result.label).toBe("Materialized");
    expect(result.visibleNotes).toBe(notes);
  });
});
