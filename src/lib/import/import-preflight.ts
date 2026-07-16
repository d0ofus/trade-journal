import type { ParsedImport } from "@/lib/import/ibkr-parser";

export type PendingImportPreflightItem = {
  filename: string;
  parsed: ParsedImport;
  positionSnapshotMode?: "partial" | "full" | null;
};

export function parsedValidRowCount(parsed: ParsedImport) {
  return parsed.executions.length + parsed.positions.length + parsed.snapshots.length;
}

export function isIntentionalExecutionExclusionOnly(parsed: ParsedImport) {
  return (
    parsed.kind === "executions" &&
    parsed.rawRowCount > 0 &&
    parsed.rowErrors.length === 0 &&
    (parsed.sourceDispositions?.idealFxExcluded ?? 0) === parsed.rawRowCount
  );
}

export function zeroValidRowsMessage(parsed: ParsedImport) {
  const rowErrors = parsed.rowErrors
    .slice(0, 5)
    .map((error) => `row ${error.rowNumber}: ${error.message}`)
    .join(" | ");
  return rowErrors || `No valid ${parsed.kind} rows were parsed.`;
}

export function importPreflightFailures(items: PendingImportPreflightItem[]) {
  const failures: Array<{ filename: string; message: string }> = [];

  for (const item of items) {
    if (
      item.parsed.rawRowCount > 0 &&
      parsedValidRowCount(item.parsed) === 0 &&
      !isIntentionalExecutionExclusionOnly(item.parsed)
    ) {
      failures.push({
        filename: item.filename,
        message: zeroValidRowsMessage(item.parsed),
      });
      continue;
    }

    if (item.parsed.kind === "positions" && item.positionSnapshotMode === "full" && item.parsed.rowErrors.length > 0) {
      failures.push({
        filename: item.filename,
        message: `Full position snapshots require a clean parse; ${item.parsed.rowErrors.length} row error(s) would make missing positions ambiguous. Fix parser errors or import as a partial position update.`,
      });
    }
  }

  return failures;
}
