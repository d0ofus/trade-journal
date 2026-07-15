import crypto from "node:crypto";
import { AssetType, Prisma, Side } from "@prisma/client";
import type { ParsedImport, ParsedRowError } from "@/lib/import/ibkr-parser";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";

const EXECUTION_CHUNK_SIZE = 500;
const PARSER_VERSION = "2026-06-25-workstation-uplift";

type ImportDb = Prisma.TransactionClient;
type ExecutionImportRow = Prisma.ExecutionCreateManyInput;
export type PositionSnapshotImportMode = "partial" | "full";
export type ImportParsedFileInput = {
  filename: string;
  parsed: ParsedImport;
  fileType: string;
  rawContent?: string;
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
};

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

async function assertFreshFullPositionSnapshot(
  db: ImportDb,
  rows: Array<{ row: { account: string; reportDate?: Date }; accountId: string }>,
) {
  if (rows.length === 0) return;

  const datesByAccount = new Map<string, { account: string; dates: Map<string, Date> }>();
  for (const item of rows) {
    if (!item.row.reportDate) {
      throw new ImportRejectedError(
        `Full position snapshot for ${item.row.account} requires ReportDate on every row before current positions can be pruned.`,
      );
    }

    const key = snapshotDateKey(item.row.reportDate);
    const existing = datesByAccount.get(item.accountId) ?? { account: item.row.account, dates: new Map<string, Date>() };
    existing.dates.set(key, normalizeSnapshotDate(item.row.reportDate));
    datesByAccount.set(item.accountId, existing);
  }

  for (const { account, dates } of datesByAccount.values()) {
    if (dates.size > 1) {
      throw new ImportRejectedError(
        `Full position snapshot for ${account} has mixed ReportDate values (${[...dates.keys()].sort().join(", ")}). Use one complete account snapshot date.`,
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
    const incoming = [...dates.values()][0];
    const latest = latestByAccount.get(accountId);
    if (!latest) continue;
    const latestDate = normalizeSnapshotDate(latest);
    if (incoming.getTime() < latestDate.getTime()) {
      throw new ImportRejectedError(
        `Full position snapshot for ${account} is stale: snapshot date ${snapshotDateKey(incoming)} is older than latest known position date ${snapshotDateKey(latestDate)}.`,
      );
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

async function archiveRawImportContent(content?: string) {
  if (content == null) return null;

  const identity = rawImportArchiveIdentity(content);
  await prisma.importArtifact.upsert({
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

async function persistImportRowErrors(db: ImportDb, importBatchId: string, rowErrors: ParsedRowError[]) {
  for (const chunk of chunked(rowErrors, 500)) {
    await db.importRowError.createMany({
      data: chunk.map((error) => ({
        importBatchId,
        rowNumber: error.rowNumber,
        severity: error.severity,
        code: error.code,
        message: error.message,
        rawJson: JSON.stringify(error.rawRow),
      })),
    });
  }
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
  incoming: { commission?: number | null; fees?: number | null },
) {
  return existing.commission !== (incoming.commission ?? 0) || existing.fees !== (incoming.fees ?? 0);
}

async function applyExecutionRows(db: ImportDb, rows: ExecutionImportRow[]) {
  let created = 0;
  let updatedCharges = 0;
  let unchangedDuplicates = 0;

  for (const chunk of chunked(rows, EXECUTION_CHUNK_SIZE)) {
    const existingRows = await db.execution.findMany({
      where: { dedupeKey: { in: chunk.map((row) => row.dedupeKey) } },
      select: { dedupeKey: true, commission: true, fees: true },
    });
    const existingByDedupeKey = new Map(existingRows.map((row) => [row.dedupeKey, row]));
    const rowsToCreate: ExecutionImportRow[] = [];
    const rowsToUpdate: ExecutionImportRow[] = [];

    for (const row of chunk) {
      const existing = existingByDedupeKey.get(row.dedupeKey);
      if (!existing) {
        rowsToCreate.push(row);
      } else if (chargeFieldsChanged(existing, row)) {
        rowsToUpdate.push(row);
      } else {
        unchangedDuplicates += 1;
      }
    }

    if (rowsToCreate.length > 0) {
      const result = await db.execution.createMany({
        data: rowsToCreate,
        skipDuplicates: true,
      });
      created += result.count;
      unchangedDuplicates += rowsToCreate.length - result.count;
    }

    for (const row of rowsToUpdate) {
      await db.execution.update({
        where: { dedupeKey: row.dedupeKey },
        data: {
          commission: row.commission ?? 0,
          fees: row.fees ?? 0,
        },
      });
      updatedCharges += 1;
    }
  }

  return { created, updatedCharges, unchangedDuplicates };
}

async function ensureAccounts(db: ImportDb, rows: Array<{ account: string; currency?: string }>) {
  const byCode = new Map<string, string>();
  for (const row of rows) {
    if (!row.account) continue;
    if (!byCode.has(row.account)) {
      byCode.set(row.account, row.currency ?? "USD");
    }
  }
  const codes = [...byCode.keys()];
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
  return `${input.symbol}|${input.exchange ?? ""}|${input.assetType}`;
}

async function ensureInstruments(db: ImportDb, rows: InstrumentSeed[]) {
  const byKey = new Map<string, InstrumentSeed>();
  for (const row of rows) {
    const key = instrumentKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  const uniqueRows = [...byKey.values()];
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

export async function importParsedFile(params: {
  filename: string;
  parsed: ParsedImport;
  fileType: string;
  rawContent?: string;
  positionSnapshotMode?: PositionSnapshotImportMode;
  parserVersion?: string;
}) {
  const startedAtMs = Date.now();
  const rawArchive = await archiveRawImportContent(params.rawContent);
  const positionSnapshotMode = normalizePositionSnapshotMode(params.positionSnapshotMode);
  const batch = await prisma.importBatch.create({
    data: {
      filename: params.filename,
      fileType: params.fileType,
      status: "STARTED",
      rawSha256: rawArchive?.rawSha256,
      rawBytes: rawArchive?.rawBytes,
      rawStorageKey: rawArchive?.rawStorageKey,
      parserVersion: params.parserVersion ?? PARSER_VERSION,
      positionSnapshotMode:
        params.parsed.kind === "positions" ? POSITION_SNAPSHOT_BATCH_MODE[positionSnapshotMode] : undefined,
    },
  });

  try {
    await prisma.$transaction((tx) => persistImportRowErrors(tx, batch.id, params.parsed.rowErrors));

    const validRows = parsedValidRowCount(params.parsed);
    if (validRows === 0) {
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

      if (params.parsed.rowErrors.length > 0) {
        notes.push(
          `Parser rejected ${params.parsed.rowErrors.length} row(s): ${summarizeRowErrors(params.parsed.rowErrors)}`,
        );
      }

      if (params.parsed.kind === "executions") {
        const accountMap = await ensureAccounts(tx, params.parsed.executions);
        const instrumentMap = await ensureInstruments(
          tx,
          params.parsed.executions.map((row) => ({
            symbol: row.symbol,
            exchange: row.exchange,
            assetType: row.assetType as AssetType,
            currency: row.currency,
          })),
        );

        const executionRows = params.parsed.executions
          .map((row) => {
            const account = accountMap.get(row.account);
            if (!account) return null;
            const instrument = instrumentMap.get(
              instrumentKey({
                symbol: row.symbol,
                exchange: row.exchange,
                assetType: row.assetType as AssetType,
              }),
            );
            if (!instrument) return null;
            return {
              dedupeKey: dedupeKey([
                row.account,
                row.executedAt.toISOString(),
                row.symbol,
                row.side,
                String(row.quantity),
                String(row.price),
                row.orderId ?? "",
              ]),
              accountId: account.id,
              instrumentId: instrument.id,
              importBatchId: batch.id,
              executedAt: row.executedAt,
              side: row.side as Side,
              quantity: row.quantity,
              price: row.price,
              commission: row.commission,
              fees: row.fees,
              currency: row.currency,
              orderId: row.orderId,
              strategy: row.strategy,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);
        rowsSkipped += params.parsed.executions.length - executionRows.length;

        if (executionRows.length > 0) {
          accountId = executionRows[0].accountId;
        }

        const executionResult = await applyExecutionRows(tx, executionRows);
        rowsImported += executionResult.created + executionResult.updatedCharges;
        rowsSkipped += executionResult.unchangedDuplicates;
        if (executionResult.updatedCharges > 0) {
          notes.push(
            `Updated commission or fee values on ${executionResult.updatedCharges.toLocaleString()} existing execution(s).`,
          );
        }
      }

      if (params.parsed.kind === "positions") {
        const accountMap = await ensureAccounts(tx, params.parsed.positions);
        const instrumentMap = await ensureInstruments(
          tx,
          params.parsed.positions.map((row) => ({
            symbol: row.symbol,
            exchange: row.exchange,
            assetType: row.assetType as AssetType,
            currency: row.currency,
          })),
        );

        const resolvedRows = params.parsed.positions
          .map((row) => {
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
          .filter((item): item is NonNullable<typeof item> => item !== null);

        rowsSkipped += params.parsed.positions.length - resolvedRows.length;
        const seenInstrumentsByAccount = new Map<string, Set<string>>();
        const seenAccounts = new Set<string>();

        if (positionSnapshotMode === "full") {
          await assertFreshFullPositionSnapshot(tx, resolvedRows);
        }

        for (const item of resolvedRows) {
          const { row, accountId: resolvedAccountId, instrumentId: resolvedInstrumentId } = item;
          accountId = resolvedAccountId;
          seenAccounts.add(resolvedAccountId);

          if (row.quantity === 0) {
            await tx.position.deleteMany({
              where: { accountId: resolvedAccountId, instrumentId: resolvedInstrumentId },
            });
          } else {
            await tx.position.upsert({
              where: { accountId_instrumentId: { accountId: resolvedAccountId, instrumentId: resolvedInstrumentId } },
              update: {
                quantity: row.quantity,
                avgCost: row.avgCost,
                unrealizedPnl: row.unrealizedPnl,
                currency: row.currency,
              },
              create: {
                accountId: resolvedAccountId,
                instrumentId: resolvedInstrumentId,
                quantity: row.quantity,
                avgCost: row.avgCost,
                unrealizedPnl: row.unrealizedPnl,
                currency: row.currency,
              },
            });

            const seen = seenInstrumentsByAccount.get(resolvedAccountId) ?? new Set<string>();
            seen.add(resolvedInstrumentId);
            seenInstrumentsByAccount.set(resolvedAccountId, seen);
          }

          const snapshotDate = row.reportDate
            ? normalizeSnapshotDate(row.reportDate)
            : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

          await tx.positionSnapshot.upsert({
            where: {
              accountId_instrumentId_date: {
                accountId: resolvedAccountId,
                instrumentId: resolvedInstrumentId,
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
              instrumentId: resolvedInstrumentId,
              date: snapshotDate,
              quantity: row.quantity,
              avgCost: row.avgCost,
              unrealizedPnl: row.unrealizedPnl,
              currency: row.currency,
            },
          });

          rowsImported += 1;
        }

        if (positionSnapshotMode === "full") {
          for (const seenAccountId of seenAccounts) {
            const seenInstruments = [...(seenInstrumentsByAccount.get(seenAccountId) ?? new Set<string>())];
            if (seenInstruments.length === 0) {
              await tx.position.deleteMany({ where: { accountId: seenAccountId } });
              continue;
            }
            await tx.position.deleteMany({
              where: {
                accountId: seenAccountId,
                instrumentId: { notIn: seenInstruments },
              },
            });
          }
          notes.push("Positions were treated as a full account snapshot; unmentioned open positions for accounts in this file were removed.");
        } else {
          notes.push("Positions were treated as a partial snapshot; unmentioned open positions were preserved.");
        }
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

        rowsSkipped += params.parsed.snapshots.length - resolvedRows.length;
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

          rowsImported += 1;
        }
      }

      const durationMs = Math.max(1, Date.now() - startedAtMs);
      const rowsPerSecond = Number(((rowsImported / durationMs) * 1000).toFixed(2));
      if (rowsSkipped) notes.push("Some rows were skipped due to parser validation, unresolved references, or duplicate keys.");
      notes.push(`Import duration: ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`);

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          accountId,
          rowsSeen,
          rowsImported,
          rowsSkipped,
          status: "ROWS_APPLIED",
          notes: notes.join(" "),
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
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "FAILED",
        rowsSeen: params.parsed.rawRowCount,
        rowsImported: 0,
        rowsSkipped: params.parsed.rawRowCount,
        errorMessage: message.slice(0, 2000),
        notes:
          error instanceof ImportRejectedError
            ? "Import failed because no valid rows could be applied."
            : `Import failed after ${(Math.max(1, Date.now() - startedAtMs) / 1000).toFixed(2)}s.`,
      },
    });
    throw error;
  }
}

type PreparedAtomicImport = ImportParsedFileInput & {
  rawArchive: Awaited<ReturnType<typeof archiveRawImportContent>>;
  resolvedPositionSnapshotMode: PositionSnapshotImportMode;
  startedAtMs: number;
};

async function prepareAtomicImport(params: ImportParsedFileInput): Promise<PreparedAtomicImport> {
  return {
    ...params,
    rawArchive: await archiveRawImportContent(params.rawContent),
    resolvedPositionSnapshotMode: normalizePositionSnapshotMode(params.positionSnapshotMode),
    startedAtMs: Date.now(),
  };
}

async function createAtomicImportBatch(tx: ImportDb, item: PreparedAtomicImport) {
  return tx.importBatch.create({
    data: {
      filename: item.filename,
      fileType: item.fileType,
      status: "STARTED",
      rawSha256: item.rawArchive?.rawSha256,
      rawBytes: item.rawArchive?.rawBytes,
      rawStorageKey: item.rawArchive?.rawStorageKey,
      parserVersion: item.parserVersion ?? PARSER_VERSION,
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
  if (validRows === 0) {
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

  if (item.parsed.rowErrors.length > 0) {
    notes.push(`Parser rejected ${item.parsed.rowErrors.length} row(s): ${summarizeRowErrors(item.parsed.rowErrors)}`);
  }

  if (item.parsed.kind === "executions") {
    const accountMap = await ensureAccounts(tx, item.parsed.executions);
    const instrumentMap = await ensureInstruments(
      tx,
      item.parsed.executions.map((row) => ({
        symbol: row.symbol,
        exchange: row.exchange,
        assetType: row.assetType as AssetType,
        currency: row.currency,
      })),
    );

    const executionRows = item.parsed.executions
      .map((row) => {
        const account = accountMap.get(row.account);
        if (!account) return null;
        const instrument = instrumentMap.get(
          instrumentKey({
            symbol: row.symbol,
            exchange: row.exchange,
            assetType: row.assetType as AssetType,
          }),
        );
        if (!instrument) return null;
        return {
          dedupeKey: dedupeKey([
            row.account,
            row.executedAt.toISOString(),
            row.symbol,
            row.side,
            String(row.quantity),
            String(row.price),
            row.orderId ?? "",
          ]),
          accountId: account.id,
          instrumentId: instrument.id,
          importBatchId: batchId,
          executedAt: row.executedAt,
          side: row.side as Side,
          quantity: row.quantity,
          price: row.price,
          commission: row.commission,
          fees: row.fees,
          currency: row.currency,
          orderId: row.orderId,
          strategy: row.strategy,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    rowsSkipped += item.parsed.executions.length - executionRows.length;

    if (executionRows.length > 0) {
      accountId = executionRows[0].accountId;
    }

    const executionResult = await applyExecutionRows(tx, executionRows);
    rowsImported += executionResult.created + executionResult.updatedCharges;
    rowsSkipped += executionResult.unchangedDuplicates;
    if (executionResult.updatedCharges > 0) {
      notes.push(`Updated commission or fee values on ${executionResult.updatedCharges.toLocaleString()} existing execution(s).`);
    }
  }

  if (item.parsed.kind === "positions") {
    const accountMap = await ensureAccounts(tx, item.parsed.positions);
    const instrumentMap = await ensureInstruments(
      tx,
      item.parsed.positions.map((row) => ({
        symbol: row.symbol,
        exchange: row.exchange,
        assetType: row.assetType as AssetType,
        currency: row.currency,
      })),
    );

    const resolvedRows = item.parsed.positions
      .map((row) => {
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
      .filter((row): row is NonNullable<typeof row> => row !== null);

    rowsSkipped += item.parsed.positions.length - resolvedRows.length;
    const seenInstrumentsByAccount = new Map<string, Set<string>>();
    const seenAccounts = new Set<string>();

    if (item.resolvedPositionSnapshotMode === "full") {
      await assertFreshFullPositionSnapshot(tx, resolvedRows);
    }

    for (const resolved of resolvedRows) {
      const { row, accountId: resolvedAccountId, instrumentId: resolvedInstrumentId } = resolved;
      accountId = resolvedAccountId;
      seenAccounts.add(resolvedAccountId);

      if (row.quantity === 0) {
        await tx.position.deleteMany({
          where: { accountId: resolvedAccountId, instrumentId: resolvedInstrumentId },
        });
      } else {
        await tx.position.upsert({
          where: { accountId_instrumentId: { accountId: resolvedAccountId, instrumentId: resolvedInstrumentId } },
          update: {
            quantity: row.quantity,
            avgCost: row.avgCost,
            unrealizedPnl: row.unrealizedPnl,
            currency: row.currency,
          },
          create: {
            accountId: resolvedAccountId,
            instrumentId: resolvedInstrumentId,
            quantity: row.quantity,
            avgCost: row.avgCost,
            unrealizedPnl: row.unrealizedPnl,
            currency: row.currency,
          },
        });

        const seen = seenInstrumentsByAccount.get(resolvedAccountId) ?? new Set<string>();
        seen.add(resolvedInstrumentId);
        seenInstrumentsByAccount.set(resolvedAccountId, seen);
      }

      const snapshotDate = row.reportDate
        ? normalizeSnapshotDate(row.reportDate)
        : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

      await tx.positionSnapshot.upsert({
        where: {
          accountId_instrumentId_date: {
            accountId: resolvedAccountId,
            instrumentId: resolvedInstrumentId,
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
          instrumentId: resolvedInstrumentId,
          date: snapshotDate,
          quantity: row.quantity,
          avgCost: row.avgCost,
          unrealizedPnl: row.unrealizedPnl,
          currency: row.currency,
        },
      });

      rowsImported += 1;
    }

    if (item.resolvedPositionSnapshotMode === "full") {
      for (const seenAccountId of seenAccounts) {
        const seenInstruments = [...(seenInstrumentsByAccount.get(seenAccountId) ?? new Set<string>())];
        if (seenInstruments.length === 0) {
          await tx.position.deleteMany({ where: { accountId: seenAccountId } });
          continue;
        }
        await tx.position.deleteMany({
          where: {
            accountId: seenAccountId,
            instrumentId: { notIn: seenInstruments },
          },
        });
      }
      notes.push("Positions were treated as a full account snapshot; unmentioned open positions for accounts in this file were removed.");
    } else {
      notes.push("Positions were treated as a partial snapshot; unmentioned open positions were preserved.");
    }
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

    rowsSkipped += item.parsed.snapshots.length - resolvedRows.length;
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

      rowsImported += 1;
    }
  }

  const durationMs = Math.max(1, Date.now() - item.startedAtMs);
  const rowsPerSecond = Number(((rowsImported / durationMs) * 1000).toFixed(2));
  if (rowsSkipped) notes.push("Some rows were skipped due to parser validation, unresolved references, or duplicate keys.");
  notes.push(`Import duration: ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`);

  await tx.importBatch.update({
    where: { id: batchId },
    data: {
      accountId,
      rowsSeen,
      rowsImported,
      rowsSkipped,
      status: "ROWS_APPLIED",
      notes: notes.join(" "),
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
  };
}

export async function importParsedFilesAtomic(params: ImportParsedFileInput[]): Promise<ImportParsedFileResult[]> {
  if (params.length === 0) return [];

  const prepared = await Promise.all(params.map(prepareAtomicImport));

  try {
    return await prisma.$transaction(
      async (tx) => {
        const results: ImportParsedFileResult[] = [];
        for (const item of prepared) {
          const batch = await createAtomicImportBatch(tx, item);
          results.push(await applyAtomicImportRows(tx, item, batch.id));
        }
        return results;
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    await Promise.all(
      prepared.map((item) =>
        recordFailedImportAttempt({
          filename: item.filename,
          fileType: item.fileType,
          rawContent: item.rawContent,
          parserVersion: item.parserVersion,
          rowErrors: item.parsed.rowErrors,
          rowsSeen: item.parsed.rawRowCount,
          positionSnapshotMode: item.resolvedPositionSnapshotMode,
          message,
          notes:
            error instanceof ImportRejectedError
              ? "Import failed because no valid rows could be applied."
              : `Atomic import failed before rows could be committed after ${(Math.max(1, Date.now() - item.startedAtMs) / 1000).toFixed(2)}s.`,
        }),
      ),
    );
    throw error;
  }
}

export async function recordFailedImportAttempt(params: {
  filename: string;
  fileType: string;
  message: string;
  rawContent?: string;
  parserVersion?: string;
  rowErrors?: ParsedRowError[];
  rowsSeen?: number;
  notes?: string;
  positionSnapshotMode?: PositionSnapshotImportMode;
}) {
  const rawArchive = await archiveRawImportContent(params.rawContent);
  const positionSnapshotMode = normalizePositionSnapshotMode(params.positionSnapshotMode);
  const isPositionImport = params.fileType === "positions" || params.fileType === "flex-positions";
  const rowsSeen = params.rowsSeen ?? params.rowErrors?.length ?? 0;

  const batch = await prisma.importBatch.create({
    data: {
      filename: params.filename,
      fileType: params.fileType,
      status: "FAILED",
      rowsSeen,
      rowsImported: 0,
      rowsSkipped: rowsSeen,
      rawSha256: rawArchive?.rawSha256,
      rawBytes: rawArchive?.rawBytes,
      rawStorageKey: rawArchive?.rawStorageKey,
      parserVersion: params.parserVersion ?? PARSER_VERSION,
      positionSnapshotMode: isPositionImport ? POSITION_SNAPSHOT_BATCH_MODE[positionSnapshotMode] : undefined,
      errorMessage: params.message.slice(0, 2000),
      notes: params.notes ?? "Import failed before rows could be applied.",
    },
  });

  if (params.rowErrors?.length) {
    try {
      await prisma.$transaction((tx) => persistImportRowErrors(tx, batch.id, params.rowErrors ?? []));
    } catch (error) {
      const message = error instanceof Error ? error.message : "row-error audit failed";
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          notes: `${batch.notes ?? "Import failed before rows could be applied."} Row-error audit failed: ${message}`.slice(
            0,
            2000,
          ),
        },
      });
    }
  }

  return batch;
}

function uniqueBatchIds(batchIds: string[]) {
  return [...new Set(batchIds)].filter(Boolean);
}

export async function markImportBatchesMaterialized(batchIds: string[], note?: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  await prisma.importBatch.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      status: "MATERIALIZED",
      errorMessage: null,
      notes: note ? note.slice(0, 2000) : undefined,
    },
  });
}

export async function markImportBatchesMaterializationFailed(batchIds: string[], message: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  await prisma.importBatch.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      status: "MATERIALIZATION_FAILED",
      errorMessage: message.slice(0, 2000),
      notes: `Import rows were written, but materialization did not complete: ${message}`.slice(0, 2000),
    },
  });
}

export async function markImportBatchesFailed(batchIds: string[], message: string) {
  const uniqueIds = uniqueBatchIds(batchIds);
  if (uniqueIds.length === 0) return;

  await prisma.importBatch.updateMany({
    where: { id: { in: uniqueIds } },
    data: {
      status: "FAILED",
      errorMessage: message.slice(0, 2000),
      notes: `Import failed: ${message}`.slice(0, 2000),
    },
  });
}
