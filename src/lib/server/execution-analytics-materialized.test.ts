import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { ParsedImport } from "@/lib/import/ibkr-parser";
import { prisma } from "@/lib/prisma";
import {
  executionAnalyticsRefreshLockKey,
  executionAnalyticsRefreshLockQuery,
  executionAnalyticsSourceLockQuery,
  refreshMaterializedExecutionAnalytics,
} from "@/lib/server/execution-analytics-materialized";
import {
  buildMaterializationSourceSignature,
  getExecutionAnalyticsSourceSnapshot,
  MATERIALIZATION_WATERMARK_KEYS,
} from "@/lib/server/materialization-watermarks";
import {
  createImportCohortContext,
  importParsedFilesAtomic,
} from "@/lib/server/import-service";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function waitingRefreshLockCount() {
  const lockKey = executionAnalyticsRefreshLockKey();
  const rows = await prisma.$queryRaw<Array<{ waiting: number }>>(
    Prisma.sql`
      SELECT count(*)::int AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND granted = false
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND objsubid = 1
        AND classid = (((hashtextextended(${lockKey}, 0) >> 32) & 4294967295)::oid)
        AND objid = ((hashtextextended(${lockKey}, 0) & 4294967295)::oid)
    `,
  );
  return rows[0]?.waiting ?? 0;
}

async function expectRefreshWaiters(count: number) {
  await expect.poll(waitingRefreshLockCount, { timeout: 10_000, interval: 25 }).toBeGreaterThanOrEqual(count);
}

async function waitingExecutionWriterCount() {
  const schema = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/test").searchParams.get("schema") || "public";
  const rows = await prisma.$queryRaw<Array<{ waiting: number }>>(Prisma.sql`
    SELECT count(*)::int AS waiting
    FROM pg_locks AS lock
    INNER JOIN pg_class AS relation ON relation.oid = lock.relation
    INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE lock.locktype = 'relation'
      AND lock.granted = false
      AND relation.relname = 'Execution'
      AND namespace.nspname = ${schema}
  `);
  return rows[0]?.waiting ?? 0;
}

async function expectExecutionWriterWaiting() {
  await expect.poll(waitingExecutionWriterCount, { timeout: 10_000, interval: 25 }).toBeGreaterThan(0);
}

async function seedExecutionScenario(marker: string) {
  const account = await prisma.account.create({
    data: {
      id: `phase15-account-${marker}`,
      name: `Phase 15 ${marker}`,
      ibkrAccount: `PHASE15-${marker}`,
      baseCurrency: "USD",
    },
  });
  const instrument = await prisma.instrument.create({
    data: {
      id: `phase15-instrument-${marker}`,
      symbol: `P15${marker.slice(-6)}`,
      exchange: `PHASE15-${marker}`,
      assetType: "STOCK",
      currency: "USD",
    },
  });
  const buy = await prisma.execution.create({
    data: {
      id: `phase15-buy-${marker}`,
      dedupeKey: `phase15-buy-${marker}`,
      accountId: account.id,
      instrumentId: instrument.id,
      executedAt: new Date("2199-01-01T10:00:00.000Z"),
      side: "BUY",
      quantity: 2,
      price: 10,
      commission: 0.25,
      fees: 0,
      currency: "USD",
    },
  });
  const sell = await prisma.execution.create({
    data: {
      id: `phase15-sell-${marker}`,
      dedupeKey: `phase15-sell-${marker}`,
      accountId: account.id,
      instrumentId: instrument.id,
      executedAt: new Date("2199-01-01T11:00:00.000Z"),
      side: "SELL",
      quantity: 1,
      price: 12,
      commission: 0.25,
      fees: 0,
      currency: "USD",
    },
  });
  return { account, instrument, buy, sell };
}

async function cleanupExecutionScenario(accountId: string, instrumentId: string) {
  await prisma.account.deleteMany({ where: { id: accountId } });
  await prisma.instrument.deleteMany({ where: { id: instrumentId } });
}

async function expectAnalyticsCurrent() {
  const [source, analyticsCount, watermark] = await Promise.all([
    getExecutionAnalyticsSourceSnapshot(prisma),
    prisma.executionAnalytics.count(),
    prisma.materializationWatermark.findUnique({
      where: { key: MATERIALIZATION_WATERMARK_KEYS.executionAnalytics },
    }),
  ]);
  expect(analyticsCount).toBe(source.executionCount);
  expect(watermark?.sourceSignature).toBe(buildMaterializationSourceSignature(source));
}

function executionImport(account: string, symbol: string, marker: string): ParsedImport {
  return {
    kind: "executions",
    rawRowCount: 1,
    executions: [
      {
        account,
        executedAt: new Date("2199-02-01T10:00:00.000Z"),
        symbol,
        exchange: "NASDAQ",
        assetType: "STOCK",
        side: "BUY",
        quantity: 1,
        price: 10,
        commission: 0.25,
        fees: 0,
        currency: "USD",
        orderId: `PHASE15-${marker}`,
      },
    ],
    positions: [],
    snapshots: [],
    rowErrors: [],
  };
}

describe("execution analytics refresh lock", () => {
  const databaseUrl = "postgresql://user:password@db.example/trades?schema=trade_journal_phase15_test";

  it("builds a parameterized schema-scoped lock", () => {
    const key = executionAnalyticsRefreshLockKey(databaseUrl);
    const query = executionAnalyticsRefreshLockQuery(key);

    expect(key).toBe('trade-journal:materialization:["trade_journal_phase15_test","execution-analytics"]');
    expect(query.text).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(query.values).toEqual([key]);
    expect(query.text).not.toContain("phase15");

    const sourceLock = executionAnalyticsSourceLockQuery(databaseUrl);
    expect(sourceLock.text).toContain('"trade_journal_phase15_test"."Instrument"');
    expect(sourceLock.text).toContain('"trade_journal_phase15_test"."Execution"');
    expect(sourceLock.text).toContain('"trade_journal_phase15_test"."PositionSnapshot"');
    expect(sourceLock.text).toContain("IN SHARE MODE");
  });

  it("uses public without an explicit schema and rejects invalid URLs", () => {
    expect(executionAnalyticsRefreshLockKey("postgresql://user@db.example/trades")).toContain('["public"');
    expect(() => executionAnalyticsRefreshLockKey("not a URL")).toThrow("DATABASE_URL must be a valid URL");
  });
});

describe.sequential("refreshMaterializedExecutionAnalytics", () => {
  const dbIt = process.env.RUN_EXECUTION_ANALYTICS_DB_TESTS === "1" ? it : it.skip;

  dbIt("serializes an older reader and leaves rows plus watermark at the newest source", async () => {
    const marker = `${Date.now()}-serial`;
    const scenario = await seedExecutionScenario(marker);
    const firstReady = deferred<number>();
    const releaseFirst = deferred<void>();
    const secondReady = deferred<void>();
    const refreshes: Promise<unknown>[] = [];
    let newestPromise: Promise<{ id: string }> | null = null;

    try {
      const first = refreshMaterializedExecutionAnalytics({
        hooks: {
          beforeCommit: async (source, attempt) => {
            if (attempt !== 1) return;
            firstReady.resolve(source.executionCount);
            await releaseFirst.promise;
          },
        },
      });
      refreshes.push(first);
      const originalCount = await firstReady.promise;

      newestPromise = Promise.resolve(
        prisma.execution.create({
          data: {
            id: `phase15-newest-${marker}`,
            dedupeKey: `phase15-newest-${marker}`,
            accountId: scenario.account.id,
            instrumentId: scenario.instrument.id,
            executedAt: new Date("2199-01-01T12:00:00.000Z"),
            side: "SELL",
            quantity: 1,
            price: 13,
            commission: 0.25,
            fees: 0,
            currency: "USD",
          },
          select: { id: true },
        }),
      );
      await expectExecutionWriterWaiting();

      const second = refreshMaterializedExecutionAnalytics({
        hooks: { beforeAcquire: () => secondReady.resolve(undefined) },
      });
      refreshes.push(second);
      await secondReady.promise;
      await expectRefreshWaiters(1);
      expect(originalCount).toBeGreaterThanOrEqual(2);

      releaseFirst.resolve(undefined);
      const newest = await newestPromise;
      await Promise.all([first, second]);

      expect(await prisma.executionAnalytics.findUnique({ where: { executionId: newest.id } })).not.toBeNull();
      await expectAnalyticsCurrent();
    } finally {
      releaseFirst.resolve(undefined);
      if (newestPromise) await Promise.allSettled([newestPromise]);
      await Promise.allSettled(refreshes);
      await cleanupExecutionScenario(scenario.account.id, scenario.instrument.id);
    }
  });

  dbIt("queues multiple concurrent refreshes without missing or duplicate analytics", async () => {
    const marker = `${Date.now()}-many`;
    const scenario = await seedExecutionScenario(marker);
    const firstLocked = deferred<void>();
    const releaseFirst = deferred<void>();
    const refreshes: Promise<unknown>[] = [];

    try {
      const first = refreshMaterializedExecutionAnalytics({
        hooks: {
          afterAcquire: async (attempt) => {
            if (attempt !== 1) return;
            firstLocked.resolve(undefined);
            await releaseFirst.promise;
          },
        },
      });
      refreshes.push(first);
      await firstLocked.promise;
      const waiters = [
        refreshMaterializedExecutionAnalytics(),
        refreshMaterializedExecutionAnalytics(),
        refreshMaterializedExecutionAnalytics(),
      ];
      refreshes.push(...waiters);
      await expectRefreshWaiters(3);

      releaseFirst.resolve(undefined);
      await Promise.all([first, ...waiters]);

      const scenarioAnalytics = await prisma.executionAnalytics.findMany({
        where: { executionId: { in: [scenario.buy.id, scenario.sell.id] } },
      });
      expect(scenarioAnalytics).toHaveLength(2);
      await expectAnalyticsCurrent();
    } finally {
      releaseFirst.resolve(undefined);
      await Promise.allSettled(refreshes);
      await cleanupExecutionScenario(scenario.account.id, scenario.instrument.id);
    }
  });

  dbIt("rolls analytics replacement and watermark back together when refresh fails", async () => {
    const marker = `${Date.now()}-rollback`;
    const scenario = await seedExecutionScenario(marker);

    try {
      await refreshMaterializedExecutionAnalytics();
      const beforeRows = await prisma.executionAnalytics.findMany({ orderBy: { executionId: "asc" } });
      const beforeWatermark = await prisma.materializationWatermark.findUniqueOrThrow({
        where: { key: MATERIALIZATION_WATERMARK_KEYS.executionAnalytics },
      });

      await expect(
        refreshMaterializedExecutionAnalytics({
          hooks: {
            beforeCommit: () => {
              throw new Error("phase15 injected pre-commit failure");
            },
          },
        }),
      ).rejects.toThrow("phase15 injected pre-commit failure");

      expect(await prisma.executionAnalytics.findMany({ orderBy: { executionId: "asc" } })).toEqual(beforeRows);
      expect(
        await prisma.materializationWatermark.findUniqueOrThrow({
          where: { key: MATERIALIZATION_WATERMARK_KEYS.executionAnalytics },
        }),
      ).toEqual(beforeWatermark);
    } finally {
      await cleanupExecutionScenario(scenario.account.id, scenario.instrument.id);
    }
  });

  dbIt("persists globally chronological cumulative P&L across accounts", async () => {
    const marker = `${Date.now()}-chronology`;
    const accountIds = [`phase15-chronology-account-a-${marker}`, `phase15-chronology-account-b-${marker}`];
    const instrumentIds = [
      `phase15-chronology-instrument-a-${marker}`,
      `phase15-chronology-instrument-b-${marker}`,
    ];
    const executionIds = [
      `phase15-chronology-a-open-${marker}`,
      `phase15-chronology-b-open-${marker}`,
      `phase15-chronology-a-close-${marker}`,
      `phase15-chronology-b-close-${marker}`,
    ];

    try {
      await refreshMaterializedExecutionAnalytics();
      const latestBefore = await prisma.execution.findFirst({
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        select: { analytics: { select: { cumulativePnl: true } } },
      });
      const carryInCumulative = latestBefore?.analytics?.cumulativePnl ?? 0;

      await prisma.account.createMany({
        data: accountIds.map((id, index) => ({
          id,
          name: `Phase 15 chronology ${index + 1}`,
          ibkrAccount: `PHASE15-CHRONOLOGY-${index + 1}-${marker}`,
          baseCurrency: "USD",
        })),
      });
      await prisma.instrument.createMany({
        data: instrumentIds.map((id, index) => ({
          id,
          symbol: `P15C${index + 1}${marker.slice(-6)}`,
          exchange: `PHASE15-CHRONOLOGY-${marker}`,
          assetType: "STOCK" as const,
          currency: "USD",
        })),
      });
      await prisma.execution.createMany({
        data: [
          {
            id: executionIds[0],
            dedupeKey: executionIds[0],
            accountId: accountIds[0],
            instrumentId: instrumentIds[0],
            executedAt: new Date("2299-01-01T10:00:00.000Z"),
            side: "BUY" as const,
            quantity: 10,
            price: 100,
            currency: "USD",
          },
          {
            id: executionIds[1],
            dedupeKey: executionIds[1],
            accountId: accountIds[1],
            instrumentId: instrumentIds[1],
            executedAt: new Date("2299-01-01T10:15:00.000Z"),
            side: "SELL" as const,
            quantity: 10,
            price: 50,
            currency: "USD",
          },
          {
            id: executionIds[2],
            dedupeKey: executionIds[2],
            accountId: accountIds[0],
            instrumentId: instrumentIds[0],
            executedAt: new Date("2299-01-01T10:30:00.000Z"),
            side: "SELL" as const,
            quantity: 10,
            price: 105,
            currency: "USD",
          },
          {
            id: executionIds[3],
            dedupeKey: executionIds[3],
            accountId: accountIds[1],
            instrumentId: instrumentIds[1],
            executedAt: new Date("2299-01-01T10:45:00.000Z"),
            side: "BUY" as const,
            quantity: 10,
            price: 45,
            currency: "USD",
          },
        ],
      });

      await refreshMaterializedExecutionAnalytics();
      const analytics = await prisma.executionAnalytics.findMany({
        where: { executionId: { in: executionIds } },
        select: { executionId: true, cumulativePnl: true, matchedQuantity: true },
      });
      const byExecution = new Map(analytics.map((row) => [row.executionId, row]));

      expect(executionIds.map((id) => byExecution.get(id)?.matchedQuantity)).toEqual([0, 0, 10, 10]);
      expect(executionIds.map((id) => byExecution.get(id)?.cumulativePnl)).toEqual([
        carryInCumulative,
        carryInCumulative,
        carryInCumulative + 50,
        carryInCumulative + 100,
      ]);
    } finally {
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
      await prisma.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
      await refreshMaterializedExecutionAnalytics();
    }
  });

  dbIt("allows independent cohorts to apply rows while global refreshes serialize", async () => {
    const marker = `${Date.now()}-cohorts`;
    const accountCodes = [`PHASE15-A-${marker}`, `PHASE15-B-${marker}`];
    const symbols = [`P15A${marker.slice(-6)}`, `P15B${marker.slice(-6)}`];
    const filenames = [`phase15-a-${marker}.csv`, `phase15-b-${marker}.csv`];
    const firstLocked = deferred<void>();
    const releaseFirst = deferred<void>();
    const refreshes: Promise<unknown>[] = [];

    try {
      const firstRefresh = refreshMaterializedExecutionAnalytics({
        hooks: {
          afterAcquire: async (attempt) => {
            if (attempt !== 1) return;
            firstLocked.resolve(undefined);
            await releaseFirst.promise;
          },
        },
      });
      refreshes.push(firstRefresh);
      await firstLocked.promise;

      const imports = await Promise.all(
        accountCodes.map((accountCode, index) =>
          importParsedFilesAtomic(
            [
              {
                filename: filenames[index],
                fileType: "executions",
                parsed: executionImport(accountCode, symbols[index], `${marker}-${index}`),
              },
            ],
            createImportCohortContext(),
          ),
        ),
      );
      const batchIds = imports.flatMap((cohort) => cohort.map((result) => result.batchId));
      expect(
        (await prisma.importBatch.findMany({ where: { id: { in: batchIds } } })).every(
          (batch) => batch.status === "ROWS_APPLIED",
        ),
      ).toBe(true);

      const waitingRefresh = refreshMaterializedExecutionAnalytics();
      refreshes.push(waitingRefresh);
      await expectRefreshWaiters(1);
      releaseFirst.resolve(undefined);
      await Promise.all(refreshes);

      const executions = await prisma.execution.findMany({
        where: { account: { ibkrAccount: { in: accountCodes } } },
        select: { id: true },
      });
      expect(executions).toHaveLength(2);
      expect(
        await prisma.executionAnalytics.count({
          where: { executionId: { in: executions.map((execution) => execution.id) } },
        }),
      ).toBe(2);
      await expectAnalyticsCurrent();
    } finally {
      releaseFirst.resolve(undefined);
      await Promise.allSettled(refreshes);
      await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
      await prisma.account.deleteMany({ where: { ibkrAccount: { in: accountCodes } } });
      await prisma.instrument.deleteMany({ where: { symbol: { in: symbols } } });
    }
  });
});
