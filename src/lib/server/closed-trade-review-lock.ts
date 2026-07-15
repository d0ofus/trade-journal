import { Prisma } from "@prisma/client";

export async function lockClosedTradeForReview(tx: Prisma.TransactionClient, groupKey: string) {
  const rows = await tx.$queryRaw<Array<{ groupKey: string; isStale: boolean }>>(
    Prisma.sql`SELECT "groupKey", "isStale" FROM "ClosedTrade" WHERE "groupKey" = ${groupKey} FOR UPDATE`,
  );
  return rows[0] ?? null;
}
