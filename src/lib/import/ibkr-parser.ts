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

export type FileKind = "executions" | "positions" | "snapshots" | "unknown";

type HeaderMap = Record<string, string | null>;

type PreviewRow = Record<string, string>;

export interface FilePreview {
  filename: string;
  kind: FileKind;
  headers: string[];
  mapping: HeaderMap;
  rows: PreviewRow[];
  errors: string[];
}

export interface ParsedImport {
  kind: Exclude<FileKind, "unknown">;
  executions: ExecutionImport[];
  positions: PositionImport[];
  snapshots: SnapshotImport[];
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
  orderId: ["orderid", "order id", "tradeid", "execid", "iborderid", "brokerageorderid"],
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
  const normalized = headers.map(normalizeHeader);
  const hasTrade = normalized.some((h) => ["buy/sell", "action", "price", "quantity"].includes(h));
  const hasPosition = normalized.some((h) => ["avgcost", "position", "unrealizedpnl"].includes(h));
  const hasSnapshot = normalized.some((h) => ["netliquidation", "equity", "realizedpnl"].includes(h));

  if (hasTrade) return "executions";
  if (hasPosition) return "positions";
  if (hasSnapshot) return "snapshots";
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

function isForexPairSymbol(symbol: string) {
  return /^[A-Z]{3}\.[A-Z]{3}$/i.test(symbol.trim());
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;

  const native = new Date(value);
  if (!Number.isNaN(native.getTime())) {
    return native;
  }

  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, mm, dd, yyyy, hh = "0", min = "0", ss = "0"] = match;
    return new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    );
  }

  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2})?)?$/);
  if (compact) {
    const [, yyyy, mm, dd, hh = "0", min = "0", ss = "0"] = compact;
    return new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    );
  }

  return undefined;
}

function parseAssetType(raw: string | undefined) {
  const upper = (raw ?? "STOCK").trim().toUpperCase();
  return assetTypeSchema.safeParse(upper).success ? (upper as z.infer<typeof assetTypeSchema>) : "OTHER";
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
    const found = normalizedHeaders.find((header) => candidates.includes(header.normalized));
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
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key))) {
      return value;
    }
  }
  return undefined;
}

function parseExecutionRows(rows: PreviewRow[], mapping: HeaderMap): ExecutionImport[] {
  const parsed: ExecutionImport[] = [];

  for (const row of rows) {
    const symbol = (readField(row, mapping, "symbol") ?? "").trim();
    const rawAssetClass = (readField(row, mapping, "assetType") ?? "").trim().toUpperCase();
    const explicitExchange = readFieldByHeaderAliases(row, ["exchange"]);
    const mappedExchange = readField(row, mapping, "exchange");
    const exchange = (explicitExchange ?? mappedExchange ?? "").trim() || undefined;
    const isForexLike =
      (exchange ?? "").toUpperCase() === "IDEALFX" ||
      ((rawAssetClass === "CASH" || rawAssetClass === "FOREX") && isForexPairSymbol(symbol));
    if (isForexLike) {
      continue;
    }

    const rawQty = parseNumber(readField(row, mapping, "quantity"));
    const parsedSide = parseSide(readField(row, mapping, "side"));
    const inferredSide =
      parsedSide ?? (typeof rawQty === "number" ? (rawQty < 0 ? "SELL" : rawQty > 0 ? "BUY" : undefined) : undefined);
    const normalizedQty = typeof rawQty === "number" ? Math.abs(rawQty) : undefined;

    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      executedAt: parseDate(readField(row, mapping, "executedAt")),
      symbol,
      exchange,
      assetType: parseAssetType(readField(row, mapping, "assetType")),
      side: inferredSide,
      quantity: normalizedQty,
      price: parseNumber(readField(row, mapping, "price")),
      commission: parseNumber(readField(row, mapping, "commission")) ?? 0,
      fees: parseNumber(readField(row, mapping, "fees")) ?? 0,
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
      orderId: (readField(row, mapping, "orderId") ?? "").trim() || undefined,
      strategy: (readField(row, mapping, "strategy") ?? "").trim() || undefined,
    };

    const validation = executionImportSchema.safeParse(candidate);
    if (validation.success) parsed.push(validation.data);
  }

  return parsed;
}

function parsePositionRows(rows: PreviewRow[], mapping: HeaderMap): PositionImport[] {
  const parsed: PositionImport[] = [];

  for (const row of rows) {
    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      symbol: (readField(row, mapping, "symbol") ?? "").trim(),
      exchange: (readField(row, mapping, "exchange") ?? "").trim() || undefined,
      assetType: parseAssetType(readField(row, mapping, "assetType")),
      reportDate: parseDate(readField(row, mapping, "reportDate")),
      quantity: parseNumber(readField(row, mapping, "quantity")),
      avgCost: parseNumber(readField(row, mapping, "avgCost")),
      unrealizedPnl: parseNumber(readField(row, mapping, "unrealizedPnl")),
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
    };

    const validation = positionImportSchema.safeParse(candidate);
    if (validation.success) parsed.push(validation.data);
  }

  return parsed;
}

function parseSnapshotRows(rows: PreviewRow[], mapping: HeaderMap): SnapshotImport[] {
  const parsed: SnapshotImport[] = [];

  for (const row of rows) {
    const candidate = {
      account: readField(row, mapping, "account") ?? "DEFAULT",
      date: parseDate(readField(row, mapping, "date")),
      equity: parseNumber(readField(row, mapping, "equity")),
      realizedPnl: parseNumber(readField(row, mapping, "realizedPnl")),
      unrealizedPnl: parseNumber(readField(row, mapping, "unrealizedPnl")),
      currency: (readField(row, mapping, "currency") ?? "USD").trim() || "USD",
    };

    const validation = snapshotImportSchema.safeParse(candidate);
    if (validation.success) parsed.push(validation.data);
  }

  return parsed;
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
  };

  if (kind === "executions") {
    parsed.executions = parseExecutionRows(rows, mapping);
  }

  if (kind === "positions") {
    parsed.positions = parsePositionRows(rows, mapping);
  }

  if (kind === "snapshots") {
    parsed.snapshots = parseSnapshotRows(rows, mapping);
  }

  return parsed;
}
