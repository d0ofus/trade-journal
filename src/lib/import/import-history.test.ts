import { describe, expect, it } from "vitest";

import {
  deriveImportHistoryPresentation,
  importHistoryCohortSummary,
  importHistoryPaginationLabel,
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "@/lib/import/import-history";
import { createImportAccounting, serializeImportAccounting } from "@/lib/import/import-accounting";

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
      outcomes: [],
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

  it("prefers persisted cohort roles over legacy note markers", () => {
    const rolledBack = deriveImportHistoryPresentation({
      status: "FAILED",
      cohortRole: "ROLLED_BACK",
      notes: `${IMPORT_FAILURE_DIRECT_MARKER} old marker\nVisible audit note.`,
    });
    const direct = deriveImportHistoryPresentation({
      status: "FAILED",
      cohortRole: "DIRECT_FAILURE",
      notes: `${IMPORT_FAILURE_ROLLED_BACK_MARKER} old marker\nDirect audit note.`,
    });

    expect(rolledBack.kind).toBe("rolled-back");
    expect(direct.kind).toBe("failed");
  });

  it("does not trust a rollback marker on a non-failed batch", () => {
    const notes = `${IMPORT_FAILURE_ROLLED_BACK_MARKER} unexpected`;
    const result = deriveImportHistoryPresentation({ status: "MATERIALIZED", notes });

    expect(result.kind).toBe("default");
    expect(result.label).toBe("Completed");
    expect(result.visibleNotes).toBe(notes);
  });

  it("turns a successful accounting envelope into concise row dispositions", () => {
    const accounting = createImportAccounting({
      kind: "executions",
      rawRowCount: 3,
      executions: [],
      positions: [],
      snapshots: [],
      rowErrors: [],
    });
    accounting.primary.executionInserted = 1;
    accounting.primary.executionChargeUpdated = 1;
    accounting.primary.unchangedDuplicate = 1;

    const result = deriveImportHistoryPresentation({
      status: "MATERIALIZED",
      notes: serializeImportAccounting(accounting, "Import duration: 0.01s"),
    });

    expect(result.label).toBe("Completed");
    expect(result.visibleNotes).toBe("Import duration: 0.01s");
    expect(result.outcomes).toEqual([
      { key: "executionInserted", label: "executions inserted", count: 1 },
      { key: "executionChargeUpdated", label: "charge corrections", count: 1 },
      { key: "unchangedDuplicate", label: "unchanged duplicates", count: 1 },
    ]);
  });
});

describe("import history grouping labels", () => {
  it("summarizes records, parent sources, and parsed sections", () => {
    const batch = {
      id: "batch-1",
      filename: "statement.csv::trades",
      fileType: "flex-trades",
      rowsSeen: 1,
      rowsImported: 1,
      rowsSkipped: 0,
      status: "MATERIALIZED",
      errorMessage: null,
      rawSha256: null,
      rawBytes: null,
      rawStorageKey: null,
      parserVersion: "parser",
      positionSnapshotMode: null,
      cohortId: "cohort-1",
      sourceId: "source-1",
      sourceFilename: "statement.csv",
      sourceSection: "trades",
      cohortRole: "MEMBER" as const,
      importedAt: "2026-07-16T00:00:00.000Z",
      notes: null,
      rowErrorCount: 0,
      rowErrors: [],
    };
    const cohort = {
      key: "cohort:cohort-1",
      cohortId: "cohort-1",
      importedAt: batch.importedAt,
      batches: [batch, { ...batch, id: "batch-2", filename: "statement.csv::positions", sourceSection: "positions" }],
    };

    expect(importHistoryCohortSummary(cohort)).toBe("2 records | 1 source | 2 sections");
    expect(importHistoryPaginationLabel(true)).toBe("Older import attempts");
    expect(importHistoryPaginationLabel(false)).toBeNull();
  });
});
