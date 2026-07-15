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
};

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
    };
  }

  switch (input.status) {
    case "ROWS_APPLIED":
      return { kind: "default", label: "Rows applied", tone: "warning", visibleNotes: notes };
    case "MATERIALIZED":
    case "SUCCEEDED":
      return { kind: "default", label: "Materialized", tone: "success", visibleNotes: notes };
    case "MATERIALIZATION_FAILED":
      return { kind: "default", label: "Needs refresh", tone: "danger", visibleNotes: notes };
    case "STARTED":
      return { kind: "default", label: "Started", tone: "warning", visibleNotes: notes };
    default:
      return { kind: "default", label: input.status, tone: "neutral", visibleNotes: notes };
  }
}
