import crypto from "node:crypto";
import { AssetType, Prisma, Side } from "@prisma/client";
import {
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "@/lib/import/import-history";
import {
  appendVisibleImportNote,
  assertImportAccountingConservesRows,
  createImportAccounting,
  importRowsApplied,
  importRowsNotApplied,
  serializeImportAccounting,
  type ImportAccounting,
} from "@/lib/import/import-accounting";
import type { ParsedImport, ParsedRowError } from "@/lib/import/ibkr-parser";
import { isIntentionalExecutionExclusionOnly } from "@/lib/import/import-preflight";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import type { ExecutionImport, PositionImport } from "@/lib/import/schemas";
import { prisma } from "@/lib/prisma";
import {
  lockPositionImportAccounts,
  type PositionImportLockHooks,
} from "@/lib/server/position-import-lock";

const EXECUTION_CHUNK_SIZE = 500;
const PARSER_VERSION = "2026-06-25-workstation-uplift";

type ImportDb = Prisma.TransactionClient;
type ImportArtifactDb = Pick<Prisma.TransactionClient, "importArtifact">;
type ExecutionImportRow = {
  data: Prisma.ExecutionCreateManyInput;
  legacyDedupeKey: string;
  commissionProvided: boolean;
  feesProvided: boolean;
  strongIdentity: boolean;
};
export type PositionSnapshotImportMode = "partial" | "full";
export type ImportCohortContext = {
  cohortId: string;
  importedAt: Date;
};
export type ImportPositionLockOptions = {
  positionLockHooks?: PositionImportLockHooks;
};
export type ImportParsedFileInput = {
  filename: string;
  parsed: ParsedImport;
  fileType: string;
  rawContent?: string;
  sourceId?: string;
  sourceFilename?: string;
  sourceSection?: string;
  positionSnapshotMode?: PositionSnapshotImportMode;
  parserVersion?: string;
};
export type ImportParsedFileResult = {
  batchId: string;
  rowsSeen: number;
  rowsImported: number;
  rowsSkipped: number;
  rowErrors: number;
  durationMs: number;
  rowsPerSecond: number;
  positionSnapshotMode: PositionSnapshotImportMode | null;
  accounting: ImportAccounting;
};
export type FailedImportCohortItem = {
  filename: string;
  fileType: string;
  rawContent?: string;
  sourceId?: string;
  sourceFilename?: string;
  sourceSection?: string;
  parserVersion?: string;
  rowErrors?: ParsedRowError[];
  rowsSeen: number;
  notes?: string;
  positionSnapshotMode?: PositionSnapshotImportMode;
};
export type FailedImportCohortCause = {
  filename: string;
  message: string;
};
export type ImportFailureStage = "parse" | "preflight" | "apply";

export function createImportCohortContext(importedAt = new Date()): ImportCohortContext {
  return { cohortId: crypto.randomUUID(), importedAt };
}

export function createImportSourceId() {
  return crypto.randomUUID();
}

const POSITION_SNAPSHOT_BATCH_MODE: Record<PositionSnapshotImportMode, "PARTIAL" | "FULL"> = {
  partial: "PARTIAL",
  full: "FULL",
};

function normalizePositionSnapshotMode(mode: PositionSnapshotImportMode | undefined): PositionSnapshotImportMode {
  return mode === "full" ? "full" : "partial";
}

function normalizeSnapshotDate(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function snapshotDateKey(date: Date) {
  return normalizeSnapshotDate(date).toISOString().slice(0, 10);
}

function defaultPositionSnapshotDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function resolvedPositionSnapshotDate(row: PositionImport, defaultDate: Date) {
  return row.reportDate ? normalizeSnapshotDate(row.reportDate) : defaultDate;
}

type ResolvedPositionImportRow = {
  row: PositionImport;
  accountId: string;
  instrumentId: string;
};

async function assertFreshPositionSnapshot(
  db: ImportDb,
  rows: ResolvedPositionImportRow[],
  mode: PositionSnapshotImportMode,
  defaultDate: Date,
) {
  if (rows.length === 0) return;

  const datesByAccount = new Map<string, { account: string; dates: Map<string, Date> }>();
  for (const item of rows) {
    if (mode === "full" && !item.row.reportDate) {
      throw new ImportRejectedError(
        `Full position snapshot for ${item.row.account} requires ReportDate on every row before current positions can be pruned.`,
      );
    }

    const snapshotDate = resolvedPositionSnapshotDate(item.row, defaultDate);
    const key = snapshotDateKey(snapshotDate);
    const existing = datesByAccount.get(item.accountId) ?? { account: item.row.account, dates: new Map<string, Date>() };
    existing.dates.set(key, snapshotDate);
    datesByAccount.set(item.accountId, existing);
  }

  for (const { account, dates } of datesByAccount.values()) {
    if (dates.size > 1) {
      const label = mode === "full" ? "Full" : "Partial";
      throw new ImportRejectedError(
        `${label} position snapshot for ${account} has mixed effective dates (${[...dates.keys()].sort().join(", ")}). Use one account snapshot date per file.`,
      );
    }
  }

  const accountIds = [...datesByAccount.keys()];
  const latestSnapshots = await db.positionSnapshot.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accountIds } },
    _max: { date: true },
  });
  const latestByAccount = new Map(latestSnapshots.map((row) => [row.accountId, row._max.date]));

  for (const [accountId, { account, dates }] of datesByAccount.entries()) {
    const latest = latestByAccount.get(accountId);
    if (!latest) continue;
    const latestDate = normalizeSnapshotDate(latest);
    for (const incoming of dates.values()) {
      if (incoming.getTime() < latestDate.getTime()) {
        const label = mode === "full" ? "Full" : "Partial";
        throw new ImportRejectedError(
          `${label} position snapshot for ${account} is stale: snapshot date ${snapshotDateKey(incoming)} is older than latest known position date ${snapshotDateKey(latestDate)}.`,
        );
      }
    }
  }
}

export class ImportRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRejectedError";
  }
}

function dedupeKey(parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

async function upsertRawImportArtifact(
  db: ImportArtifactDb,
  content: string,
  identity = rawImportArchiveIdentity(content),
) {
  await db.importArtifact.upsert({
    where: { storageKey: identity.rawStorageKey },
    update: {
      rawBytes: identity.rawBytes,
      content,
    },
    create: {
      storageKey: identity.rawStorageKey,
      rawSha256: identity.rawSha256,
      rawBytes: identity.rawBytes,
      content,
    },
  });

  return identity;
}

async function archiveRawImportContent(content?: string) {
  if (content == null) return null;
  return upsertRawImportArtifact(prisma, content);
}

function parsedValidRowCount(parsed: ParsedImport) {
  return parsed.executions.length + parsed.positions.length + parsed.snapshots.length;
}

function summarizeRowErrors(rowErrors: ParsedRowError[]) {
  return rowErrors
    .slice(0, 10)
    .map((error) => `row ${error.rowNumber}: ${error.message}`)
    .join(" | ");
}

function noValidRowsMessage(parsed: ParsedImport) {
  return summarizeRowErrors(parsed.rowErrors) || `No valid ${parsed.kind} rows were parsed.`;
}

const UNSERIALIZABLE_ROW_SENTINEL = JSON.stringify({
  _importAudit: { version: 1, rawRow: "UNSERIALIZABLE" },
});

function serializeImportRowError(error: ParsedRowError) {
  let rawJson = UNSERIALIZABLE_ROW_SENTINEL;
  let usedFallback = false;
  try {
    const serialized = JSON.stringify(error.rawRow);
    if (serialized !== undefined) {
      rawJson = serialized;
    } else {
      usedFallback = true;
    }
  } catch {
    usedFallback = true;
  }

  return {
    data: {
      rowNumber: error.rowNumber,
      severity: error.severity,
      code: error.code,
      message: error.message,
      rawJson,
    },
    usedFallback,
  };
}

async function persistSerializedImportRowErrors(
  db: ImportDb,
  importBatchId: string,
  rowErrors: ReturnType<typeof serializeImportRowError>[],
) {
  for (const chunk of chunked(rowErrors, 500)) {
    await db.importRowError.createMany({
      data: chunk.map((error) => ({ importBatchId, ...error.data })),
    });
  }
}

async function persistImportRowErrors(db: ImportDb, importBatchId: string, rowErrors: ParsedRowError[]) {
  const serialized = rowErrors.map(serializeImportRowError);
  await persistSerializedImportRowErrors(db, importBatchId, serialized);
}

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

function chargeFieldsChanged(
  existing: { commission: number; fees: number },
  incoming: ExecutionImportRow,
) {
  return (
    (incoming.commissionProvided && existing.commission !== incoming.data.commission) ||
    (incoming.feesProvided && existing.fees !== incoming.data.fees)
  );
}

function executionIdentityFieldsMatch(
  existing: {
    accountId: string;
    instrumentId: string;
    executedAt: Date;
    side: Side;
    quantity: number;
    price: number;
    currency: string;
  },
  incoming: Prisma.ExecutionCreateManyInput,
) {
  const incomingExecutedAt =
    incoming.executedAt instanceof Date ? incoming.executedAt : new Date(incoming.executedAt);
  return (
    existing.accountId === incoming.accountId &&
    existing.instrumentId === incoming.instrumentId &&
    existing.executedAt.getTime() === incomingExecutedAt.getTime() &&
    existing.side === incoming.side &&
    existing.quantity === incoming.quantity &&
    existing.price === incoming.price &&
    existing.currency === incoming.currency
  );
}

async function applyExecutionRows(
  db: ImportDb,
  rows: ExecutionImportRow[],
  options: { preserveExistingCharges?: boolean } = {},
) {
  let created = 0;
  let updatedCharges = 0;
  let unchangedDuplicates = 0;

  const collapsed: ExecutionImportRow[] = [];
  const byCanonicalKey = new Map<string, ExecutionImportRow>();
  for (const row of rows) {
    const existing = byCanonicalKey.get(row.data.dedupeKey);
    if (!existing) {
      byCanonicalKey.set(row.data.dedupeKey, row);
      collapsed.push(row);
      continue;
    }
    if (!row.strongIdentity) {
      throw new ImportRejectedError(
        "Two execution rows have the same fallback identity but no distinct execution IDs. Export per-fill IBExecID or TradeID values before retrying.",
      );
    }
    if (JSON.stringify(existing.data) !== JSON.stringify(row.data)) {
      throw new ImportRejectedError(
        `Execution ID ${row.data.dedupeKey.slice(0, 12)} appears more than once with conflicting values in the same import.`,
      );
    }
    unchangedDuplicates += 1;
  }

  const lockKeys = [...new Set(collapsed.flatMap((row) => [row.data.dedupeKey, row.legacyDedupeKey]))].sort();
  for (const key of lockKeys) {
    await db.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS acquired`,
    );
  }

  for (const chunk of chunked(collapsed, EXECUTION_CHUNK_SIZE)) {
    const lookupKeys = [...new Set(chunk.flatMap((row) => [row.data.dedupeKey, row.legacyDedupeKey]))];
    const existingRows = await db.execution.findMany({
      where: { dedupeKey: { in: lookupKeys } },
      select: {
        id: true,
        dedupeKey: true,
        accountId: true,
        instrumentId: true,
        executedAt: true,
        side: true,
        quantity: true,
        price: true,
        currency: true,
        commission: true,
        fees: true,
      },
    });
    const existingByDedupeKey = new Map(existingRows.map((row) => [row.dedupeKey, row]));

    for (const row of chunk) {
      let existing = existingByDedupeKey.get(row.data.dedupeKey);
      const legacy = existingByDedupeKey.get(row.legacyDedupeKey);
      if (!existing && legacy && row.legacyDedupeKey !== row.data.dedupeKey) {
        existing = await db.execution.update({
          where: { id: legacy.id },
          data: { dedupeKey: row.data.dedupeKey },
          select: {
            id: true,
            dedupeKey: true,
            accountId: true,
            instrumentId: true,
            executedAt: true,
            side: true,
            quantity: true,
            price: true,
            currency: true,
            commission: true,
            fees: true,
          },
        });
        existingByDedupeKey.delete(row.legacyDedupeKey);
        existingByDedupeKey.set(row.data.dedupeKey, existing);
      }

      if (!existing) {
        const createdRow = await db.execution.create({
          data: row.data,
          select: {
            id: true,
            dedupeKey: true,
            accountId: true,
            instrumentId: true,
            executedAt: true,
            side: true,
            quantity: true,
            price: true,
            currency: true,
            commission: true,
            fees: true,
          },
        });
        existingByDedupeKey.set(row.data.dedupeKey, createdRow);
        created += 1;
        continue;
      }

      if (!executionIdentityFieldsMatch(existing, row.data)) {
        throw new ImportRejectedError(
          `A matching execution ID has different fill economics (${row.data.dedupeKey.slice(0, 12)}). No existing row was changed.`,
        );
      }

      if (options.preserveExistingCharges || !chargeFieldsChanged(existing, row)) {
        unchangedDuplicates += 1;
        continue;
      }

      const chargeUpdate: Prisma.ExecutionUpdateInput = {};
      if (row.commissionProvided) chargeUpdate.commission = row.data.commission;
      if (row.feesProvided) chargeUpdate.fees = row.data.fees;
      await db.execution.update({ where: { id: existing.id }, data: chargeUpdate });
      updatedCharges += 1;
    }
  }

  return { created, updatedCharges, unchangedDuplicates };
}

function legacyExecutionKey(row: ExecutionImport) {
  return dedupeKey([
    row.account,
    row.executedAt.toISOString(),
    row.symbol,
    row.side,
    String(row.quantity),
    String(row.price),
    row.legacyIdentityId ?? row.orderId ?? "",
  ]);
}

function canonicalExecutionKey(row: ExecutionImport) {
  if (!row.sourceExecutionId) return legacyExecutionKey(row);
  return dedupeKey([
    "ibkr-execution-v2",
    row.account,
    row.sourceExecutionIdKind ?? "execution",
    row.sourceExecutionId,
  ]);
}

async function resolveExecutionRows(db: ImportDb, rows: ExecutionImport[], importBatchId: string) {
  const accountMap = await ensureAccounts(db, rows);
  const instrumentMap = await ensureInstruments(
    db,
    rows.map((row) => ({
      symbol: row.symbol,
      exchange: row.exchange,
      assetType: row.assetType as AssetType,
      currency: row.currency,
    })),
  );
  const resolved = rows.flatMap((row): ExecutionImportRow[] => {
    const account = accountMap.get(row.account);
    const instrument = instrumentMap.get(
      instrumentKey({ symbol: row.symbol, exchange: row.exchange, assetType: row.assetType as AssetType }),
    );
    if (!account || !instrument) return [];
    const data: Prisma.ExecutionCreateManyInput = {
      dedupeKey: canonicalExecutionKey(row),
      accountId: account.id,
      instrumentId: instrument.id,
      importBatchId,
      executedAt: row.executedAt,
      side: row.side as Side,
      quantity: row.quantity,
      price: row.price,
      ...(row.commission != null ? { commission: row.commission } : {}),
      ...(row.fees != null ? { fees: row.fees } : {}),
      currency: row.currency,
      orderId: row.orderId,
      strategy: row.strategy,
    };
    return [{
      data,
      legacyDedupeKey: legacyExecutionKey(row),
      commissionProvided: row.commission != null,
      feesProvided: row.fees != null,
      strongIdentity: Boolean(row.sourceExecutionId),
    }];
  });
  return {
    rows: resolved,
    unresolved: rows.length - resolved.length,
    accountId: resolved[0]?.data.accountId,
  };
}

async function isExactAppliedExecutionReplay(
  db: ImportDb,
  rawSha256: string | undefined,
  fileType: string,
  batchId: string,
) {
  if (!rawSha256) return false;
  const prior = await db.importBatch.findFirst({
    where: {
      id: { not: batchId },
      rawSha256,
      fileType,
      status: { in: ["SUCCEEDED", "ROWS_APPLIED", "MATERIALIZED", "MATERIALIZATION_FAILED"] },
    },
    select: { id: true },
  });
  return Boolean(prior);
}

function finalizeImportAccounting(accounting: ImportAccounting, rowsSeen: number) {
  assertImportAccountingConservesRows(accounting, rowsSeen);
  return {
    rowsImported: importRowsApplied(accounting),
    rowsSkipped: importRowsNotApplied(accounting),
  };
}

async function ensureAccounts(db: ImportDb, rows: Array<{ account: string; currency?: string }>) {
  const byCode = new Map<string, string>();
  for (const row of rows) {
    if (!row.account) continue;
    if (!byCode.has(row.account)) {
      byCode.set(row.account, row.currency ?? "USD");
    }
  }
  const codes = [...byCode.keys()].sort();
  if (codes.length === 0) return new Map<string, { id: string; baseCurrency: string }>();

  await db.account.createMany({
    data: codes.map((accountCode) => ({
      name: accountCode,
      ibkrAccount: accountCode,
      baseCurrency: byCode.get(accountCode) ?? "USD",
    })),
    skipDuplicates: true,
  });

  const accounts = await db.account.findMany({
    where: { ibkrAccount: { in: codes } },
    select: { id: true, ibkrAccount: true, baseCurrency: true },
  });

  const map = new Map<string, { id: string; baseCurrency: string }>();
  for (const account of accounts) {
    map.set(account.ibkrAccount, { id: account.id, baseCurrency: account.baseCurrency });
  }
  return map;
}

type InstrumentSeed = {
  symbol: string;
  exchange?: string;
  assetType: AssetType;
  currency?: string;
};

function instrumentKey(input: InstrumentSeed) {
  return JSON.stringify([input.symbol, input.exchange ?? "", input.assetType]);
}

async function ensureInstruments(db: ImportDb, rows: InstrumentSeed[]) {
  const byKey = new Map<string, InstrumentSeed>();
  for (const row of rows) {
    const key = instrumentKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  const uniqueRows = [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, row]) => row);
  if (uniqueRows.length === 0) return new Map<string, { id: string; currency: string }>();

  await db.instrument.createMany({
    data: uniqueRows.map((row) => ({
      symbol: row.symbol,
      exchange: row.exchange ?? "",
      assetType: row.assetType,
      currency: row.currency ?? "USD",
    })),
    skipDuplicates: true,
  });

  const instruments = await db.instrument.findMany({
    where: {
      OR: uniqueRows.map((row) => ({
        symbol: row.symbol,
        exchange: row.exchange ?? "",
        assetType: row.assetType,
      })),
    },
    select: { id: true, symbol: true, exchange: true, assetType: true, currency: true },
  });

  const map = new Map<string, { id: string; currency: string }>();
  for (const instrument of instruments) {
    map.set(
      instrumentKey({
        symbol: instrument.symbol,
        exchange: instrument.exchange ?? "",
        assetType: instrument.assetType,
      }),
      { id: instrument.id, currency: instrument.currency },
    );
  }

  return map;
}

async function applyPositionImportRows(
  db: ImportDb,
  rows: PositionImport[],
  mode: PositionSnapshotImportMode,
  accounting: ImportAccounting,
) {
  const accountMap = await ensureAccounts(db, rows);
  const instrumentMap = await ensureInstruments(
    db,
    rows.map((row) => ({
      symbol: row.symbol,
      exchange: row.exchange,
      assetType: row.assetType as AssetType,
      currency: row.currency,
    })),
  );

  const resolvedRows = rows
    .map((row): ResolvedPositionImportRow | null => {
      const account = accountMap.get(row.account);
      const instrument = instrumentMap.get(
        instrumentKey({
          symbol: row.symbol,
          exchange: row.exchange,
          assetType: row.assetType as AssetType,
        }),
      );
      if (!account || !instrument) return null;
      return { row, accountId: account.id, instrumentId: instrument.id };
    })
    .filter((row): row is ResolvedPositionImportRow => row !== null);

  accounting.primary.unresolvedReference += rows.length - resolvedRows.length;
  const defaultDate = defaultPositionSnapshotDate();
  await assertFreshPositionSnapshot(db, resolvedRows, mode, defaultDate);

  let accountId: string | undefined;
  const openInstrumentsByAccount = new Map<string, Set<string>>();
  const seenAccounts = new Set<string>();
  const snapshotMembership = new Map<
    string,
    { accountId: string; date: Date; instrumentIds: Set<string> }
  >();

  for (const item of resolvedRows) {
    const { row, accountId: resolvedAccountId, instrumentId } = item;
    accountId = resolvedAccountId;
    seenAccounts.add(resolvedAccountId);

    if (row.quantity === 0) {
      await db.position.deleteMany({
        where: { accountId: resolvedAccountId, instrumentId },
      });
    } else {
      await db.position.upsert({
        where: { accountId_instrumentId: { accountId: resolvedAccountId, instrumentId } },
        update: {
          quantity: row.quantity,
          avgCost: row.avgCost,
          unrealizedPnl: row.unrealizedPnl,
          currency: row.currency,
        },
        create: {
          accountId: resolvedAccountId,
          instrumentId,
          quantity: row.quantity,
          avgCost: row.avgCost,
          unrealizedPnl: row.unrealizedPnl,
          currency: row.currency,
        },
      });

      const openInstruments = openInstrumentsByAccount.get(resolvedAccountId) ?? new Set<string>();
      openInstruments.add(instrumentId);
      openInstrumentsByAccount.set(resolvedAccountId, openInstruments);
    }

    const snapshotDate = resolvedPositionSnapshotDate(row, defaultDate);
    await db.positionSnapshot.upsert({
      where: {
        accountId_instrumentId_date: {
          accountId: resolvedAccountId,
          instrumentId,
          date: snapshotDate,
        },
      },
      update: {
        quantity: row.quantity,
        avgCost: row.avgCost,
        unrealizedPnl: row.unrealizedPnl,
        currency: row.currency,
      },
      create: {
        accountId: resolvedAccountId,
        instrumentId,
        date: snapshotDate,
        quantity: row.quantity,
        avgCost: row.avgCost,
        unrealizedPnl: row.unrealizedPnl,
        currency: row.currency,
      },
    });

    const membershipKey = `${resolvedAccountId}|${snapshotDate.toISOString()}`;
    const membership = snapshotMembership.get(membershipKey) ?? {
      accountId: resolvedAccountId,
      date: snapshotDate,
      instrumentIds: new Set<string>(),
    };
    membership.instrumentIds.add(instrumentId);
    snapshotMembership.set(membershipKey, membership);
    accounting.primary.positionApplied += 1;
  }

  if (mode === "full") {
    for (const seenAccountId of seenAccounts) {
      const openInstrumentIds = [...(openInstrumentsByAccount.get(seenAccountId) ?? new Set<string>())];
      if (openInstrumentIds.length === 0) {
        await db.position.deleteMany({ where: { accountId: seenAccountId } });
      } else {
        await db.position.deleteMany({
          where: {
            accountId: seenAccountId,
            instrumentId: { notIn: openInstrumentIds },
          },
        });
      }
    }

    for (const membership of snapshotMembership.values()) {
      await db.positionSnapshot.deleteMany({
        where: {
          accountId: membership.accountId,
          date: membership.date,
          instrumentId: { notIn: [...membership.instrumentIds] },
        },
      });
    }
  }

  return {
    accountId,
    note:
      mode === "full"
        ? "Positions were treated as a full account snapshot; unmentioned open positions and same-date historical members for accounts in this file were removed."
        : "Positions were treated as a partial snapshot; unmentioned open positions were preserved.",
  };
}

export async function importParsedFile(
  params: ImportParsedFileInput,
  cohort = createImportCohortContext(),
  options: ImportPositionLockOptions = {},
) {
  const startedAtMs = Date.now();
  const rawArchive = await archiveRawImportContent(params.rawContent);
  const positionSnapshotMode = normalizePositionSnapshotMode(params.positionSnapshotMode);
  const sourceId = params.sourceId ?? createImportSourceId();
  const batch = await prisma.importBatch.create({
    data: {
      filename: params.filename,
      fileType: params.fileType,
      status: "STARTED",
      importedAt: cohort.importedAt,
      rawSha256: rawArchive?.rawSha256,
      rawBytes: rawArchive?.rawBytes,
      rawStorageKey: rawArchive?.rawStorageKey,
      parserVersion: params.parserVersion ?? PARSER_VERSION,
      cohortId: cohort.cohortId,
      sourceId,
      sourceFilename: params.sourceFilename ?? params.filename,
      sourceSection: params.sourceSection,
      cohortRole: "MEMBER",
      positionSnapshotMode:
        params.parsed.kind === "positions" ? POSITION_SNAPSHOT_BATCH_MODE[positionSnapshotMode] : undefined,
    },
  });

  try {
    await prisma.$transaction((tx) => persistImportRowErrors(tx, batch.id, params.parsed.rowErrors));

    const validRows = parsedValidRowCount(params.parsed);
    if (validRows === 0 && !isIntentionalExecutionExclusionOnly(params.parsed)) {
      throw new ImportRejectedError(noValidRowsMessage(params.parsed));
    }
    if (params.parsed.kind === "positions" && positionSnapshotMode === "full" && params.parsed.rowErrors.length > 0) {
      throw new ImportRejectedError(
        `Full position snapshots require a clean parse; ${params.parsed.rowErrors.length} row error(s) would make missing positions ambiguous. Fix parser errors or import as a partial position update.`,
      );
    }

    return await prisma.$transaction(async (tx) => {
      const rowsSeen = params.parsed.rawRowCount;
      let rowsImported = 0;
      let rowsSkipped = params.parsed.rowErrors.length;
      let accountId: string | undefined;
      const notes: string[] = [];
      const accounting = createImportAccounting(params.parsed);

      if (params.parsed.rowErrors.length > 0) {
        notes.push(
          `Parser rejected ${params.parsed.rowErrors.length} row(s): ${summarizeRowErrors(params.parsed.rowErrors)}`,
        );
      }

      if (params.parsed.kind === "executions") {
        const exactReplay = await isExactAppliedExecutionReplay(
          tx,
          rawArchive?.rawSha256,
          params.fileType,
          batch.id,
        );
        const resolved = await resolveExecutionRows(tx, params.parsed.executions, batch.id);
        accountId = resolved.accountId;
        accounting.primary.unresolvedReference += resolved.unresolved;
        const executionResult = await applyExecutionRows(tx, resolved.rows, {
          preserveExistingCharges: exactReplay,
        });
        accounting.primary.executionInserted += executionResult.created;
        accounting.primary.executionChargeUpdated += executionResult.updatedCharges;
        accounting.primary.unchangedDuplicate += executionResult.unchangedDuplicates;
        if (exactReplay) {
          notes.push("Exact archived-file retry detected; newer charges on existing executions were preserved.");
        } else if (executionResult.updatedCharges > 0) {
          notes.push(
            `Updated supplied commission or fee values on ${executionResult.updatedCharges.toLocaleString()} existing execution(s).`,
          );
        }
      }

      if (params.parsed.kind === "positions") {
        await lockPositionImportAccounts(
          tx,
          params.parsed.positions.map((row) => row.account),
          options.positionLockHooks,
        );
        const positionResult = await applyPositionImportRows(
          tx,
          params.parsed.positions,
          positionSnapshotMode,
          accounting,
        );
        accountId = positionResult.accountId;
        notes.push(positionResult.note);
      }

      if (params.parsed.kind === "snapshots") {
        const accountMap = await ensureAccounts(tx, params.parsed.snapshots);
        const resolvedRows = params.parsed.snapshots
          .map((row) => {
            const account = accountMap.get(row.account);
            if (!account) return null;
            return { row, accountId: account.id };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        accounting.primary.unresolvedReference += params.parsed.snapshots.length - resolvedRows.length;
        for (const item of resolvedRows) {
          const { row, accountId: resolvedAccountId } = item;
          accountId = resolvedAccountId;

          await tx.dailySnapshot.upsert({
            where: {
              accountId_date: {
                accountId: resolvedAccountId,
                date: new Date(Date.UTC(row.date.getUTCFullYear(), row.date.getUTCMonth(), row.date.getUTCDate())),
              },
            },
            update: {
              equity: row.equity,
              realizedPnl: row.realizedPnl,
              unrealizedPnl: row.unrealizedPnl,
              currency: row.currency,
            },
            create: {
              accountId: resolvedAccountId,
              date: new Date(Date.UTC(row.date.getUTCFullYear(), row.date.getUTCMonth(), row.date.getUTCDate())),
              equity: row.equity,
              realizedPnl: row.realizedPnl,
              unrealizedPnl: row.unrealizedPnl,
              currency: row.currency,
            },
          });

          accounting.primary.dailySnapshotApplied += 1;
        }
      }

      ({ rowsImported, rowsSkipped } = finalizeImportAccounting(accounting, rowsSeen));
      const durationMs = Math.max(1, Date.now() - startedAtMs);
      const rowsPerSecond = Number(((rowsImported / durationMs) * 1000).toFixed(2));
      notes.push(`Import duration: ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`);

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          accountId,
          rowsSeen,
          rowsImported,
          rowsSkipped,
          status: "ROWS_APPLIED",
          notes: serializeImportAccounting(accounting, notes),
        },
      });

      return {
        batchId: batch.id,
        rowsSeen,
        rowsImported,
        rowsSkipped,
        rowErrors: params.parsed.rowErrors.length,
        durationMs,
        rowsPerSecond,
        positionSnapshotMode: params.parsed.kind === "positions" ? positionSnapshotMode : null,
        accounting,
      };
    }, { timeout: 120_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        cohortRole: "DIRECT_FAILURE",
        rowsSeen: params.parsed.rawRowCount,
        rowsImported: 0,
        rowsSkipped: params.parsed.rawRowCount,
        errorMessage: message.slice(0, 2000),
        notes:
          error instanceof ImportRejectedError
            ? "Import was rejected before any rows were committed."
            : `Import failed after ${(Math.max(1, Date.now() - startedAtMs) / 1000).toFixed(2)}s.`,
      },
    });
    throw error;
  }
}

type PreparedAtomicImport = ImportParsedFileInput & {
  rawArchive: ReturnType<typeof rawImportArchiveIdentity> | null;
  resolvedPositionSnapshotMode: PositionSnapshotImportMode;
  startedAtMs: number;
  cohortId: string;
  importedAt: Date;
  sourceId: string;
  sourceFilename: string;
};

function prepareAtomicImport(params: ImportParsedFileInput, cohort: ImportCohortContext): PreparedAtomicImport {
  return {
    ...params,
    rawArchive: params.rawContent == null ? null : rawImportArchiveIdentity(params.rawContent),
    resolvedPositionSnapshotMode: normalizePositionSnapshotMode(params.positionSnapshotMode),
    startedAtMs: Date.now(),
    cohortId: cohort.cohortId,
    importedAt: cohort.importedAt,
    sourceId: params.sourceId ?? createImportSourceId(),
    sourceFilename: params.sourceFilename ?? params.filename,
  };
}

async function createAtomicImportBatch(tx: ImportDb, item: PreparedAtomicImport) {
  return tx.importBatch.create({
    data: {
      filename: item.filename,
      fileType: item.fileType,
      status: "STARTED",
      importedAt: item.importedAt,
      rawSha256: item.rawArchive?.rawSha256,
      rawBytes: item.rawArchive?.rawBytes,
      rawStorageKey: item.rawArchive?.rawStorageKey,
      parserVersion: item.parserVersion ?? PARSER_VERSION,
      cohortId: item.cohortId,
      sourceId: item.sourceId,
      sourceFilename: item.sourceFilename,
      sourceSection: item.sourceSection,
      cohortRole: "MEMBER",
      positionSnapshotMode:
        item.parsed.kind === "positions" ? POSITION_SNAPSHOT_BATCH_MODE[item.resolvedPositionSnapshotMode] : undefined,
    },
  });
}

async function applyAtomicImportRows(
  tx: ImportDb,
  item: PreparedAtomicImport,
  batchId: string,
): Promise<ImportParsedFileResult> {
  await persistImportRowErrors(tx, batchId, item.parsed.rowErrors);

  const validRows = parsedValidRowCount(item.parsed);
  if (validRows === 0 && !isIntentionalExecutionExclusionOnly(item.parsed)) {
    throw new ImportRejectedError(noValidRowsMessage(item.parsed));
  }
  if (item.parsed.kind === "positions" && item.resolvedPositionSnapshotMode === "full" && item.parsed.rowErrors.length > 0) {
    throw new ImportRejectedError(
      `Full position snapshots require a clean parse; ${item.parsed.rowErrors.length} row error(s) would make missing positions ambiguous. Fix parser errors or import as a partial position update.`,
    );
  }

  const rowsSeen = item.parsed.rawRowCount;
  let rowsImported = 0;
  let rowsSkipped = item.parsed.rowErrors.length;
  let accountId: string | undefined;
  const notes: string[] = [];
  const accounting = createImportAccounting(item.parsed);

  if (item.parsed.rowErrors.length > 0) {
    notes.push(`Parser rejected ${item.parsed.rowErrors.length} row(s): ${summarizeRowErrors(item.parsed.rowErrors)}`);
  }

  if (item.parsed.kind === "executions") {
    const exactReplay = await isExactAppliedExecutionReplay(
      tx,
      item.rawArchive?.rawSha256,
      item.fileType,
      batchId,
    );
    const resolved = await resolveExecutionRows(tx, item.parsed.executions, batchId);
    accountId = resolved.accountId;
    accounting.primary.unresolvedReference += resolved.unresolved;
    const executionResult = await applyExecutionRows(tx, resolved.rows, {
      preserveExistingCharges: exactReplay,
    });
    accounting.primary.executionInserted += executionResult.created;
    accounting.primary.executionChargeUpdated += executionResult.updatedCharges;
    accounting.primary.unchangedDuplicate += executionResult.unchangedDuplicates;
    if (exactReplay) {
      notes.push("Exact archived-file retry detected; newer charges on existing executions were preserved.");
    } else if (executionResult.updatedCharges > 0) {
      notes.push(
        `Updated supplied commission or fee values on ${executionResult.updatedCharges.toLocaleString()} existing execution(s).`,
      );
    }
  }

  if (item.parsed.kind === "positions") {
    const positionResult = await applyPositionImportRows(
      tx,
      item.parsed.positions,
      item.resolvedPositionSnapshotMode,
      accounting,
    );
    accountId = positionResult.accountId;
    notes.push(positionResult.note);
  }

  if (item.parsed.kind === "snapshots") {
    const accountMap = await ensureAccounts(tx, item.parsed.snapshots);
    const resolvedRows = item.parsed.snapshots
      .map((row) => {
        const account = accountMap.get(row.account);
        if (!account) return null;
        return { row, accountId: account.id };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    accounting.primary.unresolvedReference += item.parsed.snapshots.length - resolvedRows.length;
    for (const resolved of resolvedRows) {
      const { row, accountId: resolvedAccountId } = resolved;
      accountId = resolvedAccountId;

      await tx.dailySnapshot.upsert({
        where: {
          accountId_date: {
            accountId: resolvedAccountId,
            date: new Date(Date.UTC(row.date.getUTCFullYear(), row.date.getUTCMonth(), row.date.getUTCDate())),
          },
        },
        update: {
          equity: row.equity,
          realizedPnl: row.realizedPnl,
          unrealizedPnl: row.unrealizedPnl,
          currency: row.currency,
        },
        create: {
          accountId: resolvedAccountId,
          date: new Date(Date.UTC(row.date.getUTCFullYear(), row.date.getUTCMonth(), row.date.getUTCDate())),
          equity: row.equity,
          realizedPnl: row.realizedPnl,
          unrealizedPnl: row.unrealizedPnl,
          currency: row.currency,
        },
      });

      accounting.primary.dailySnapshotApplied += 1;
    }
  }

  ({ rowsImported, rowsSkipped } = finalizeImportAccounting(accounting, rowsSeen));
  const durationMs = Math.max(1, Date.now() - item.startedAtMs);
  const rowsPerSecond = Number(((rowsImported / durationMs) * 1000).toFixed(2));
  notes.push(`Import duration: ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`);

  await tx.importBatch.update({
    where: { id: batchId },
    data: {
      accountId,
      rowsSeen,
      rowsImported,
      rowsSkipped,
      status: "ROWS_APPLIED",
      notes: serializeImportAccounting(accounting, notes),
    },
  });

  return {
    batchId,
    rowsSeen,
    rowsImported,
    rowsSkipped,
    rowErrors: item.parsed.rowErrors.length,
    durationMs,
    rowsPerSecond,
    positionSnapshotMode: item.parsed.kind === "positions" ? item.resolvedPositionSnapshotMode : null,
    accounting,
  };
}

export async function importParsedFilesAtomic(
  params: ImportParsedFileInput[],
  cohort = createImportCohortContext(),
  options: ImportPositionLockOptions = {},
): Promise<ImportParsedFileResult[]> {
  if (params.length === 0) return [];

  const prepared = params.map((item) => prepareAtomicImport(item, cohort));
  let directFailure: FailedImportCohortCause | null = null;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const results: ImportParsedFileResult[] = [];
        await lockPositionImportAccounts(
          tx,
          prepared.flatMap((item) =>
            item.parsed.kind === "positions"
              ? item.parsed.positions.map((row) => row.account)
              : [],
          ),
          options.positionLockHooks,
        );
        await ensureAccounts(
          tx,
          prepared.flatMap((item) => [
            ...item.parsed.executions,
            ...item.parsed.positions,
            ...item.parsed.snapshots,
          ]),
        );
        await ensureInstruments(
          tx,
          prepared.flatMap((item) =>
            [...item.parsed.executions, ...item.parsed.positions].map((row) => ({
              symbol: row.symbol,
              exchange: row.exchange,
              assetType: row.assetType as AssetType,
              currency: row.currency,
            })),
          ),
        );
        for (const item of prepared) {
          if (item.rawContent != null && item.rawArchive) {
            await upsertRawImportArtifact(tx, item.rawContent, item.rawArchive);
          }
        }
        for (const item of prepared) {
          try {
            const batch = await createAtomicImportBatch(tx, item);
            results.push(await applyAtomicImportRows(tx, item, batch.id));
          } catch (error) {
            directFailure = {
              filename: item.filename,
              message: error instanceof Error ? error.message : "Import failed.",
            };
            throw error;
          }
        }
        return results;
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    const failures = directFailure
      ? [directFailure]
      : prepared.map((item) => ({ filename: item.filename, message }));
    try {
      await recordFailedImportCohort({
        stage: "apply",
        failures,
        items: prepared.map((item) => ({
          filename: item.filename,
          fileType: item.fileType,
          rawContent: item.rawContent,
          sourceId: item.sourceId,
          sourceFilename: item.sourceFilename,
          sourceSection: item.sourceSection,
          parserVersion: item.parserVersion,
          rowErrors: item.parsed.rowErrors,
          rowsSeen: item.parsed.rawRowCount,
          positionSnapshotMode: item.resolvedPositionSnapshotMode,
          notes:
            directFailure?.filename === item.filename
              ? `Import failed before rows could be committed after ${(Math.max(1, Date.now() - item.startedAtMs) / 1000).toFixed(2)}s.`
              : undefined,
        })),
        cohort,
      });
    } catch (auditError) {
      console.error("Failed to persist the atomic import failure ledger.", auditError);
    }
    throw error;
  }
}

function failureLedgerEnvelope(params: {
  marker: string;
  cohortId: string;
  stage: ImportFailureStage;
  causes: string[];
}) {
  return `${params.marker} cohort=${params.cohortId}; stage=${params.stage}; causes=${params.causes
    .map((cause) => encodeURIComponent(cause))
    .join(",")}`;
}

export async function recordFailedImportCohort(params: {
  items: FailedImportCohortItem[];
  failures: FailedImportCohortCause[];
  stage: ImportFailureStage;
  cohort?: ImportCohortContext;
}) {
  if (params.items.length === 0) return [];
  if (params.failures.length === 0) {
    throw new Error("A failed import cohort requires at least one direct failure.");
  }

  const cohort = params.cohort ?? createImportCohortContext();
  const failureByFilename = new Map(params.failures.map((failure) => [failure.filename, failure.message]));
  const causeFilenames = [...failureByFilename.keys()];
  const prepared = params.items.map((item) => {
    const serializedRowErrors = (item.rowErrors ?? []).map(serializeImportRowError);
    return {
      ...item,
      rowsSeen: Math.max(0, Math.trunc(item.rowsSeen)),
      rawArchive: item.rawContent == null ? null : rawImportArchiveIdentity(item.rawContent),
      sourceId: item.sourceId ?? createImportSourceId(),
      sourceFilename: item.sourceFilename ?? item.filename,
      serializedRowErrors,
      fallbackCount: serializedRowErrors.filter((error) => error.usedFallback).length,
    };
  });

  return prisma.$transaction(
    async (tx) => {
      for (const item of prepared) {
        if (item.rawContent != null && item.rawArchive) {
          await upsertRawImportArtifact(tx, item.rawContent, item.rawArchive);
        }
      }

      const batches = [];
      for (const item of prepared) {
        const directMessage = failureByFilename.get(item.filename);
        const isDirectFailure = directMessage !== undefined;
        const visibleNotes = isDirectFailure
          ? item.notes ?? `Import failed during ${params.stage} before rows could be committed.`
          : `Rolled back because ${causeFilenames.map((filename) => `"${filename}"`).join(", ")} failed. No rows from this file were committed.`;
        const fallbackNote = item.fallbackCount
          ? ` ${item.fallbackCount} row-error payload(s) used a safe audit sentinel because the original value was not serializable.`
          : "";
        const notes = `${failureLedgerEnvelope({
          marker: isDirectFailure ? IMPORT_FAILURE_DIRECT_MARKER : IMPORT_FAILURE_ROLLED_BACK_MARKER,
          cohortId: cohort.cohortId,
          stage: params.stage,
          causes: isDirectFailure ? [item.filename] : causeFilenames,
        })}\n${visibleNotes}${fallbackNote}`.slice(0, 2000);
        const positionSnapshotMode = normalizePositionSnapshotMode(item.positionSnapshotMode);
        const isPositionImport = item.fileType === "positions" || item.fileType === "flex-positions";
        const errorMessage = isDirectFailure
          ? directMessage ?? "Import failed."
          : `Rolled back because a sibling import failed. No rows from ${item.filename} were committed.`;

        const batch = await tx.importBatch.create({
          data: {
            filename: item.filename,
            fileType: item.fileType,
            status: "FAILED",
            importedAt: cohort.importedAt,
            rowsSeen: item.rowsSeen,
            rowsImported: 0,
            rowsSkipped: item.rowsSeen,
            rawSha256: item.rawArchive?.rawSha256,
            rawBytes: item.rawArchive?.rawBytes,
            rawStorageKey: item.rawArchive?.rawStorageKey,
            parserVersion: item.parserVersion ?? PARSER_VERSION,
            cohortId: cohort.cohortId,
            sourceId: item.sourceId,
            sourceFilename: item.sourceFilename,
            sourceSection: item.sourceSection,
            cohortRole: isDirectFailure ? "DIRECT_FAILURE" : "ROLLED_BACK",
            positionSnapshotMode: isPositionImport ? POSITION_SNAPSHOT_BATCH_MODE[positionSnapshotMode] : undefined,
            errorMessage: errorMessage.slice(0, 2000),
            notes,
          },
        });
        await persistSerializedImportRowErrors(tx, batch.id, item.serializedRowErrors);
        batches.push(batch);
      }
      return batches;
    },
    { timeout: 120_000 },
  );
}

export async function recordFailedImportAttempt(params: Omit<FailedImportCohortItem, "rowsSeen"> & {
  message: string;
  rowsSeen?: number;
  cohort?: ImportCohortContext;
}) {
  const { cohort, message, rowsSeen, ...item } = params;
  const batches = await recordFailedImportCohort({
    stage: "parse",
    failures: [{ filename: item.filename, message }],
    items: [{ ...item, rowsSeen: rowsSeen ?? item.rowErrors?.length ?? 0 }],
    cohort,
  });
  return batches[0];
}

function uniqueBatchIds(batchIds: string[]) {
  return [...new Set(batchIds)].filter(Boolean);
}

export async function markImportBatchesMaterialized(batchIds: string[], note?: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  const batches = note
    ? await prisma.importBatch.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, notes: true } })
    : [];
  if (!note) {
    await prisma.importBatch.updateMany({
      where: { id: { in: uniqueIds } },
      data: { status: "MATERIALIZED", errorMessage: null },
    });
    return;
  }
  await prisma.$transaction(
    batches.map((batch) =>
      prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "MATERIALIZED",
          errorMessage: null,
          notes: appendVisibleImportNote(batch.notes, note).slice(0, 2000),
        },
      }),
    ),
  );
}

export async function markImportBatchesMaterializationFailed(batchIds: string[], message: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  const batches = await prisma.importBatch.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, notes: true },
  });
  await prisma.$transaction(
    batches.map((batch) =>
      prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "MATERIALIZATION_FAILED",
          errorMessage: message.slice(0, 2000),
          notes: appendVisibleImportNote(
            batch.notes,
            `Import rows were written, but materialization did not complete: ${message}`,
          ).slice(0, 2000),
        },
      }),
    ),
  );
}

export async function markImportBatchesFailed(batchIds: string[], message: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  await prisma.importBatch.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      status: "FAILED",
      cohortRole: "DIRECT_FAILURE",
      errorMessage: message.slice(0, 2000),
      notes: `Import failed: ${message}`.slice(0, 2000),
    },
  });
}
