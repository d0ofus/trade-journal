import { Prisma, type AssetType, type Side } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  buildMaterializationSourceSignature,
  getExecutionAnalyticsSourceSnapshot,
  isMaterializationWatermarkFresh,
  MATERIALIZATION_WATERMARK_KEYS,
  type MaterializationSourceSnapshot,
  writeMaterializationWatermark,
} from "@/lib/server/materialization-watermarks";
import {
  buildOpeningPositionMap,
  openingPositionKey,
  type OpeningPositionExecutionCandidate,
} from "@/lib/stats/opening-positions";
import { computeExecutionPnl } from "@/lib/stats/pnl";

const MAX_REFRESH_ATTEMPTS = 10;

class ExecutionAnalyticsSourceChangedError extends Error {
  constructor(before: MaterializationSourceSnapshot, after: MaterializationSourceSnapshot) {
    super(
      `Execution analytics source changed while it was being materialized: ${buildMaterializationSourceSignature(before)} -> ${buildMaterializationSourceSignature(after)}.`,
    );
    this.name = "ExecutionAnalyticsSourceChangedError";
  }
}

export type ExecutionAnalyticsRefreshHooks = {
  beforeAcquire?: (attempt: number) => void | Promise<void>;
  afterAcquire?: (attempt: number) => void | Promise<void>;
  afterSourceRead?: (source: MaterializationSourceSnapshot, attempt: number) => void | Promise<void>;
  beforeCommit?: (source: MaterializationSourceSnapshot, attempt: number) => void | Promise<void>;
};

type RefreshOptions = {
  hooks?: ExecutionAnalyticsRefreshHooks;
  skipIfFresh?: boolean;
};

type ExecutionSourceRow = {
  id: string;
  accountId: string;
  instrumentId: string;
  executedAt: Date;
  updatedAt: Date;
  side: Side;
  quantity: number;
  price: number;
  commission: number;
  fees: number;
  currency: string;
  instrumentSymbol: string;
  instrumentAssetType: AssetType;
  instrumentCurrency: string;
};

type PositionSnapshotSourceRow = {
  accountId: string;
  date: Date;
  quantity: number;
  avgCost: number;
  currency: string;
  instrumentSymbol: string;
  instrumentAssetType: AssetType;
  instrumentCurrency: string;
};

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function databaseSchema(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) return "public";

  try {
    return new URL(databaseUrl).searchParams.get("schema") || "public";
  } catch {
    throw new Error("DATABASE_URL must be a valid URL before execution analytics can be refreshed.");
  }
}

function qualifiedTable(
  table: "Execution" | "Instrument" | "PositionSnapshot",
  databaseUrl = process.env.DATABASE_URL,
) {
  const schema = databaseSchema(databaseUrl).replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${table}"`);
}

export function executionAnalyticsSourceLockQuery(databaseUrl = process.env.DATABASE_URL) {
  const instrumentTable = qualifiedTable("Instrument", databaseUrl);
  const executionTable = qualifiedTable("Execution", databaseUrl);
  const positionSnapshotTable = qualifiedTable("PositionSnapshot", databaseUrl);
  return Prisma.sql`LOCK TABLE ${instrumentTable}, ${executionTable}, ${positionSnapshotTable} IN SHARE MODE`;
}

export function executionAnalyticsRefreshLockKey(databaseUrl = process.env.DATABASE_URL) {
  return `trade-journal:materialization:${JSON.stringify([databaseSchema(databaseUrl), "execution-analytics"])}`;
}

export function executionAnalyticsRefreshLockQuery(lockKey: string) {
  return Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired`;
}

async function buildOpeningByAccountInstrument(
  tx: Prisma.TransactionClient,
  executions: OpeningPositionExecutionCandidate[],
) {
  const candidateKeys = new Set(
    executions.map((exec) =>
      openingPositionKey(exec.accountId, {
        symbol: exec.instrument.symbol,
        assetType: exec.instrument.assetType,
        currency: exec.currency ?? exec.instrument.currency,
      }),
    ),
  );
  if (candidateKeys.size === 0) return new Map<string, { quantity: number; avgCost: number }>();

  const latestFirstExecutionAt = new Date(Math.max(...executions.map((exec) => exec.executedAt.getTime())));
  const accountIds = [...new Set(executions.map((exec) => exec.accountId))];
  const symbols = [...new Set(executions.map((exec) => exec.instrument.symbol))];
  const positionSnapshotTable = qualifiedTable("PositionSnapshot");
  const instrumentTable = qualifiedTable("Instrument");
  const sourceRows = await tx.$queryRaw<PositionSnapshotSourceRow[]>(Prisma.sql`
    SELECT
      snapshot."accountId",
      snapshot."date",
      snapshot."quantity",
      snapshot."avgCost",
      snapshot."currency",
      instrument."symbol" AS "instrumentSymbol",
      instrument."assetType" AS "instrumentAssetType",
      instrument."currency" AS "instrumentCurrency"
    FROM ${positionSnapshotTable} AS snapshot
    INNER JOIN ${instrumentTable} AS instrument ON instrument."id" = snapshot."instrumentId"
    WHERE snapshot."accountId" IN (${Prisma.join(accountIds)})
      AND snapshot."date" < ${latestFirstExecutionAt}
      AND instrument."symbol" IN (${Prisma.join(symbols)})
    ORDER BY snapshot."date" DESC
  `);
  const snapshots = sourceRows.map((snapshot) => ({
    accountId: snapshot.accountId,
    date: snapshot.date,
    quantity: snapshot.quantity,
    avgCost: snapshot.avgCost,
    currency: snapshot.currency,
    instrument: {
      symbol: snapshot.instrumentSymbol,
      assetType: snapshot.instrumentAssetType,
      currency: snapshot.instrumentCurrency,
    },
  }));

  return buildOpeningPositionMap(executions, snapshots);
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function sameSourceSnapshot(left: MaterializationSourceSnapshot, right: MaterializationSourceSnapshot) {
  return buildMaterializationSourceSignature(left) === buildMaterializationSourceSignature(right);
}

async function loadExecutionSource(tx: Prisma.TransactionClient) {
  const executionTable = qualifiedTable("Execution");
  const instrumentTable = qualifiedTable("Instrument");
  const rows = await tx.$queryRaw<ExecutionSourceRow[]>(Prisma.sql`
    SELECT
      execution."id",
      execution."accountId",
      execution."instrumentId",
      execution."executedAt",
      execution."updatedAt",
      execution."side",
      execution."quantity",
      execution."price",
      execution."commission",
      execution."fees",
      execution."currency",
      instrument."symbol" AS "instrumentSymbol",
      instrument."assetType" AS "instrumentAssetType",
      instrument."currency" AS "instrumentCurrency"
    FROM ${executionTable} AS execution
    INNER JOIN ${instrumentTable} AS instrument ON instrument."id" = execution."instrumentId"
    ORDER BY execution."executedAt" ASC, execution."id" ASC
  `);
  return rows.map((execution) => ({
    id: execution.id,
    accountId: execution.accountId,
    instrumentId: execution.instrumentId,
    executedAt: execution.executedAt,
    updatedAt: execution.updatedAt,
    side: execution.side,
    quantity: execution.quantity,
    price: execution.price,
    commission: execution.commission,
    fees: execution.fees,
    currency: execution.currency,
    instrument: {
      symbol: execution.instrumentSymbol,
      assetType: execution.instrumentAssetType,
      currency: execution.instrumentCurrency,
    },
  }));
}

export async function refreshMaterializedExecutionAnalytics(options: RefreshOptions = {}) {
  const lockKey = executionAnalyticsRefreshLockKey();

  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          await options.hooks?.beforeAcquire?.(attempt);
          await tx.$queryRaw(executionAnalyticsRefreshLockQuery(lockKey));
          await options.hooks?.afterAcquire?.(attempt);
          await tx.$executeRaw(executionAnalyticsSourceLockQuery());

          const sourceSnapshot = await getExecutionAnalyticsSourceSnapshot(tx);
          const executions = await loadExecutionSource(tx);

          if (
            options.skipIfFresh &&
            (await tx.executionAnalytics.count()) === sourceSnapshot.executionCount &&
            (await isMaterializationWatermarkFresh(
              tx,
              MATERIALIZATION_WATERMARK_KEYS.executionAnalytics,
              sourceSnapshot,
            ))
          ) {
            return { rows: sourceSnapshot.executionCount, refreshed: false, sourceSnapshot };
          }

          await options.hooks?.afterSourceRead?.(sourceSnapshot, attempt);
          const openingByAccountInstrument = await buildOpeningByAccountInstrument(tx, executions);
          const analyticsRows = computeExecutionPnl(
            executions.map((exec) => ({
              id: exec.id,
              accountId: exec.accountId,
              instrumentId: exec.instrumentId,
              symbol: exec.instrument.symbol,
              assetType: exec.instrument.assetType,
              currency: exec.currency ?? exec.instrument.currency,
              executedAt: exec.executedAt,
              side: exec.side,
              quantity: exec.quantity,
              price: exec.price,
              commission: exec.commission,
              fees: exec.fees,
            })),
            openingByAccountInstrument,
          );

          const sourceBeforePersist = await getExecutionAnalyticsSourceSnapshot(tx);
          if (!sameSourceSnapshot(sourceSnapshot, sourceBeforePersist)) {
            throw new ExecutionAnalyticsSourceChangedError(sourceSnapshot, sourceBeforePersist);
          }

          await tx.executionAnalytics.deleteMany();
          for (const chunk of chunked(analyticsRows, 500)) {
            await tx.executionAnalytics.createMany({
              data: chunk.map((row) => ({
                executionId: row.executionId,
                realizedPnl: row.realizedPnl,
                grossRealizedPnl: row.grossRealizedPnl,
                cumulativePnl: row.cumulativePnl,
                matchedQuantity: row.matchedQuantity,
                avgHoldTimeMs: row.avgHoldTimeMs,
              })),
            });
          }

          await options.hooks?.beforeCommit?.(sourceSnapshot, attempt);
          await writeMaterializationWatermark(
            tx,
            MATERIALIZATION_WATERMARK_KEYS.executionAnalytics,
            sourceSnapshot,
          );
          return { rows: analyticsRows.length, refreshed: true, sourceSnapshot };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 },
      );

      return { rows: result.rows, refreshed: result.refreshed };
    } catch (error) {
      const retryable = isSerializationConflict(error) || error instanceof ExecutionAnalyticsSourceChangedError;
      if (!retryable || attempt === MAX_REFRESH_ATTEMPTS) throw error;
      continue;
    }
  }

  throw new Error("Execution analytics source changed repeatedly while it was being materialized.");
}

export async function ensureMaterializedExecutionAnalytics() {
  const [sourceSnapshot, analyticsCount] = await Promise.all([
    getExecutionAnalyticsSourceSnapshot(prisma),
    prisma.executionAnalytics.count(),
  ]);

  if (
    analyticsCount === sourceSnapshot.executionCount &&
    (await isMaterializationWatermarkFresh(prisma, MATERIALIZATION_WATERMARK_KEYS.executionAnalytics, sourceSnapshot))
  ) {
    return false;
  }

  const result = await refreshMaterializedExecutionAnalytics({ skipIfFresh: true });
  return result.refreshed;
}
