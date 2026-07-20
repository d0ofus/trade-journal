import { Prisma } from "@prisma/client";

type PositionImportLockDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export type PositionImportLockHooks = {
  beforeAcquire?: (accountCodes: readonly string[]) => void | Promise<void>;
  afterAcquire?: (accountCodes: readonly string[]) => void | Promise<void>;
};

function databaseSchema(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return "public";

  try {
    return new URL(databaseUrl).searchParams.get("schema") || "public";
  } catch {
    throw new Error("DATABASE_URL must be a valid URL before position imports can be locked.");
  }
}

export function positionImportAccountCodes(accountCodes: Iterable<string>) {
  return [...new Set([...accountCodes].filter(Boolean))].sort();
}

export function positionImportLockKeys(
  accountCodes: Iterable<string>,
  databaseUrl = process.env.DATABASE_URL,
) {
  const schema = databaseSchema(databaseUrl);
  return positionImportAccountCodes(accountCodes).map(
    (accountCode) => `trade-journal:position-import:${JSON.stringify([schema, accountCode])}`,
  );
}

export function positionImportLockQuery(lockKey: string) {
  return Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired`;
}

export async function lockPositionImportAccounts(
  db: PositionImportLockDb,
  accountCodes: Iterable<string>,
  hooks: PositionImportLockHooks = {},
) {
  const sortedAccountCodes = positionImportAccountCodes(accountCodes);
  if (sortedAccountCodes.length === 0) return;

  await hooks.beforeAcquire?.(sortedAccountCodes);
  for (const lockKey of positionImportLockKeys(sortedAccountCodes)) {
    await db.$queryRaw(positionImportLockQuery(lockKey));
  }
  await hooks.afterAcquire?.(sortedAccountCodes);
}
