import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  assetTypeSchema,
  executionImportSchema,
  positionImportSchema,
  snapshotImportSchema,
  type ExecutionImport,
  type PositionImport,
  type SnapshotImport,
} from "@/lib/import/schemas";
import { isExcludedFxPairSymbol } from "@/lib/import/fx-exclusions";

export type FileKind = "executions" | "positions" | "snapshots" | "unknown";

type HeaderMap = Record<string, string | null>;

type PreviewRow = Record<string, string>;

export interface FilePreview {
  filename: string;
  kind: FileKind;
  headers: string[];
  mapping: HeaderMap;
  rows: PreviewRow[];
  totalRows: number;
  errors: string[];
}

export interface ParsedRowError {
  rowNumber: number;
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  rawRow: PreviewRow;
}

export interface ParsedImport {
  kind: Exclude<FileKind, "unknown">;
  executions: ExecutionImport[];
  positions: PositionImport[];
  snapshots: SnapshotImport[];
  rawRowCount: number;
  rowErrors: ParsedRowError[];
  sourceDispositions?: {
    idealFxExcluded?: number;
    flexCommissions?: {
      seen: number;
      matched: number;
      excluded: number;
      unmatched: number;
      ambiguous: number;
    };
  };
}

const executionAliases: Record<string, string[]> = {
  account: ["account", "accountid", "ibkraccount", "acct", "clientaccountid"],
  executedAt: ["datetime", "date/time", "date", "tradetime", "time", "datetime"],
  symbol: ["symbol", "underlyingsymbol", "ticker"],
  exchange: ["exchange", "listingexchange"],
  assetType: ["assettype", "sectype", "securitytype", "assetclass"],
  side: ["side", "buy/sell", "action"],
  quantity: ["quantity", "qty", "shares", "filled"],
  price: ["price", "tradeprice", "avgprice"],
  commission: ["commission", "comm", "ibcommission"],
  // Flex trade rows often carry commission under IBCommission.
  // Commission details section provides TotalCommission, merged separately.
  fees: ["fees", "fee", "taxes"],
  currency: ["currency", "curr"],
  orderId: ["iborderid", "brokerageorderid", "orderid", "order id", "orderreference"],
  strategy: ["strategy", "setup", "system"],
};

const positionAliases: Record<string, string[]> = {
  account: ["account", "accountid", "ibkraccount", "acct", "clientaccountid"],
  symbol: ["symbol", "underlyingsymbol", "ticker"],
  exchange: ["exchange", "listingexchange"],
  assetType: ["assettype", "sectype", "securitytype", "assetclass"],
  reportDate: ["reportdate", "date"],
  quantity: ["quantity", "qty", "position", "positionqty"],
  avgCost: ["avgcost", "averagecost", "costbasis", "averageprice", "costbasisprice", "openprice"],
  unrealizedPnl: ["unrealizedpnl", "upl", "unrealizedpl", "fifopnlunrealized"],
  currency: ["currency", "curr"],
};

const snapshotAliases: Record<string, string[]> = {
  account: ["account", "accountid", "ibkraccount", "acct"],
  date: ["date", "day"],
  equity: ["equity", "netliquidation", "netliq", "accountvalue"],
  realizedPnl: ["realizedpnl", "realizedpl", "rpl"],
  unrealizedPnl: ["unrealizedpnl", "unrealizedpl", "upl"],
  currency: ["currency", "curr"],
};

const inferKind = (headers: string[]): FileKind => {
  const normalized = new Set(headers.map(normalizeHeader));
  const hasAny = (candidates: string[]) => candidates.some((candidate) => normalized.has(candidate));
  const hasTrade = hasAny(["buy/sell", "action", "tradeprice", "datetime", "tradetime", "execid", "tradeid"]);
  const hasPosition = hasAny(["avgcost", "averagecost", "position", "positionqty", "costbasisprice", "reportdate"]);
  const hasSnapshot = hasAny(["netliquidation", "netliq", "equity", "accountvalue"]);

  if (hasPosition) return "positions";
  if (hasSnapshot) return "snapshots";
  if (hasTrade || (normalized.has("price") && normalized.has("quantity"))) return "executions";
  return "unknown";
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, "");
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[,$]/g, "").trim();
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function utcDateFromParts(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return undefined;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return date;
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  const isoLocal = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLocal) {
    const [, yyyy, mm, dd, hh = "0", min = "0", ss = "0"] = isoLocal;
    return utcDateFromParts(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(min), Number(ss));
  }

  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, mm, dd, yyyy, hh = "0", min = "0", ss = "0"] = match;
    return utcDateFromParts(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(min), Number(ss));
  }

  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2})?)?$/);
  if (compact) {
    const [, yyyy, mm, dd, hh = "0", min = "0", ss = "0"] = compact;
    return utcDateFromParts(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(min), Number(ss));
  }

  const explicitZone = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (explicitZone) {
    const [, yyyy, mm, dd, hh, min, ss = "0"] = explicitZone;
    if (!utcDateFromParts(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(min), Number(ss))) {
      return undefined;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
  }

  return undefined;
}

function parseAssetType(raw: string | undefined) {
  const upper = (raw ?? "STOCK").trim().toUpperCase();
  const aliases: Record<string, z.infer<typeof assetTypeSchema>> = {
    STK: "STOCK",
    OPT: "OPTION",
    FUT: "FUTURE",
    CASH: "FOREX",
    FX: "FOREX",
  };
  const normalized = aliases[upper] ?? upper;
  return assetTypeSchema.safeParse(normalized).success ? (normalized as z.infer<typeof assetTypeSchema>) : "OTHER";
}

function parseSide(raw: string | undefined): "BUY" | "SELL" | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toUpperCase();
  if (["BUY", "BOT", "B"].includes(normalized)) return "BUY";
  if (["SELL", "SLD", "S"].includes(normalized)) return "SELL";
  return undefined;
}

function detectMapping(headers: string[], aliases: Record<string, string[]>): HeaderMap {
  const map: HeaderMap = {};
  const normalizedHeaders = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));

  for (const [field, candidates] of Object.entries(aliases)) {
    const found = candidates
      .map(normalizeHeader)
      .map((candidate) => normalizedHeaders.find((header) => header.normalized === candidate))
      .find(Boolean);
    map[field] = found?.original ?? null;
  }

  return map;
}

function rowsFromCsv(csvText: string): PreviewRow[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "")])),
  );
}

function readField(row: PreviewRow, mapping: HeaderMap, field: string): string | undefined {
  const mapped = mapping[field];
  if (!mapped) return undefined;
  return row[mapped];
}

function readFieldByHeaderAliases(row: PreviewRow, aliases: string[]): string | undefined {
  const values = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  for (const alias of aliases.map(normalizeHeader)) {
    if (values.has(alias)) return values.get(alias);
  }
  return undefined;
}

function readLegacyExecutionIdentity(row: PreviewRow) {
  const aliases = ["orderid", "tradeid", "execid", "iborderid", "brokerageorderid"];
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key)) && value.trim()) return value.trim();
  }
  return undefined;
}

function validationMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

function parseExecutionRows(rows: PreviewRow[], mapping: HeaderMap): {
  parsed: ExecutionImport[];
  rowErrors: ParsedRowError[];
  idealFxExcluded: number;
} {
  const parsed: ExecutionImport[] = [];
  const rowErrors: ParsedRowError[] = [];
  let idealFxExcluded = 0;

  for (const [index, row] of rows.entries()) {
    const symbol = (readField(row, mapping, "symbol") ?? "").trim();
    const rawAssetClass = (readField(row, mapping, "assetType") ?? "").trim().toUpperCase();
    const explicitExchange = readFieldByHeaderAliases(row, ["exchange"]);
    const mappedExchange = readField(row, mapping, "exchange");
    const exchange = (explicitExchange ?? mappedExchange ?? "").trim() || undefined;
    const isForexLike =
      (exchange ?? "").toUpperCase() === "IDEALFX" ||
      ((rawAssetClass === "CASH" || rawAssetClass === "FOREX") && isExcludedFxPairSymbol(symbol));
    if (isForexLike) {
      idealFxExcluded += 1;
      continue;
    }

    const rawQty = parseNumber(readField(row, mapping, "quantity"));
    const parsedSide = parseSide(readField(row, mapping, "side"));
    const inferredSide =
      parsedSide ?? (typeof rawQty === "number" ? (rawQty < 0 ? "SELL" : rawQty > 0 ? "BUY" : undefined) : undefined);
    const normalizedQty = typeof rawQty === "number" ? Math.abs(rawQty) : undefined;

    const ibExecId = (readFieldByHeaderAliases(row, ["ibexecid", "execid"]) ?? "").trim() || undefined;
    const tradeId = (readFieldByHeaderAliases(row, ["tradeid"]) ?? "").trim() || undefined;
    const transactionId = (readFieldByHeaderAliases(row, ["transactionid", "transaction id"]) ?? "").trim() || undefined;
    const externalExecutionId =
      (readFieldByHeaderAliases(row, ["extexecid", "externalexecutionid"]) ?? "").trim() || undefined;
    const sourceExecutionId = ibExecId ?? tradeId ?? transactionId ?? externalExecutionId;
    const sourceExecutionIdKind = ibExecId
      ? "ibexecid"
      : tradeId
        ? "tradeid"
        : transactionId
          ? "transactionid"
          : externalExecutionId
            ? "extexecid"
            : undefined;
    const rawCommission = parseNumber(readField(row, mapping, "commission"));
    const rawFees = parseNumber(readField(row, mapping, "fees"));

    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      executedAt: parseDate(readField(row, mapping, "executedAt")),
      symbol,
      exchange,
      assetType: parseAssetType(readField(row, mapping, "assetType")),
      side: inferredSide,
      quantity: normalizedQty,
      price: parseNumber(readField(row, mapping, "price")),
      commission: rawCommission == null ? undefined : Math.abs(rawCommission),
      fees: rawFees == null ? undefined : Math.abs(rawFees),
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
      orderId: (readField(row, mapping, "orderId") ?? "").trim() || undefined,
      sourceExecutionId,
      sourceExecutionIdKind,
      ibExecId,
      tradeId,
      transactionId,
      legacyIdentityId: readLegacyExecutionIdentity(row),
      strategy: (readField(row, mapping, "strategy") ?? "").trim() || undefined,
    };

    const validation = executionImportSchema.safeParse(candidate);
    if (validation.success) {
      parsed.push(validation.data);
    } else {
      rowErrors.push({
        rowNumber: index + 2,
        severity: "ERROR",
        code: "EXECUTION_ROW_INVALID",
        message: validationMessage(validation.error),
        rawRow: row,
      });
    }
  }

  return { parsed, rowErrors, idealFxExcluded };
}

function parsePositionRows(rows: PreviewRow[], mapping: HeaderMap): {
  parsed: PositionImport[];
  rowErrors: ParsedRowError[];
} {
  const parsed: PositionImport[] = [];
  const rowErrors: ParsedRowError[] = [];

  for (const [index, row] of rows.entries()) {
    const rawReportDate = readField(row, mapping, "reportDate");
    const reportDate = parseDate(rawReportDate);
    if (rawReportDate?.trim() && !reportDate) {
      rowErrors.push({
        rowNumber: index + 2,
        severity: "ERROR",
        code: "POSITION_ROW_INVALID",
        message: "reportDate: Invalid or unsupported calendar date",
        rawRow: row,
      });
      continue;
    }

    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      symbol: (readField(row, mapping, "symbol") ?? "").trim(),
      exchange: (readField(row, mapping, "exchange") ?? "").trim() || undefined,
      assetType: parseAssetType(readField(row, mapping, "assetType")),
      reportDate,
      quantity: parseNumber(readField(row, mapping, "quantity")),
      avgCost: parseNumber(readField(row, mapping, "avgCost")),
      unrealizedPnl: parseNumber(readField(row, mapping, "unrealizedPnl")),
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
    };

    const validation = positionImportSchema.safeParse(candidate);
    if (validation.success) {
      parsed.push(validation.data);
    } else {
      rowErrors.push({
        rowNumber: index + 2,
        severity: "ERROR",
        code: "POSITION_ROW_INVALID",
        message: validationMessage(validation.error),
        rawRow: row,
      });
    }
  }

  return { parsed, rowErrors };
}

function parseSnapshotRows(rows: PreviewRow[], mapping: HeaderMap): {
  parsed: SnapshotImport[];
  rowErrors: ParsedRowError[];
} {
  const parsed: SnapshotImport[] = [];
  const rowErrors: ParsedRowError[] = [];

  for (const [index, row] of rows.entries()) {
    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      date: parseDate(readField(row, mapping, "date")),
      equity: parseNumber(readField(row, mapping, "equity")),
      realizedPnl: parseNumber(readField(row, mapping, "realizedPnl")),
      unrealizedPnl: parseNumber(readField(row, mapping, "unrealizedPnl")),
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
    };

    const validation = snapshotImportSchema.safeParse(candidate);
    if (validation.success) {
      parsed.push(validation.data);
    } else {
      rowErrors.push({
        rowNumber: index + 2,
        severity: "ERROR",
        code: "SNAPSHOT_ROW_INVALID",
        message: validationMessage(validation.error),
        rawRow: row,
      });
    }
  }

  return { parsed, rowErrors };
}

export function previewCsv(filename: string, csvText: string): FilePreview {
  const rows = rowsFromCsv(csvText);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const kind = inferKind(headers);

  if (kind === "unknown") {
    return {
      filename,
      kind,
      headers,
      mapping: {},
      rows: rows.slice(0, 5),
      totalRows: rows.length,
      errors: ["Could not detect file type. Map columns manually and retry."],
    };
  }

  const aliases =
    kind === "executions" ? executionAliases : kind === "positions" ? positionAliases : snapshotAliases;
  const mapping = detectMapping(headers, aliases);

  const requiredFields =
    kind === "executions"
      ? ["executedAt", "symbol", "side", "quantity", "price"]
      : kind === "positions"
        ? ["symbol", "quantity", "avgCost"]
        : ["date"];

  const errors = requiredFields
    .filter((field) => !mapping[field])
    .map((field) => `Missing required mapping for ${field}`);

  return {
    filename,
    kind,
    headers,
    mapping,
    rows: rows.slice(0, 5),
    totalRows: rows.length,
    errors,
  };
}

export function parseCsvWithMapping(
  kind: Exclude<FileKind, "unknown">,
  csvText: string,
  mappingOverride?: HeaderMap,
): ParsedImport {
  const rows = rowsFromCsv(csvText);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const aliases =
    kind === "executions" ? executionAliases : kind === "positions" ? positionAliases : snapshotAliases;
  const mapping = {
    ...detectMapping(headers, aliases),
    ...(mappingOverride ?? {}),
  };

  const parsed: ParsedImport = {
    kind,
    executions: [],
    positions: [],
    snapshots: [],
    rawRowCount: rows.length,
    rowErrors: [],
  };

  if (kind === "executions") {
    const result = parseExecutionRows(rows, mapping);
    parsed.executions = result.parsed;
    parsed.rowErrors = result.rowErrors;
    parsed.sourceDispositions = { idealFxExcluded: result.idealFxExcluded };
  }

  if (kind === "positions") {
    const result = parsePositionRows(rows, mapping);
    parsed.positions = result.parsed;
    parsed.rowErrors = result.rowErrors;
  }

  if (kind === "snapshots") {
    const result = parseSnapshotRows(rows, mapping);
    parsed.snapshots = result.parsed;
    parsed.rowErrors = result.rowErrors;
  }

  return parsed;
}
