import type { ParsedImport } from "@/lib/import/ibkr-parser";

export const IMPORT_ACCOUNTING_MARKER = "[import-accounting:v1]";

export type ImportPrimaryDispositions = {
  parserRejected: number;
  idealFxExcluded: number;
  unresolvedReference: number;
  executionInserted: number;
  executionChargeUpdated: number;
  unchangedDuplicate: number;
  positionApplied: number;
  dailySnapshotApplied: number;
};

export type ImportAccounting = {
  version: 1;
  kind: ParsedImport["kind"];
  primary: ImportPrimaryDispositions;
  flexCommissions?: {
    seen: number;
    matched: number;
    excluded: number;
    unmatched: number;
    ambiguous: number;
  };
};

export function createImportAccounting(parsed: ParsedImport): ImportAccounting {
  return {
    version: 1,
    kind: parsed.kind,
    primary: {
      parserRejected: parsed.rowErrors.length,
      idealFxExcluded: parsed.sourceDispositions?.idealFxExcluded ?? 0,
      unresolvedReference: 0,
      executionInserted: 0,
      executionChargeUpdated: 0,
      unchangedDuplicate: 0,
      positionApplied: 0,
      dailySnapshotApplied: 0,
    },
    ...(parsed.sourceDispositions?.flexCommissions
      ? { flexCommissions: parsed.sourceDispositions.flexCommissions }
      : {}),
  };
}

export function accountedPrimaryRows(accounting: ImportAccounting) {
  return Object.values(accounting.primary).reduce((sum, count) => sum + count, 0);
}

export function assertImportAccountingConservesRows(accounting: ImportAccounting, rowsSeen: number) {
  const accounted = accountedPrimaryRows(accounting);
  if (accounted !== rowsSeen) {
    throw new Error(`Import accounting mismatch: ${accounted} disposition(s) for ${rowsSeen} source row(s).`);
  }
}

export function importRowsApplied(accounting: ImportAccounting) {
  const primary = accounting.primary;
  return (
    primary.executionInserted +
    primary.executionChargeUpdated +
    primary.positionApplied +
    primary.dailySnapshotApplied
  );
}

export function importRowsNotApplied(accounting: ImportAccounting) {
  return accountedPrimaryRows(accounting) - importRowsApplied(accounting);
}

export function serializeImportAccounting(accounting: ImportAccounting, visibleNotes: string[] | string = []) {
  const notes = Array.isArray(visibleNotes) ? visibleNotes.filter(Boolean).join(" ") : visibleNotes.trim();
  const envelope = `${IMPORT_ACCOUNTING_MARKER} ${JSON.stringify(accounting)}`;
  return notes ? `${envelope}\n${notes}` : envelope;
}

export function parseImportAccounting(notes: string | null | undefined): {
  accounting: ImportAccounting | null;
  visibleNotes: string | null;
} {
  const value = notes?.trim();
  if (!value?.startsWith(`${IMPORT_ACCOUNTING_MARKER} `)) {
    return { accounting: null, visibleNotes: value || null };
  }

  const newline = value.indexOf("\n");
  const envelope = newline === -1 ? value : value.slice(0, newline);
  const visibleNotes = newline === -1 ? null : value.slice(newline + 1).trim() || null;
  try {
    const accounting = JSON.parse(envelope.slice(IMPORT_ACCOUNTING_MARKER.length + 1)) as ImportAccounting;
    if (accounting.version !== 1 || !accounting.primary) throw new Error("Unsupported accounting envelope.");
    return { accounting, visibleNotes };
  } catch {
    return { accounting: null, visibleNotes: value };
  }
}

export function appendVisibleImportNote(notes: string | null | undefined, note: string) {
  const parsed = parseImportAccounting(notes);
  const visibleNotes = [parsed.visibleNotes, note].filter(Boolean).join(" ");
  return parsed.accounting ? serializeImportAccounting(parsed.accounting, visibleNotes) : visibleNotes;
}
