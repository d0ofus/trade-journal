import { Prisma } from "@prisma/client";

function quotePostgresIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function reviewTable(name: string, databaseUrl = process.env.DATABASE_URL) {
  let schema = "public";
  if (databaseUrl) {
    try {
      schema = new URL(databaseUrl).searchParams.get("schema") || schema;
    } catch {
      throw new Error("DATABASE_URL must be a valid URL before a closed trade can be locked.");
    }
  }

  return Prisma.raw(`${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(name)}`);
}

export function closedTradeLockQuery(groupKey: string, databaseUrl = process.env.DATABASE_URL) {
  const table = reviewTable("ClosedTrade", databaseUrl);
  return Prisma.sql`SELECT "groupKey", "isStale" FROM ${table} WHERE "groupKey" = ${groupKey} FOR UPDATE`;
}

export async function lockLinkedJournalForReview(tx: Prisma.TransactionClient, journalEntryId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${reviewTable("JournalEntry")} WHERE "id" = ${journalEntryId} FOR UPDATE`);
}

export async function lockClosedTradeForReview(tx: Prisma.TransactionClient, groupKey: string) {
  const rows = await tx.$queryRaw<Array<{ groupKey: string; isStale: boolean }>>(
    closedTradeLockQuery(groupKey),
  );
  return rows[0] ?? null;
}
