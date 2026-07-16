export const IMPORT_FAILURE_DIRECT_MARKER = "[import-history:v1:failed]";
export const IMPORT_FAILURE_ROLLED_BACK_MARKER = "[import-history:v1:rolled-back]";

type ImportHistoryInput = {
  status: string;
  notes?: string | null;
};

export type ImportHistoryPresentation = {
  kind: "default" | "failed" | "rolled-back";
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
  visibleNotes: string | null;
  outcomes: Array<{ key: string; label: string; count: number }>;
};

export function importAccountingOutcomes(accounting: ReturnType<typeof parseImportAccounting>["accounting"]) {
  const primary = accounting?.primary;
  const outcomes = primary
    ? [
        { key: "executionInserted", label: "executions inserted", count: primary.executionInserted },
        { key: "executionChargeUpdated", label: "charge corrections", count: primary.executionChargeUpdated },
        { key: "unchangedDuplicate", label: "unchanged duplicates", count: primary.unchangedDuplicate },
        { key: "idealFxExcluded", label: "IDEALFX excluded", count: primary.idealFxExcluded },
        { key: "parserRejected", label: "parser rejected", count: primary.parserRejected },
        { key: "unresolvedReference", label: "unresolved", count: primary.unresolvedReference },
        { key: "positionApplied", label: "positions applied", count: primary.positionApplied },
        { key: "dailySnapshotApplied", label: "snapshots applied", count: primary.dailySnapshotApplied },
      ].filter((item) => item.count > 0)
    : [];
  const flex = accounting?.flexCommissions;
  if (flex) {
    outcomes.push(
      ...[
        { key: "flexMatched", label: "commission details matched", count: flex.matched },
        { key: "flexExcluded", label: "commission details excluded", count: flex.excluded },
        { key: "flexUnmatched", label: "commission details unmatched", count: flex.unmatched },
        { key: "flexAmbiguous", label: "commission details ambiguous", count: flex.ambiguous },
      ].filter((item) => item.count > 0),
    );
  }
  return outcomes;
}

function stripLedgerEnvelope(notes: string) {
  const newlineIndex = notes.indexOf("\n");
  if (newlineIndex === -1) return null;
  return notes.slice(newlineIndex + 1).trim() || null;
}

export function deriveImportHistoryPresentation(input: ImportHistoryInput): ImportHistoryPresentation {
  const notes = input.notes?.trim() || null;

  if (input.status === "FAILED" && notes?.startsWith(IMPORT_FAILURE_ROLLED_BACK_MARKER)) {
    return {
      kind: "rolled-back",
      label: "Rolled back",
      tone: "warning",
      visibleNotes: stripLedgerEnvelope(notes),
      outcomes: [],
    };
  }

  if (input.status === "FAILED") {
    return {
      kind: "failed",
      label: "Failed",
      tone: "danger",
      visibleNotes: notes?.startsWith(IMPORT_FAILURE_DIRECT_MARKER)
        ? stripLedgerEnvelope(notes)
        : notes,
      outcomes: [],
    };
  }

  const parsed = parseImportAccounting(notes);
  const outcomes = importAccountingOutcomes(parsed.accounting);

  switch (input.status) {
    case "ROWS_APPLIED":
      return { kind: "default", label: "Rows applied", tone: "warning", visibleNotes: parsed.visibleNotes, outcomes };
    case "MATERIALIZED":
    case "SUCCEEDED":
      return { kind: "default", label: "Completed", tone: "success", visibleNotes: parsed.visibleNotes, outcomes };
    case "MATERIALIZATION_FAILED":
      return { kind: "default", label: "Refresh failed", tone: "danger", visibleNotes: parsed.visibleNotes, outcomes };
    case "STARTED":
      return { kind: "default", label: "Started", tone: "warning", visibleNotes: parsed.visibleNotes, outcomes };
    default:
      return { kind: "default", label: input.status, tone: "neutral", visibleNotes: parsed.visibleNotes, outcomes };
  }
}
import { parseImportAccounting } from "@/lib/import/import-accounting";
