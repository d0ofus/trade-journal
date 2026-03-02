import crypto from "node:crypto";
import { AssetType, Side } from "@prisma/client";
import type { ParsedImport } from "@/lib/import/ibkr-parser";
import { prisma } from "@/lib/prisma";

const EXECUTION_CHUNK_SIZE = 500;

function dedupeKey(parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

async function ensureAccounts(rows: Array<{ account: string; currency?: string }>) {
  const byCode = new Map<string, string>();
  for (const row of rows) {
    if (!row.account) continue;
    if (!byCode.has(row.account)) {
      byCode.set(row.account, row.currency ?? "USD");
    }
  }
  const codes = [...byCode.keys()];
  if (codes.length === 0) return new Map<string, { id: string; baseCurrency: string }>();

  await prisma.account.createMany({
    data: codes.map((accountCode) => ({
      name: accountCode,
      ibkrAccount: accountCode,
      baseCurrency: byCode.get(accountCode) ?? "USD",
    })),
    skipDuplicates: true,
  });

  const accounts = await prisma.account.findMany({
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

async function ensureInstruments(rows: InstrumentSeed[]) {
  const byKey = new Map<string, InstrumentSeed>();
  for (const row of rows) {
    const key = instrumentKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  const uniqueRows = [...byKey.values()];
  if (uniqueRows.length === 0) return new Map<string, { id: string; currency: string }>();

  await prisma.instrument.createMany({
    data: uniqueRows.map((row) => ({
      symbol: row.symbol,
      exchange: row.exchange ?? "",
      assetType: row.assetType,
      currency: row.currency ?? "USD",
    })),
    skipDuplicates: true,
  });

  const instruments = await prisma.instrument.findMany({
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
}) {
  const startedAtMs = Date.now();
  let rowsSeen = 0;
  let rowsImported = 0;
  let rowsSkipped = 0;
  let accountId: string | undefined;

  const batch = await prisma.importBatch.create({
    data: {
      filename: params.filename,
      fileType: params.fileType,
    },
  });

  if (params.parsed.kind === "executions") {
    rowsSeen = params.parsed.executions.length;
    const accountMap = await ensureAccounts(params.parsed.executions);
    const instrumentMap = await ensureInstruments(
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

    if (executionRows.length > 0) {
      accountId = executionRows[0].accountId;
    }

    for (const chunk of chunked(executionRows, EXECUTION_CHUNK_SIZE)) {
      const created = await prisma.execution.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      rowsImported += created.count;
    }
    rowsSkipped += executionRows.length - rowsImported;
  }

  if (params.parsed.kind === "positions") {
    const accountMap = await ensureAccounts(params.parsed.positions);
    const instrumentMap = await ensureInstruments(
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

    rowsSeen = resolvedRows.length;
    const seenInstrumentsByAccount = new Map<string, Set<string>>();
    const seenAccounts = new Set<string>();

    for (const item of resolvedRows) {
      const { row, accountId: resolvedAccountId, instrumentId: resolvedInstrumentId } = item;
      accountId = resolvedAccountId;
      seenAccounts.add(resolvedAccountId);

      if (row.quantity === 0) {
        await prisma.position.deleteMany({
          where: { accountId: resolvedAccountId, instrumentId: resolvedInstrumentId },
        });
      } else {
        await prisma.position.upsert({
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
        ? new Date(Date.UTC(row.reportDate.getUTCFullYear(), row.reportDate.getUTCMonth(), row.reportDate.getUTCDate()))
        : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

      await prisma.positionSnapshot.upsert({
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

    for (const seenAccountId of seenAccounts) {
      const seenInstruments = [...(seenInstrumentsByAccount.get(seenAccountId) ?? new Set<string>())];
      if (seenInstruments.length === 0) {
        await prisma.position.deleteMany({ where: { accountId: seenAccountId } });
        continue;
      }
      await prisma.position.deleteMany({
        where: {
          accountId: seenAccountId,
          instrumentId: { notIn: seenInstruments },
        },
      });
    }
  }

  if (params.parsed.kind === "snapshots") {
    const accountMap = await ensureAccounts(params.parsed.snapshots);
    const resolvedRows = params.parsed.snapshots
      .map((row) => {
        const account = accountMap.get(row.account);
        if (!account) return null;
        return { row, accountId: account.id };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    rowsSeen = resolvedRows.length;
    for (const item of resolvedRows) {
      const { row, accountId: resolvedAccountId } = item;
      accountId = resolvedAccountId;

      await prisma.dailySnapshot.upsert({
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

  const notes = [
    rowsSkipped ? "Some rows were skipped due to duplicate keys." : null,
    `Import duration: ${(durationMs / 1000).toFixed(2)}s (${rowsPerSecond.toLocaleString()} rows/s)`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      accountId,
      rowsSeen,
      rowsImported,
      rowsSkipped,
      notes,
    },
  });

  return { rowsSeen, rowsImported, rowsSkipped, durationMs, rowsPerSecond };
}
