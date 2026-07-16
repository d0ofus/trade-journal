import { parse as parseSync } from "csv-parse/sync";
import { parseCsvWithMapping, type ParsedImport } from "@/lib/import/ibkr-parser";
import { isExcludedFxPairSymbol } from "@/lib/import/fx-exclusions";
import type { ExecutionImport } from "@/lib/import/schemas";

type FlexSectionName = "trades" | "positions" | "commissions";
type FlexCode = "TRNT" | "POST" | "UNBC";

export interface FlexSections {
  tradesCsv: string | null;
  positionsCsv: string | null;
  commissionsCsv: string | null;
}

const SECTION_NAMES: FlexSectionName[] = ["trades", "positions", "commissions"];

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, "");
}

function isSectionHeader(line: string, section: FlexSectionName) {
  const trimmed = normalize(line);
  if (!trimmed) return false;

  const singular = section === "trades" ? "trade" : section === "positions" ? "position" : "commission";
  return trimmed === section || trimmed === singular || trimmed.startsWith(`${section},`) || trimmed.startsWith(`${singular},`);
}

function isAnySectionHeader(line: string) {
  return SECTION_NAMES.some((section) => isSectionHeader(line, section));
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(headers: string[], rows: string[][]) {
  const out = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    out.push(row.map((value) => csvEscape(value ?? "")).join(","));
  }
  return out.join("\n");
}

function extractSectionCsvBySimpleLines(lines: string[], section: FlexSectionName): string | null {
  const idx = lines.findIndex((line) => isSectionHeader(line, section));
  if (idx < 0) return null;

  let cursor = idx + 1;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  if (cursor >= lines.length) return null;

  const header = lines[cursor];
  cursor += 1;

  const rows: string[] = [];
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (isAnySectionHeader(line)) break;
    if (line.trim()) rows.push(line);
    cursor += 1;
  }

  if (!header.trim()) return null;
  return [header, ...rows].join("\n");
}

function extractSectionByCode(records: string[][], code: FlexCode): string | null {
  const headerRecord = records.find((row) => row[0] === "HEADER" && row[1] === code);
  if (!headerRecord) return null;

  const headers = headerRecord.slice(2);
  const dataRows = records
    .filter((row) => row[0] === "DATA" && row[1] === code)
    .map((row) => {
      const values = row.slice(2);
      if (values.length < headers.length) {
        return [...values, ...Array.from({ length: headers.length - values.length }, () => "")];
      }
      return values.slice(0, headers.length);
    });

  return toCsv(headers, dataRows);
}

function detectFlexCodeFormat(records: string[][]) {
  return records.some((row) => row[0] === "HEADER" && ["TRNT", "POST", "UNBC"].includes(row[1] ?? ""));
}

function toRows(csvText: string): Record<string, string>[] {
  return parseSync(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
}

function readByAliases(row: Record<string, string>, aliases: string[]) {
  const values = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? "").trim()]));
  for (const alias of aliases.map(normalizeHeader)) {
    if (values.has(alias)) return values.get(alias) ?? "";
  }
  return "";
}

function parseOptionalNumber(value: string) {
  const cleaned = value.replace(/[,$]/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isIdealFxCommissionRow(row: Record<string, string>) {
  const exchange = readByAliases(row, ["exchange", "listingexchange"]).toUpperCase();
  const assetClass = readByAliases(row, ["assetclass", "assettype", "sectype", "securitytype"]).toUpperCase();
  const symbol = readByAliases(row, ["symbol", "underlyingsymbol"]).toUpperCase();
  return exchange === "IDEALFX" || ((assetClass === "CASH" || assetClass === "FOREX") && isExcludedFxPairSymbol(symbol));
}

export function filterOutIdealFxCommissionRows(rows: Record<string, string>[]) {
  return rows.filter((row) => !isIdealFxCommissionRow(row));
}

function mergeCommissions(executions: ExecutionImport[], commissionsCsv: string | null) {
  const emptyAccounting = { seen: 0, matched: 0, excluded: 0, unmatched: 0, ambiguous: 0 };
  if (!commissionsCsv) return { executions, accounting: emptyAccounting };

  const allRows = toRows(commissionsCsv);
  const accounting = { ...emptyAccounting, seen: allRows.length };
  const chargesByExecution = new Map<number, { commission?: number; fees?: number }>();

  for (const detail of allRows) {
    if (isIdealFxCommissionRow(detail)) {
      accounting.excluded += 1;
      continue;
    }

    const references = [
      { field: "ibExecId" as const, value: readByAliases(detail, ["ibexecid", "execid"]) },
      { field: "tradeId" as const, value: readByAliases(detail, ["tradeid"]) },
      { field: "transactionId" as const, value: readByAliases(detail, ["transactionid"]) },
    ].filter((reference) => reference.value);
    let matches: number[] = [];
    for (const reference of references) {
      matches = executions.flatMap((execution, index) =>
        execution[reference.field] === reference.value ? [index] : [],
      );
      if (matches.length > 0) break;
    }

    if (matches.length === 0) {
      const orderId = readByAliases(detail, ["iborderid", "brokerageorderid", "orderid", "orderreference"]);
      if (orderId) {
        matches = executions.flatMap((execution, index) => (execution.orderId === orderId ? [index] : []));
      }
    }

    if (matches.length === 0) {
      accounting.unmatched += 1;
      continue;
    }
    if (matches.length > 1) {
      accounting.ambiguous += 1;
      continue;
    }

    const index = matches[0];
    const commission = parseOptionalNumber(readByAliases(detail, ["totalcommission", "commission", "ibcommission"]));
    const fees = parseOptionalNumber(readByAliases(detail, ["fees", "fee", "taxes", "tax", "other"]));
    const current = chargesByExecution.get(index) ?? {};
    if (commission != null) current.commission = (current.commission ?? 0) + Math.abs(commission);
    if (fees != null) current.fees = (current.fees ?? 0) + Math.abs(fees);
    chargesByExecution.set(index, current);
    accounting.matched += 1;
  }

  return {
    executions: executions.map((execution, index) => {
      const charges = chargesByExecution.get(index);
      return charges ? { ...execution, ...charges } : execution;
    }),
    accounting,
  };
}

export function splitFlexSections(csvText: string): FlexSections {
  const records = parseSync(csvText, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as string[][];

  if (detectFlexCodeFormat(records)) {
    return {
      tradesCsv: extractSectionByCode(records, "TRNT"),
      positionsCsv: extractSectionByCode(records, "POST"),
      commissionsCsv: extractSectionByCode(records, "UNBC"),
    };
  }

  const lines = csvText.split(/\r?\n/);
  return {
    tradesCsv: extractSectionCsvBySimpleLines(lines, "trades"),
    positionsCsv: extractSectionCsvBySimpleLines(lines, "positions"),
    commissionsCsv: extractSectionCsvBySimpleLines(lines, "commissions"),
  };
}

export function parseFlexStatementCsv(csvText: string): {
  trades: ParsedImport;
  positions: ParsedImport;
  commissionsSeen: number;
} {
  const sections = splitFlexSections(csvText);

  if (!sections.tradesCsv && !sections.positionsCsv) {
    throw new Error("Could not find Trades/Positions sections in Flex CSV.");
  }

  const tradesParsed = sections.tradesCsv
    ? parseCsvWithMapping("executions", sections.tradesCsv)
    : ({
        kind: "executions",
        executions: [],
        positions: [],
        snapshots: [],
        rawRowCount: 0,
        rowErrors: [],
      } satisfies ParsedImport);
  const positionsParsed = sections.positionsCsv
    ? parseCsvWithMapping("positions", sections.positionsCsv)
    : ({
        kind: "positions",
        executions: [],
        positions: [],
        snapshots: [],
        rawRowCount: 0,
        rowErrors: [],
      } satisfies ParsedImport);

  const merged = mergeCommissions(tradesParsed.executions, sections.commissionsCsv);
  const commissionsSeen = merged.accounting.seen;

  return {
    trades: {
      ...tradesParsed,
      executions: merged.executions,
      sourceDispositions: {
        ...tradesParsed.sourceDispositions,
        flexCommissions: merged.accounting,
      },
    },
    positions: positionsParsed,
    commissionsSeen,
  };
}
