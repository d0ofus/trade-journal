import crypto from "node:crypto";
import { AssetType, Side } from "@prisma/client";
import type { ParsedImport } from "@/lib/import/ibkr-parser";
import { prisma } from "@/lib/prisma";

function dedupeKey(parts: string[]) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

async function getOrCreateAccount(accountCode: string, currency = "USD") {
  return prisma.account.upsert({
    where: { ibkrAccount: accountCode },
    update: { baseCurrency: currency || "USD" },
    create: {
      name: accountCode,
      ibkrAccount: accountCode,
      baseCurrency: currency || "USD",
    },
  });
}

async function getOrCreateInstrument(input: {
  symbol: string;
  exchange?: string;
  assetType: AssetType;
  currency?: string;
}) {
  const key = {
    symbol: input.symbol,
    exchange: input.exchange ?? "",
    assetType: input.assetType,
  };

  return prisma.instrument.upsert({
    where: { symbol_exchange_assetType: key },
    update: {
      currency: input.currency ?? "USD",
    },
    create: {
      ...key,
      currency: input.currency ?? "USD",
    },
  });
}

export async function importParsedFile(params: {
  filename: string;
  parsed: ParsedImport;
  fileType: string;
}) {
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
    for (const row of params.parsed.executions) {
      rowsSeen += 1;

      const account = await getOrCreateAccount(row.account, row.currency);
      accountId = account.id;
      const instrument = await getOrCreateInstrument({
        symbol: row.symbol,
        exchange: row.exchange,
        assetType: row.assetType as AssetType,
        currency: row.currency,
      });

      const key = dedupeKey([
        row.account,
        row.executedAt.toISOString(),
        row.symbol,
        row.side,
        String(row.quantity),
        String(row.price),
        row.orderId ?? "",
      ]);

      const created = await prisma.execution.createMany({
        data: [
          {
            dedupeKey: key,
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
          },
        ],
        skipDuplicates: true,
      });
      rowsImported += created.count;
      rowsSkipped += 1 - created.count;
    }
  }

  if (params.parsed.kind === "positions") {
    const seenInstrumentsByAccount = new Map<string, Set<string>>();
    const seenAccounts = new Set<string>();

    for (const row of params.parsed.positions) {
      rowsSeen += 1;

      const account = await getOrCreateAccount(row.account, row.currency);
      accountId = account.id;
      seenAccounts.add(account.id);
      const instrument = await getOrCreateInstrument({
        symbol: row.symbol,
        exchange: row.exchange,
        assetType: row.assetType as AssetType,
        currency: row.currency,
      });

      if (row.quantity === 0) {
        await prisma.position.deleteMany({
          where: { accountId: account.id, instrumentId: instrument.id },
        });
      } else {
        await prisma.position.upsert({
          where: { accountId_instrumentId: { accountId: account.id, instrumentId: instrument.id } },
          update: {
            quantity: row.quantity,
            avgCost: row.avgCost,
            unrealizedPnl: row.unrealizedPnl,
            currency: row.currency,
          },
          create: {
            accountId: account.id,
            instrumentId: instrument.id,
            quantity: row.quantity,
            avgCost: row.avgCost,
            unrealizedPnl: row.unrealizedPnl,
            currency: row.currency,
          },
        });

        const seen = seenInstrumentsByAccount.get(account.id) ?? new Set<string>();
        seen.add(instrument.id);
        seenInstrumentsByAccount.set(account.id, seen);
      }

      const snapshotDate = row.reportDate
        ? new Date(Date.UTC(row.reportDate.getUTCFullYear(), row.reportDate.getUTCMonth(), row.reportDate.getUTCDate()))
        : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

      await prisma.positionSnapshot.upsert({
        where: {
          accountId_instrumentId_date: {
            accountId: account.id,
            instrumentId: instrument.id,
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
          accountId: account.id,
          instrumentId: instrument.id,
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
    for (const row of params.parsed.snapshots) {
      rowsSeen += 1;

      const account = await getOrCreateAccount(row.account, row.currency);
      accountId = account.id;

      await prisma.dailySnapshot.upsert({
        where: {
          accountId_date: {
            accountId: account.id,
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
          accountId: account.id,
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

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      accountId,
      rowsSeen,
      rowsImported,
      rowsSkipped,
      notes: rowsSkipped ? "Some rows were skipped due to duplicate keys." : null,
    },
  });

  return { rowsSeen, rowsImported, rowsSkipped };
}
