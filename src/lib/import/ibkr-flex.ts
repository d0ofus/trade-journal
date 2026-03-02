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
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    const normalizedKey = normalizeHeader(key);
    if (aliases.includes(normalizedKey)) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function parseNumber(value: string) {
  const cleaned = value.replace(/[,$]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (!commissionsCsv || executions.length === 0) return executions;

  const rows = filterOutIdealFxCommissionRows(toRows(commissionsCsv));
  const byOrderId = new Map<string, { commission: number; fees: number }>();

  for (const row of rows) {
    const orderId = readByAliases(row, ["orderid", "orderreference", "tradeid", "transactionid"]);
    if (!orderId) continue;

    const commission = parseNumber(readByAliases(row, ["commission", "ibcommission", "totalcommission"]));
    const fees = parseNumber(readByAliases(row, ["fee", "fees", "tax", "taxes", "other"]));
    const current = byOrderId.get(orderId) ?? { commission: 0, fees: 0 };

    current.commission += Math.abs(commission);
    current.fees += Math.abs(fees);
    byOrderId.set(orderId, current);
  }

  return executions.map((row) => {
    if (!row.orderId) return row;
    const found = byOrderId.get(row.orderId);
    if (!found) return row;

    return {
      ...row,
      commission: found.commission,
      fees: found.fees,
    };
  });
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
    : ({ kind: "executions", executions: [], positions: [], snapshots: [] } satisfies ParsedImport);
  const positionsParsed = sections.positionsCsv
    ? parseCsvWithMapping("positions", sections.positionsCsv)
    : ({ kind: "positions", executions: [], positions: [], snapshots: [] } satisfies ParsedImport);

  const mergedExecutions = mergeCommissions(tradesParsed.executions, sections.commissionsCsv);
  const commissionsSeen = sections.commissionsCsv ? filterOutIdealFxCommissionRows(toRows(sections.commissionsCsv)).length : 0;

  return {
    trades: { ...tradesParsed, executions: mergedExecutions },
    positions: positionsParsed,
    commissionsSeen,
  };
}
