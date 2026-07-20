import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { parseCsvWithMapping, previewCsv, type ParsedImport } from "@/lib/import/ibkr-parser";
import { parseFlexStatementCsv } from "@/lib/import/ibkr-flex";
import {
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "@/lib/import/import-history";
import { parseImportAccounting } from "@/lib/import/import-accounting";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";
import {
  ImportRejectedError,
  createImportCohortContext,
  importParsedFile,
  importParsedFilesAtomic,
  recordFailedImportAttempt,
  recordFailedImportCohort,
} from "@/lib/server/import-service";
import { positionImportLockKeys } from "@/lib/server/position-import-lock";

describe("rawImportArchiveIdentity", () => {
  it("derives a content-addressed storage key from the raw payload", () => {
    const identity = rawImportArchiveIdentity("account,symbol\nDU123,AAPL\n");

    expect(identity.rawBytes).toBe(Buffer.byteLength("account,symbol\nDU123,AAPL\n", "utf8"));
    expect(identity.rawSha256).toHaveLength(64);
    expect(identity.rawStorageKey).toBe(`import-artifacts/sha256/${identity.rawSha256}.txt`);
  });
});

describe("importParsedFile", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    return { promise, resolve, reject };
  }

  async function waitingPositionImportLockCount(accountCode: string) {
    const lockKey = positionImportLockKeys([accountCode])[0];
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

  async function expectPositionImportWaiting(accountCode: string) {
    await expect.poll(
      () => waitingPositionImportLockCount(accountCode),
      { timeout: 10_000, interval: 25 },
    ).toBeGreaterThan(0);
  }

  function positionImport(account: string, symbol: string, quantity: number, reportDate: Date | null = new Date("2026-01-02T00:00:00.000Z")): ParsedImport {
    return {
      kind: "positions",
      rawRowCount: 1,
      executions: [],
      positions: [
        {
          account,
          symbol,
          exchange: "NASDAQ",
          assetType: "STOCK",
          ...(reportDate ? { reportDate } : {}),
          quantity,
          avgCost: 10,
          unrealizedPnl: 0,
          currency: "USD",
        },
      ],
      snapshots: [],
      rowErrors: [],
    };
  }

  function positionRowsImport(
    account: string,
    rows: Array<{ symbol: string; quantity: number; reportDate: Date }>,
  ): ParsedImport {
    return {
      kind: "positions",
      rawRowCount: rows.length,
      executions: [],
      positions: rows.map((row) => ({
        account,
        exchange: "NASDAQ",
        assetType: "STOCK",
        avgCost: 10,
        unrealizedPnl: 0,
        currency: "USD",
        ...row,
      })),
      snapshots: [],
      rowErrors: [],
    };
  }

  function executionImport(account: string, symbol: string, commission: number, fees = 0): ParsedImport {
    return {
      kind: "executions",
      rawRowCount: 1,
      executions: [
        {
          account,
          executedAt: new Date("2026-01-02T10:00:00.000Z"),
          symbol,
          exchange: "NASDAQ",
          assetType: "STOCK",
          side: "BUY",
          quantity: 10,
          price: 100,
          commission,
          fees,
          currency: "USD",
          orderId: "ORDER-1",
        },
      ],
      positions: [],
      snapshots: [],
      rowErrors: [],
    };
  }

  async function seedOpenPosition(accountCode: string, symbol: string, quantity: number) {
    const account = await prisma.account.upsert({
      where: { ibkrAccount: accountCode },
      update: {},
      create: { name: accountCode, ibkrAccount: accountCode, baseCurrency: "USD" },
    });
    const instrument = await prisma.instrument.upsert({
      where: { symbol_exchange_assetType: { symbol, exchange: "NASDAQ", assetType: "STOCK" } },
      update: {},
      create: { symbol, exchange: "NASDAQ", assetType: "STOCK", currency: "USD" },
    });
    await prisma.position.upsert({
      where: { accountId_instrumentId: { accountId: account.id, instrumentId: instrument.id } },
      update: { quantity, avgCost: 10, unrealizedPnl: 0, currency: "USD" },
      create: { accountId: account.id, instrumentId: instrument.id, quantity, avgCost: 10, unrealizedPnl: 0, currency: "USD" },
    });
    return { account, instrument };
  }

  async function seedPositionSnapshot(accountId: string, instrumentId: string, date: string, quantity: number) {
    await prisma.positionSnapshot.upsert({
      where: {
        accountId_instrumentId_date: {
          accountId,
          instrumentId,
          date: new Date(`${date}T00:00:00.000Z`),
        },
      },
      update: { quantity, avgCost: 10, unrealizedPnl: 0, currency: "USD" },
      create: {
        accountId,
        instrumentId,
        date: new Date(`${date}T00:00:00.000Z`),
        quantity,
        avgCost: 10,
        unrealizedPnl: 0,
        currency: "USD",
      },
    });
  }

  async function cleanupPositionScenario(accountCodes: string[], symbols: string[], filenames: string[]) {
    await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
    await prisma.account.deleteMany({ where: { ibkrAccount: { in: accountCodes } } });
    await prisma.instrument.deleteMany({ where: { symbol: { in: symbols } } });
  }

  async function cleanupExecutionScenario(accountCode: string, symbol: string, filenames: string[]) {
    await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
    await prisma.execution.deleteMany({ where: { account: { ibkrAccount: accountCode } } });
    await prisma.account.deleteMany({ where: { ibkrAccount: accountCode } });
    await prisma.instrument.deleteMany({ where: { symbol } });
  }

  dbIt("updates corrected commission and fee values on duplicate execution imports", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-CORRECT-${marker}`;
    const symbol = `EC${String(marker).slice(-6)}`;
    const filenames = [`execution-first-${marker}.csv`, `execution-corrected-${marker}.csv`, `execution-unchanged-${marker}.csv`];

    try {
      const first = await importParsedFile({
        filename: filenames[0],
        fileType: "executions",
        parsed: executionImport(accountCode, symbol, 1, 0),
      });
      const corrected = await importParsedFile({
        filename: filenames[1],
        fileType: "executions",
        parsed: executionImport(accountCode, symbol, 2.5, 0.25),
      });
      const unchanged = await importParsedFile({
        filename: filenames[2],
        fileType: "executions",
        parsed: executionImport(accountCode, symbol, 2.5, 0.25),
      });

      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const correctedBatch = await prisma.importBatch.findFirstOrThrow({ where: { filename: filenames[1] } });

      expect(first).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
      expect(corrected).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
      expect(unchanged).toMatchObject({ rowsImported: 0, rowsSkipped: 1 });
      expect(execution.commission).toBe(2.5);
      expect(execution.fees).toBe(0.25);
      expect(correctedBatch.notes).toContain("Updated supplied commission or fee values");
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
    }
  });

  dbIt("keeps exact archived-file retries idempotent after a later charge correction", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-RETRY-${marker}`;
    const symbol = `ER${String(marker).slice(-6)}`;
    const filenames = [`retry-first-${marker}.csv`, `retry-corrected-${marker}.csv`, `retry-again-${marker}.csv`];
    const originalRaw = `original execution ${marker}`;
    const correctedRaw = `corrected execution ${marker}`;
    const firstParsed = executionImport(accountCode, symbol, 1, 0.2);
    firstParsed.executions[0].sourceExecutionId = `EXEC-${marker}`;
    firstParsed.executions[0].sourceExecutionIdKind = "ibexecid";
    const correctedParsed = executionImport(accountCode, symbol, 3, 0.4);
    correctedParsed.executions[0].sourceExecutionId = `EXEC-${marker}`;
    correctedParsed.executions[0].sourceExecutionIdKind = "ibexecid";

    try {
      await importParsedFile({
        filename: filenames[0],
        fileType: "executions",
        parsed: firstParsed,
        rawContent: originalRaw,
      });
      await importParsedFile({
        filename: filenames[1],
        fileType: "executions",
        parsed: correctedParsed,
        rawContent: correctedRaw,
      });
      const retried = await importParsedFile({
        filename: filenames[2],
        fileType: "executions",
        parsed: firstParsed,
        rawContent: originalRaw,
      });

      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      expect(retried).toMatchObject({ rowsSeen: 1, rowsImported: 0, rowsSkipped: 1 });
      expect(retried.accounting.primary.unchangedDuplicate).toBe(1);
      expect(execution).toMatchObject({ commission: 3, fees: 0.4 });
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
      await prisma.importArtifact.deleteMany({
        where: {
          storageKey: {
            in: [originalRaw, correctedRaw].map((content) => rawImportArchiveIdentity(content).rawStorageKey),
          },
        },
      });
    }
  });

  dbIt("recreates a missing execution during an exact archived-file retry", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-RESTORE-${marker}`;
    const symbol = `EXR${String(marker).slice(-6)}`;
    const filenames = [`restore-first-${marker}.csv`, `restore-retry-${marker}.csv`];
    const rawContent = `restorable execution ${marker}`;
    const parsed = executionImport(accountCode, symbol, 1.25, 0.15);
    parsed.executions[0].sourceExecutionId = `RESTORE-${marker}`;
    parsed.executions[0].sourceExecutionIdKind = "ibexecid";

    try {
      await importParsedFile({
        filename: filenames[0],
        fileType: "executions",
        parsed,
        rawContent,
      });
      await prisma.execution.deleteMany({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      const retried = await importParsedFile({
        filename: filenames[1],
        fileType: "executions",
        parsed,
        rawContent,
      });
      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      expect(retried).toMatchObject({ rowsSeen: 1, rowsImported: 1, rowsSkipped: 0 });
      expect(retried.accounting.primary.executionInserted).toBe(1);
      expect(execution).toMatchObject({ commission: 1.25, fees: 0.15 });
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
      await prisma.importArtifact.deleteMany({
        where: { storageKey: rawImportArchiveIdentity(rawContent).rawStorageKey },
      });
    }
  });

  dbIt("stores distinct fills that share timestamp, economics, and parent order", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-FILLS-${marker}`;
    const symbol = `EF${String(marker).slice(-6)}`;
    const filename = `execution-fills-${marker}.csv`;
    const parsed = executionImport(accountCode, symbol, 0.5, 0.1);
    const first = parsed.executions[0];
    parsed.rawRowCount = 2;
    parsed.executions = [
      { ...first, sourceExecutionId: `FILL-A-${marker}`, sourceExecutionIdKind: "ibexecid" },
      { ...first, sourceExecutionId: `FILL-B-${marker}`, sourceExecutionIdKind: "ibexecid" },
    ];

    try {
      const result = await importParsedFile({ filename, fileType: "executions", parsed });
      const executions = await prisma.execution.findMany({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      expect(result).toMatchObject({ rowsSeen: 2, rowsImported: 2, rowsSkipped: 0 });
      expect(result.accounting.primary.executionInserted).toBe(2);
      expect(executions).toHaveLength(2);
      expect(new Set(executions.map((execution) => execution.dedupeKey)).size).toBe(2);
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, [filename]);
    }
  });

  dbIt("reports an exact same-file execution duplicate separately from its insert", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-DUPE-${marker}`;
    const symbol = `ED${String(marker).slice(-6)}`;
    const filename = `execution-duplicate-${marker}.csv`;
    const parsed = executionImport(accountCode, symbol, 0.5, 0.1);
    parsed.executions[0].sourceExecutionId = `DUPLICATE-${marker}`;
    parsed.executions[0].sourceExecutionIdKind = "ibexecid";
    parsed.rawRowCount = 2;
    parsed.executions = [{ ...parsed.executions[0] }, { ...parsed.executions[0] }];

    try {
      const result = await importParsedFile({ filename, fileType: "executions", parsed });
      const executionCount = await prisma.execution.count({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      expect(result).toMatchObject({ rowsSeen: 2, rowsImported: 1, rowsSkipped: 1 });
      expect(result.accounting.primary).toMatchObject({ executionInserted: 1, unchangedDuplicate: 1 });
      expect(executionCount).toBe(1);
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, [filename]);
    }
  });

  dbIt("updates only supplied charge fields on a matching execution", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-PATCH-${marker}`;
    const symbol = `EP${String(marker).slice(-6)}`;
    const filenames = [`execution-patch-first-${marker}.csv`, `execution-patch-second-${marker}.csv`];
    const first = executionImport(accountCode, symbol, 1, 0.75);
    first.executions[0].sourceExecutionId = `PATCH-${marker}`;
    first.executions[0].sourceExecutionIdKind = "tradeid";
    const correction = executionImport(accountCode, symbol, 2, 0);
    correction.executions[0].sourceExecutionId = `PATCH-${marker}`;
    correction.executions[0].sourceExecutionIdKind = "tradeid";
    correction.executions[0].fees = undefined;

    try {
      await importParsedFile({ filename: filenames[0], fileType: "executions", parsed: first });
      const result = await importParsedFile({ filename: filenames[1], fileType: "executions", parsed: correction });
      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      expect(result.accounting.primary.executionChargeUpdated).toBe(1);
      expect(execution).toMatchObject({ commission: 2, fees: 0.75 });
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
    }
  });

  dbIt("conserves mixed correction, duplicate, parser-error, and IDEALFX outcomes", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-MIXED-${marker}`;
    const symbol = `EM${String(marker).slice(-6)}`;
    const filenames = [`mixed-seed-a-${marker}.csv`, `mixed-seed-b-${marker}.csv`, `mixed-run-${marker}.csv`];
    const seedA = executionImport(accountCode, symbol, 1, 0.2);
    seedA.executions[0].sourceExecutionId = `MIX-A-${marker}`;
    seedA.executions[0].sourceExecutionIdKind = "ibexecid";
    const seedB = executionImport(accountCode, symbol, 4, 0.6);
    seedB.executions[0].sourceExecutionId = `MIX-B-${marker}`;
    seedB.executions[0].sourceExecutionIdKind = "ibexecid";
    const mixed: ParsedImport = {
      kind: "executions",
      rawRowCount: 4,
      executions: [
        { ...seedA.executions[0], commission: 2, fees: undefined },
        { ...seedB.executions[0] },
      ],
      positions: [],
      snapshots: [],
      rowErrors: [
        {
          rowNumber: 4,
          severity: "ERROR",
          code: "EXECUTION_ROW_INVALID",
          message: "Quantity is invalid.",
          rawRow: { Quantity: "bad" },
        },
      ],
      sourceDispositions: { idealFxExcluded: 1 },
    };

    try {
      await importParsedFile({ filename: filenames[0], fileType: "executions", parsed: seedA });
      await importParsedFile({ filename: filenames[1], fileType: "executions", parsed: seedB });
      const result = await importParsedFile({ filename: filenames[2], fileType: "executions", parsed: mixed });
      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename: filenames[2] } });
      const persisted = parseImportAccounting(batch.notes);

      expect(result).toMatchObject({ rowsSeen: 4, rowsImported: 1, rowsSkipped: 3, rowErrors: 1 });
      expect(result.accounting.primary).toMatchObject({
        parserRejected: 1,
        idealFxExcluded: 1,
        executionChargeUpdated: 1,
        unchangedDuplicate: 1,
      });
      expect(persisted.accounting).toEqual(result.accounting);
      expect(result.rowsSeen).toBe(result.rowsImported + result.rowsSkipped);
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
    }
  });

  dbIt("persists Flex commission matching and IDEALFX exclusion dispositions", async () => {
    const marker = Date.now();
    const accountCode = `EXEC-FLEX-${marker}`;
    const symbol = `EX${String(marker).slice(-6)}`;
    const filename = `flex-accounting-${marker}.csv`;
    const flex = [
      "Trades",
      "ClientAccountID,Date/Time,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBOrderID,TradeID",
      `${accountCode},2026-01-02 10:00:00,${symbol},NASDAQ,STK,BUY,1,190,PARENT-1,T-${marker}`,
      `${accountCode},2026-01-02 10:01:00,USD.SGD,IDEALFX,CASH,SELL,1000,1.35,FX-PARENT,FX-${marker}`,
      "Commissions",
      "TradeID,Exchange,AssetClass,Symbol,TotalCommission",
      `T-${marker},NASDAQ,STK,${symbol},-0.75`,
      `FX-${marker},IDEALFX,CASH,USD.SGD,-0.50`,
    ].join("\n");
    const parsed = parseFlexStatementCsv(flex).trades;

    try {
      const result = await importParsedFile({ filename, fileType: "flex-trades", parsed, rawContent: flex });
      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });

      expect(result).toMatchObject({ rowsSeen: 2, rowsImported: 1, rowsSkipped: 1 });
      expect(result.accounting.primary.idealFxExcluded).toBe(1);
      expect(result.accounting.flexCommissions).toEqual({
        seen: 2,
        matched: 1,
        excluded: 1,
        unmatched: 0,
        ambiguous: 0,
      });
      expect(execution.commission).toBe(0.75);
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, [filename]);
      await prisma.importArtifact.deleteMany({
        where: { storageKey: rawImportArchiveIdentity(flex).rawStorageKey },
      });
    }
  });

  dbIt("rolls back duplicate and charge-correction effects when an atomic sibling fails", async () => {
    const marker = Date.now();
    const accountCode = `ATOMIC-CORRECT-${marker}`;
    const executionSymbol = `ACX${String(marker).slice(-6)}`;
    const keptSymbol = `ACK${String(marker).slice(-6)}`;
    const protectedSymbol = `ACP${String(marker).slice(-6)}`;
    const filenames = [
      `atomic-seed-${marker}.csv`,
      `atomic-correction-${marker}.csv`,
      `atomic-stale-${marker}.csv`,
    ];
    const seed = executionImport(accountCode, executionSymbol, 1, 0.1);
    seed.executions[0].sourceExecutionId = `ATOMIC-${marker}`;
    seed.executions[0].sourceExecutionIdKind = "ibexecid";
    const corrected = executionImport(accountCode, executionSymbol, 2, 0.2);
    corrected.executions[0].sourceExecutionId = `ATOMIC-${marker}`;
    corrected.executions[0].sourceExecutionIdKind = "ibexecid";
    corrected.rawRowCount = 2;
    corrected.executions = [{ ...corrected.executions[0] }, { ...corrected.executions[0] }];

    try {
      await importParsedFile({ filename: filenames[0], fileType: "executions", parsed: seed });
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      await seedOpenPosition(accountCode, protectedSymbol, 5);
      await seedPositionSnapshot(kept.account.id, kept.instrument.id, "2026-06-22", 10);

      await expect(
        importParsedFilesAtomic([
          { filename: filenames[1], fileType: "executions", parsed: corrected },
          {
            filename: filenames[2],
            fileType: "positions",
            parsed: positionImport(accountCode, keptSymbol, 12, new Date("2026-06-20T00:00:00.000Z")),
            positionSnapshotMode: "full",
          },
        ]),
      ).rejects.toThrow("stale");

      const execution = await prisma.execution.findFirstOrThrow({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol: executionSymbol } },
      });
      const failedBatches = await prisma.importBatch.findMany({
        where: { filename: { in: filenames.slice(1) } },
      });
      expect(execution).toMatchObject({ commission: 1, fees: 0.1 });
      expect(failedBatches).toHaveLength(2);
      expect(failedBatches.every((batch) => batch.status === "FAILED" && batch.rowsImported === 0)).toBe(true);
      expect(failedBatches.every((batch) => batch.rowsSeen === batch.rowsSkipped)).toBe(true);
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
      await prisma.account.deleteMany({ where: { ibkrAccount: accountCode } });
      await prisma.instrument.deleteMany({
        where: { symbol: { in: [executionSymbol, keptSymbol, protectedSymbol] } },
      });
    }
  });

  dbIt("persists row errors and fails zero-valid-row imports", async () => {
    const filename = `invalid-import-${Date.now()}.csv`;
    const csv = [
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission",
      "U1,2026-01-02 10:00:00,AAPL,NASDAQ,STK,BUY,not-a-number,190.5,0.5",
    ].join("\n");
    const preview = previewCsv(filename, csv);
    const parsed = parseCsvWithMapping("executions", csv, preview.mapping);

    try {
      await expect(
        importParsedFile({
          filename,
          parsed,
          fileType: "executions",
        }),
      ).rejects.toBeInstanceOf(ImportRejectedError);

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { filename },
        include: { rowErrors: true },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.rowsSeen).toBe(1);
      expect(batch.rowsImported).toBe(0);
      expect(batch.rowsSkipped).toBe(1);
      expect(batch.errorMessage).toContain("quantity");
      expect(batch.errorMessage).toContain("Invalid input");
      expect(batch.notes).toBe("Import was rejected before any rows were committed.");
      expect(batch.rowErrors).toHaveLength(1);
      expect(batch.rowErrors[0].code).toBe("EXECUTION_ROW_INVALID");
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename } });
    }
  });

  dbIt("keeps parser row errors for failed attempts recorded before durable row writes", async () => {
    const filename = `preflight-invalid-${Date.now()}.csv`;
    const rawContent = "account,quantity\nU1,bad\n";

    try {
      await recordFailedImportAttempt({
        filename,
        fileType: "executions",
        rawContent,
        message: "row 2: Quantity is invalid.",
        rowErrors: [
          {
            rowNumber: 2,
            severity: "ERROR",
            code: "EXECUTION_ROW_INVALID",
            message: "Quantity is invalid.",
            rawRow: { account: "U1", quantity: "bad" },
          },
        ],
      });

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { filename },
        include: { rowErrors: true },
      });
      const artifact = batch.rawStorageKey
        ? await prisma.importArtifact.findUnique({ where: { storageKey: batch.rawStorageKey } })
        : null;

      expect(batch.status).toBe("FAILED");
      expect(batch.rowsSeen).toBe(1);
      expect(batch.rowsImported).toBe(0);
      expect(batch.rowsSkipped).toBe(1);
      expect(batch.rawSha256).toBe(rawImportArchiveIdentity(rawContent).rawSha256);
      expect(artifact?.content).toBe(rawContent);
      expect(batch.rowErrors).toHaveLength(1);
      expect(batch.rowErrors[0]).toMatchObject({
        rowNumber: 2,
        severity: "ERROR",
        code: "EXECUTION_ROW_INVALID",
        message: "Quantity is invalid.",
      });
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename } });
    }
  });

  dbIt("preserves unmentioned open positions by default as a partial snapshot", async () => {
    const marker = Date.now();
    const accountCode = `POS-PARTIAL-${marker}`;
    const keptSymbol = `PPK${String(marker).slice(-6)}`;
    const absentSymbol = `PPA${String(marker).slice(-6)}`;
    const filename = `partial-position-${marker}.csv`;

    try {
      await seedOpenPosition(accountCode, keptSymbol, 10);
      const absent = await seedOpenPosition(accountCode, absentSymbol, 5);

      const result = await importParsedFile({
        filename,
        fileType: "positions",
        parsed: positionImport(accountCode, keptSymbol, 12),
      });

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename } });
      const absentPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: absent.account.id, instrumentId: absent.instrument.id } },
      });

      expect(result.positionSnapshotMode).toBe("partial");
      expect(batch.positionSnapshotMode).toBe("PARTIAL");
      expect(batch.notes).toContain("partial snapshot");
      expect(absentPosition?.quantity).toBe(5);
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, absentSymbol], [filename]);
    }
  });

  dbIt("removes unmentioned positions only for seen accounts in full snapshot mode", async () => {
    const marker = Date.now();
    const accountCode = `POS-FULL-${marker}`;
    const otherAccountCode = `POS-FULL-OTHER-${marker}`;
    const keptSymbol = `PFK${String(marker).slice(-6)}`;
    const prunedSymbol = `PFP${String(marker).slice(-6)}`;
    const otherSymbol = `PFO${String(marker).slice(-6)}`;
    const filename = `full-position-${marker}.csv`;

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const pruned = await seedOpenPosition(accountCode, prunedSymbol, 5);
      const other = await seedOpenPosition(otherAccountCode, otherSymbol, 8);
      await seedPositionSnapshot(kept.account.id, kept.instrument.id, "2026-01-01", 10);

      const result = await importParsedFile({
        filename,
        fileType: "positions",
        parsed: positionImport(accountCode, keptSymbol, 12),
        positionSnapshotMode: "full",
      });

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename } });
      const prunedPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: pruned.account.id, instrumentId: pruned.instrument.id } },
      });
      const otherPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: other.account.id, instrumentId: other.instrument.id } },
      });

      expect(result.positionSnapshotMode).toBe("full");
      expect(batch.positionSnapshotMode).toBe("FULL");
      expect(batch.notes).toContain("full account snapshot");
      expect(prunedPosition).toBeNull();
      expect(otherPosition?.quantity).toBe(8);
    } finally {
      await cleanupPositionScenario([accountCode, otherAccountCode], [keptSymbol, prunedSymbol, otherSymbol], [filename]);
    }
  });

  dbIt("uses canonical STOCK identity for IBKR STK full snapshots", async () => {
    const marker = Date.now();
    const accountCode = `POS-STK-${marker}`;
    const keptSymbol = `PSK${String(marker).slice(-6)}`;
    const prunedSymbol = `PSP${String(marker).slice(-6)}`;
    const filename = `stk-full-position-${marker}.csv`;
    const csv = [
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      `${accountCode},${keptSymbol},NASDAQ,STK,2026-03-03,12,11,4,USD`,
    ].join("\n");

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const pruned = await seedOpenPosition(accountCode, prunedSymbol, 5);
      const parsed = parseCsvWithMapping("positions", csv);

      await importParsedFile({
        filename,
        fileType: "positions",
        parsed,
        positionSnapshotMode: "full",
      });

      const accountPositions = await prisma.position.findMany({
        where: { accountId: kept.account.id },
        include: { instrument: true },
      });
      const otherInstrument = await prisma.instrument.findUnique({
        where: { symbol_exchange_assetType: { symbol: keptSymbol, exchange: "NASDAQ", assetType: "OTHER" } },
      });
      const prunedPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: pruned.account.id, instrumentId: pruned.instrument.id } },
      });

      expect(parsed.positions[0].assetType).toBe("STOCK");
      expect(accountPositions).toHaveLength(1);
      expect(accountPositions[0]).toMatchObject({ quantity: 12, instrumentId: kept.instrument.id });
      expect(accountPositions[0].instrument.assetType).toBe("STOCK");
      expect(otherInstrument).toBeNull();
      expect(prunedPosition).toBeNull();
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, prunedSymbol], [filename]);
    }
  });

  dbIt("keeps delimiter-bearing instrument identities distinct", async () => {
    const marker = String(Date.now()).slice(-6);
    const accountCode = `POS-TUPLE-${marker}`;
    const symbolA = `A|B${marker}`;
    const exchangeA = "C";
    const symbolB = "A";
    const exchangeB = `B${marker}|C`;
    const filename = `tuple-position-${marker}.csv`;
    const reportDate = new Date("2026-03-04T00:00:00.000Z");
    const parsed = positionRowsImport(accountCode, [
      { symbol: symbolA, quantity: 3, reportDate },
      { symbol: symbolB, quantity: 7, reportDate },
    ]);
    parsed.positions[0].exchange = exchangeA;
    parsed.positions[1].exchange = exchangeB;

    try {
      await importParsedFilesAtomic([{
        filename,
        fileType: "positions",
        parsed,
        positionSnapshotMode: "full",
      }]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
      });
      const quantities = Object.fromEntries(
        positions.map((position) => [
          `${position.instrument.symbol}:${position.instrument.exchange}`,
          position.quantity,
        ]),
      );

      expect(positions).toHaveLength(2);
      expect(quantities).toEqual({
        [`${symbolA}:${exchangeA}`]: 3,
        [`${symbolB}:${exchangeB}`]: 7,
      });
    } finally {
      await cleanupPositionScenario([accountCode], [symbolA, symbolB], [filename]);
    }
  });

  dbIt("rejects impossible full-snapshot dates before pruning positions", async () => {
    const marker = Date.now();
    const accountCode = `POS-DATE-${marker}`;
    const keptSymbol = `PDK${String(marker).slice(-6)}`;
    const protectedSymbol = `PDP${String(marker).slice(-6)}`;
    const filename = `invalid-date-full-position-${marker}.csv`;
    const csv = [
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      `${accountCode},${keptSymbol},NASDAQ,STK,2026-02-31,12,11,4,USD`,
    ].join("\n");

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);
      const parsed = parseCsvWithMapping("positions", csv);

      await expect(
        importParsedFile({
          filename,
          fileType: "positions",
          parsed,
          positionSnapshotMode: "full",
        }),
      ).rejects.toBeInstanceOf(ImportRejectedError);

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename }, include: { rowErrors: true } });
      const keptAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: kept.account.id, instrumentId: kept.instrument.id } },
      });
      const protectedAfter = await prisma.position.findUnique({
        where: {
          accountId_instrumentId: {
            accountId: protectedPosition.account.id,
            instrumentId: protectedPosition.instrument.id,
          },
        },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.rowErrors).toHaveLength(1);
      expect(batch.rowErrors[0].message).toContain("Invalid or unsupported calendar date");
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, protectedSymbol], [filename]);
    }
  });

  dbIt("rejects full snapshots with row errors before pruning current positions", async () => {
    const marker = Date.now();
    const accountCode = `POS-ROWERR-${marker}`;
    const keptSymbol = `PRK${String(marker).slice(-6)}`;
    const protectedSymbol = `PRP${String(marker).slice(-6)}`;
    const filename = `row-error-full-position-${marker}.csv`;

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);
      const parsed = positionImport(accountCode, keptSymbol, 12);
      parsed.rawRowCount = 2;
      parsed.rowErrors = [
        {
          rowNumber: 3,
          severity: "ERROR",
          code: "POSITION_ROW_INVALID",
          message: "Symbol is required.",
          rawRow: { Symbol: "", Quantity: "5" },
        },
      ];

      await expect(
        importParsedFile({
          filename,
          fileType: "positions",
          parsed,
          positionSnapshotMode: "full",
        }),
      ).rejects.toBeInstanceOf(ImportRejectedError);

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename }, include: { rowErrors: true } });
      const keptAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: kept.account.id, instrumentId: kept.instrument.id } },
      });
      const protectedAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: protectedPosition.account.id, instrumentId: protectedPosition.instrument.id } },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.errorMessage).toContain("Full position snapshots require a clean parse");
      expect(batch.rowErrors).toHaveLength(1);
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, protectedSymbol], [filename]);
    }
  });

  dbIt("rejects stale full snapshots before mutating current positions", async () => {
    const marker = Date.now();
    const accountCode = `POS-STALE-${marker}`;
    const keptSymbol = `PSK${String(marker).slice(-6)}`;
    const protectedSymbol = `PSP${String(marker).slice(-6)}`;
    const filename = `stale-full-position-${marker}.csv`;

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);
      await seedPositionSnapshot(kept.account.id, kept.instrument.id, "2026-06-22", 10);

      await expect(
        importParsedFile({
          filename,
          fileType: "positions",
          parsed: positionImport(accountCode, keptSymbol, 12, new Date("2026-06-20T00:00:00.000Z")),
          positionSnapshotMode: "full",
        }),
      ).rejects.toBeInstanceOf(ImportRejectedError);

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename } });
      const keptAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: kept.account.id, instrumentId: kept.instrument.id } },
      });
      const protectedAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: protectedPosition.account.id, instrumentId: protectedPosition.instrument.id } },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.errorMessage).toContain("stale");
      expect(batch.errorMessage).toContain("2026-06-20");
      expect(batch.errorMessage).toContain("2026-06-22");
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, protectedSymbol], [filename]);
    }
  });

  dbIt("rolls back earlier files when a later full-position snapshot is rejected", async () => {
    const marker = Date.now();
    const accountCode = `ATOMIC-STALE-${marker}`;
    const executionSymbol = `ASX${String(marker).slice(-6)}`;
    const keptSymbol = `ASK${String(marker).slice(-6)}`;
    const protectedSymbol = `ASP${String(marker).slice(-6)}`;
    const filenames = [`atomic-execution-${marker}.csv`, `atomic-stale-position-${marker}.csv`];
    const executionRaw = `execution raw ${marker}`;
    const positionRaw = `position raw ${marker}`;

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);
      await seedPositionSnapshot(kept.account.id, kept.instrument.id, "2026-06-22", 10);

      await expect(
        importParsedFilesAtomic([
          {
            filename: filenames[0],
            fileType: "executions",
            parsed: executionImport(accountCode, executionSymbol, 0.5),
            rawContent: executionRaw,
          },
          {
            filename: filenames[1],
            fileType: "positions",
            parsed: positionImport(accountCode, keptSymbol, 12, new Date("2026-06-20T00:00:00.000Z")),
            rawContent: positionRaw,
            positionSnapshotMode: "full",
          },
        ]),
      ).rejects.toThrow("stale");

      const landedExecution = await prisma.execution.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol: executionSymbol } },
      });
      const executionInstrument = await prisma.instrument.findFirst({ where: { symbol: executionSymbol } });
      const keptAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: kept.account.id, instrumentId: kept.instrument.id } },
      });
      const protectedAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: protectedPosition.account.id, instrumentId: protectedPosition.instrument.id } },
      });
      const batches = await prisma.importBatch.findMany({
        where: { filename: { in: filenames } },
        orderBy: { filename: "asc" },
      });
      const artifactCount = await prisma.importArtifact.count({
        where: {
          storageKey: {
            in: [rawImportArchiveIdentity(executionRaw).rawStorageKey, rawImportArchiveIdentity(positionRaw).rawStorageKey],
          },
        },
      });

      expect(landedExecution).toBeNull();
      expect(executionInstrument).toBeNull();
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
      expect(batches).toHaveLength(2);
      expect(batches.map((batch) => batch.status)).toEqual(["FAILED", "FAILED"]);
      expect(batches.every((batch) => batch.rowsImported === 0)).toBe(true);
      expect(batches.every((batch) => batch.rowsSkipped === batch.rowsSeen)).toBe(true);
      expect(batches.every((batch) => batch.rowsSeen === 1 && batch.rowsSkipped === 1)).toBe(true);
      expect(batches[0].notes?.startsWith(IMPORT_FAILURE_ROLLED_BACK_MARKER)).toBe(true);
      expect(batches[0].errorMessage).toContain("Rolled back because a sibling import failed");
      expect(batches[0].errorMessage).not.toContain("stale");
      expect(batches[1].notes?.startsWith(IMPORT_FAILURE_DIRECT_MARKER)).toBe(true);
      expect(batches[1].errorMessage).toContain("stale");
      expect(batches.some((batch) => batch.positionSnapshotMode === "FULL")).toBe(true);
      expect(artifactCount).toBe(2);
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
      await prisma.importArtifact.deleteMany({
        where: {
          storageKey: {
            in: [rawImportArchiveIdentity(executionRaw).rawStorageKey, rawImportArchiveIdentity(positionRaw).rawStorageKey],
          },
        },
      });
      const account = await prisma.account.findUnique({ where: { ibkrAccount: accountCode } });
      if (account) {
        await prisma.execution.deleteMany({ where: { accountId: account.id } });
        await prisma.positionSnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.position.deleteMany({ where: { accountId: account.id } });
        await prisma.dailySnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.account.deleteMany({ where: { id: account.id } });
      }
      await prisma.instrument.deleteMany({ where: { symbol: { in: [executionSymbol, keptSymbol, protectedSymbol] } } });
    }
  });

  dbIt("rejects undated full snapshots before pruning current positions", async () => {
    const marker = Date.now();
    const accountCode = `POS-UNDATED-${marker}`;
    const keptSymbol = `PUK${String(marker).slice(-6)}`;
    const protectedSymbol = `PUP${String(marker).slice(-6)}`;
    const filename = `undated-full-position-${marker}.csv`;

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);

      await expect(
        importParsedFile({
          filename,
          fileType: "positions",
          parsed: positionImport(accountCode, keptSymbol, 12, null),
          positionSnapshotMode: "full",
        }),
      ).rejects.toBeInstanceOf(ImportRejectedError);

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename } });
      const keptAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: kept.account.id, instrumentId: kept.instrument.id } },
      });
      const protectedAfter = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: protectedPosition.account.id, instrumentId: protectedPosition.instrument.id } },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.errorMessage).toContain("requires ReportDate");
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
    } finally {
      await cleanupPositionScenario([accountCode], [keptSymbol, protectedSymbol], [filename]);
    }
  });

  dbIt("serializes concurrent same-date full snapshots as complete replacements", async () => {
    const marker = Date.now();
    const accountCode = `POS-SERIAL-FULL-${marker}`;
    const firstSymbol = `PSF${String(marker).slice(-6)}A`;
    const secondSymbol = `PSF${String(marker).slice(-6)}B`;
    const filenames = [`serial-full-first-${marker}.csv`, `serial-full-second-${marker}.csv`];
    const reportDate = new Date("2026-07-01T00:00:00.000Z");
    const firstLocked = deferred<readonly string[]>();
    const releaseFirst = deferred<void>();
    const secondReady = deferred<readonly string[]>();

    try {
      const first = importParsedFilesAtomic(
        [{
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(accountCode, firstSymbol, 10, reportDate),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async (accounts) => {
              firstLocked.resolve(accounts);
              await releaseFirst.promise;
            },
          },
        },
      );
      await expect(firstLocked.promise).resolves.toEqual([accountCode]);

      const second = importParsedFilesAtomic(
        [{
          filename: filenames[1],
          fileType: "positions",
          parsed: positionImport(accountCode, secondSymbol, 20, reportDate),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: (accounts) => secondReady.resolve(accounts),
          },
        },
      );
      await expect(secondReady.promise).resolves.toEqual([accountCode]);
      await expectPositionImportWaiting(accountCode);

      releaseFirst.resolve(undefined);
      await Promise.all([first, second]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
      });
      const snapshots = await prisma.positionSnapshot.findMany({
        where: { account: { ibkrAccount: accountCode }, date: reportDate },
        include: { instrument: true },
      });

      expect(positions.map((position) => position.instrument.symbol)).toEqual([secondSymbol]);
      expect(snapshots.map((snapshot) => snapshot.instrument.symbol)).toEqual([secondSymbol]);
      expect(positions[0].quantity).toBe(20);
      expect(snapshots[0].quantity).toBe(20);
    } finally {
      releaseFirst.resolve(undefined);
      await cleanupPositionScenario([accountCode], [firstSymbol, secondSymbol], filenames);
    }
  });

  dbIt("serializes direct imports when an older full snapshot acquires first", async () => {
    const marker = Date.now();
    const accountCode = `POS-SERIAL-DIRECT-${marker}`;
    const olderSymbol = `PDR${String(marker).slice(-6)}O`;
    const newerSymbol = `PDR${String(marker).slice(-6)}N`;
    const filenames = [`direct-older-${marker}.csv`, `direct-newer-${marker}.csv`];
    const olderLocked = deferred<void>();
    const releaseOlder = deferred<void>();
    const newerReady = deferred<void>();

    try {
      const older = importParsedFile(
        {
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(
            accountCode,
            olderSymbol,
            10,
            new Date("2026-07-01T00:00:00.000Z"),
          ),
          positionSnapshotMode: "full",
        },
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async () => {
              olderLocked.resolve(undefined);
              await releaseOlder.promise;
            },
          },
        },
      );
      await olderLocked.promise;

      const newer = importParsedFile(
        {
          filename: filenames[1],
          fileType: "positions",
          parsed: positionImport(
            accountCode,
            newerSymbol,
            20,
            new Date("2026-07-02T00:00:00.000Z"),
          ),
          positionSnapshotMode: "full",
        },
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: () => newerReady.resolve(undefined),
          },
        },
      );
      await newerReady.promise;
      await expectPositionImportWaiting(accountCode);

      releaseOlder.resolve(undefined);
      await Promise.all([older, newer]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
      });
      const batches = await prisma.importBatch.findMany({
        where: { filename: { in: filenames } },
      });

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({ quantity: 20 });
      expect(positions[0].instrument.symbol).toBe(newerSymbol);
      expect(batches).toHaveLength(2);
      expect(batches.every((batch) => batch.status === "ROWS_APPLIED")).toBe(true);
    } finally {
      releaseOlder.resolve(undefined);
      await cleanupPositionScenario([accountCode], [olderSymbol, newerSymbol], filenames);
    }
  });

  dbIt("keeps the newer full snapshot when an older concurrent cohort loses the lock", async () => {
    const marker = Date.now();
    const accountCode = `POS-SERIAL-NEWER-${marker}`;
    const winnerSymbol = `PSN${String(marker).slice(-6)}W`;
    const loserSymbol = `PSN${String(marker).slice(-6)}L`;
    const executionSymbol = `PSN${String(marker).slice(-6)}X`;
    const filenames = [
      `serial-newer-winner-${marker}.csv`,
      `serial-newer-sibling-${marker}.csv`,
      `serial-newer-loser-${marker}.csv`,
    ];
    const rawContents = [`serial sibling raw ${marker}`, `serial loser raw ${marker}`];
    const winnerLocked = deferred<void>();
    const releaseWinner = deferred<void>();
    const loserReady = deferred<void>();

    try {
      const winner = importParsedFilesAtomic(
        [{
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(
            accountCode,
            winnerSymbol,
            22,
            new Date("2026-07-02T00:00:00.000Z"),
          ),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async () => {
              winnerLocked.resolve(undefined);
              await releaseWinner.promise;
            },
          },
        },
      );
      await winnerLocked.promise;

      const loser = importParsedFilesAtomic(
        [
          {
            filename: filenames[1],
            fileType: "executions",
            parsed: executionImport(accountCode, executionSymbol, 0.5),
            rawContent: rawContents[0],
          },
          {
            filename: filenames[2],
            fileType: "positions",
            parsed: positionImport(
              accountCode,
              loserSymbol,
              11,
              new Date("2026-07-01T00:00:00.000Z"),
            ),
            rawContent: rawContents[1],
            positionSnapshotMode: "full",
          },
        ],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: () => loserReady.resolve(undefined),
          },
        },
      );
      await loserReady.promise;
      await expectPositionImportWaiting(accountCode);

      releaseWinner.resolve(undefined);
      await winner;
      await expect(loser).rejects.toThrow("stale");

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
      });
      const landedExecution = await prisma.execution.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol: executionSymbol } },
      });
      const loserSnapshot = await prisma.positionSnapshot.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol: loserSymbol } },
      });
      const rolledBackInstruments = await prisma.instrument.count({
        where: { symbol: { in: [executionSymbol, loserSymbol] } },
      });
      const batches = await prisma.importBatch.findMany({
        where: { filename: { in: filenames } },
        include: { rawArtifact: true },
      });
      const winnerBatch = batches.find((batch) => batch.filename === filenames[0]);
      const siblingBatch = batches.find((batch) => batch.filename === filenames[1]);
      const loserBatch = batches.find((batch) => batch.filename === filenames[2]);
      const artifacts = await prisma.importArtifact.findMany({
        where: {
          storageKey: {
            in: rawContents.map((content) => rawImportArchiveIdentity(content).rawStorageKey),
          },
        },
      });

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({ quantity: 22 });
      expect(positions[0].instrument.symbol).toBe(winnerSymbol);
      expect(landedExecution).toBeNull();
      expect(loserSnapshot).toBeNull();
      expect(rolledBackInstruments).toBe(0);
      expect(winnerBatch).toMatchObject({ status: "ROWS_APPLIED", cohortRole: "MEMBER" });
      expect(siblingBatch).toMatchObject({
        status: "FAILED",
        cohortRole: "ROLLED_BACK",
        rowsSeen: 1,
        rowsImported: 0,
        rowsSkipped: 1,
        rawStorageKey: rawImportArchiveIdentity(rawContents[0]).rawStorageKey,
      });
      expect(siblingBatch?.notes).toContain(IMPORT_FAILURE_ROLLED_BACK_MARKER);
      expect(siblingBatch?.rawArtifact?.content).toBe(rawContents[0]);
      expect(loserBatch).toMatchObject({
        status: "FAILED",
        cohortRole: "DIRECT_FAILURE",
        rowsSeen: 1,
        rowsImported: 0,
        rowsSkipped: 1,
        rawStorageKey: rawImportArchiveIdentity(rawContents[1]).rawStorageKey,
      });
      expect(loserBatch?.notes).toContain(IMPORT_FAILURE_DIRECT_MARKER);
      expect(loserBatch?.errorMessage).toContain("stale");
      expect(loserBatch?.rawArtifact?.content).toBe(rawContents[1]);
      expect(siblingBatch?.cohortId).toBe(loserBatch?.cohortId);
      expect(winnerBatch?.cohortId).not.toBe(loserBatch?.cohortId);
      expect(artifacts.map((artifact) => artifact.content).sort()).toEqual([...rawContents].sort());
    } finally {
      releaseWinner.resolve(undefined);
      await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
      await prisma.importArtifact.deleteMany({
        where: {
          storageKey: {
            in: rawContents.map((content) => rawImportArchiveIdentity(content).rawStorageKey),
          },
        },
      });
      await cleanupPositionScenario(
        [accountCode],
        [winnerSymbol, loserSymbol, executionSymbol],
        [],
      );
    }
  });

  dbIt("applies a waiting partial update only after a full snapshot commits", async () => {
    const marker = Date.now();
    const accountCode = `POS-SERIAL-FP-${marker}`;
    const fullSymbol = `PFP${String(marker).slice(-6)}F`;
    const partialSymbol = `PFP${String(marker).slice(-6)}P`;
    const filenames = [`serial-fp-full-${marker}.csv`, `serial-fp-partial-${marker}.csv`];
    const reportDate = new Date("2026-07-03T00:00:00.000Z");
    const fullLocked = deferred<void>();
    const releaseFull = deferred<void>();
    const partialReady = deferred<void>();

    try {
      const full = importParsedFilesAtomic(
        [{
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(accountCode, fullSymbol, 10, reportDate),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async () => {
              fullLocked.resolve(undefined);
              await releaseFull.promise;
            },
          },
        },
      );
      await fullLocked.promise;

      const partial = importParsedFilesAtomic(
        [{
          filename: filenames[1],
          fileType: "positions",
          parsed: positionImport(accountCode, partialSymbol, 5, reportDate),
          positionSnapshotMode: "partial",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: () => partialReady.resolve(undefined),
          },
        },
      );
      await partialReady.promise;
      await expectPositionImportWaiting(accountCode);

      releaseFull.resolve(undefined);
      const [fullResults, partialResults] = await Promise.all([full, partial]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
        orderBy: { instrument: { symbol: "asc" } },
      });
      const snapshots = await prisma.positionSnapshot.findMany({
        where: { account: { ibkrAccount: accountCode }, date: reportDate },
        include: { instrument: true },
        orderBy: { instrument: { symbol: "asc" } },
      });

      expect(positions.map((position) => position.instrument.symbol)).toEqual(
        [fullSymbol, partialSymbol].sort(),
      );
      expect(
        Object.fromEntries(
          snapshots.map((snapshot) => [snapshot.instrument.symbol, snapshot.quantity]),
        ),
      ).toEqual({ [fullSymbol]: 10, [partialSymbol]: 5 });
      expect(fullResults[0]).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
      expect(partialResults[0]).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
    } finally {
      releaseFull.resolve(undefined);
      await cleanupPositionScenario([accountCode], [fullSymbol, partialSymbol], filenames);
    }
  });

  dbIt("lets a waiting full snapshot replace an earlier partial update", async () => {
    const marker = Date.now();
    const accountCode = `POS-SERIAL-PF-${marker}`;
    const partialSymbol = `PPF${String(marker).slice(-6)}P`;
    const fullSymbol = `PPF${String(marker).slice(-6)}F`;
    const filenames = [`serial-pf-partial-${marker}.csv`, `serial-pf-full-${marker}.csv`];
    const reportDate = new Date("2026-07-04T00:00:00.000Z");
    const partialLocked = deferred<void>();
    const releasePartial = deferred<void>();
    const fullReady = deferred<void>();

    try {
      const partial = importParsedFilesAtomic(
        [{
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(accountCode, partialSymbol, 5, reportDate),
          positionSnapshotMode: "partial",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async () => {
              partialLocked.resolve(undefined);
              await releasePartial.promise;
            },
          },
        },
      );
      await partialLocked.promise;

      const full = importParsedFilesAtomic(
        [{
          filename: filenames[1],
          fileType: "positions",
          parsed: positionImport(accountCode, fullSymbol, 10, reportDate),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: () => fullReady.resolve(undefined),
          },
        },
      );
      await fullReady.promise;
      await expectPositionImportWaiting(accountCode);

      releasePartial.resolve(undefined);
      const [partialResults, fullResults] = await Promise.all([partial, full]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode } },
        include: { instrument: true },
      });
      const snapshots = await prisma.positionSnapshot.findMany({
        where: { account: { ibkrAccount: accountCode }, date: reportDate },
        include: { instrument: true },
      });

      expect(positions.map((position) => position.instrument.symbol)).toEqual([fullSymbol]);
      expect(snapshots.map((snapshot) => snapshot.instrument.symbol)).toEqual([fullSymbol]);
      expect(snapshots[0].quantity).toBe(10);
      expect(partialResults[0]).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
      expect(fullResults[0]).toMatchObject({ rowsImported: 1, rowsSkipped: 0 });
    } finally {
      releasePartial.resolve(undefined);
      await cleanupPositionScenario([accountCode], [partialSymbol, fullSymbol], filenames);
    }
  });

  dbIt("prelocks reversed multi-account cohorts in one deterministic order", async () => {
    const marker = Date.now();
    const accountA = `POS-SERIAL-MA-${marker}`;
    const accountB = `POS-SERIAL-MB-${marker}`;
    const firstA = `PMA${String(marker).slice(-6)}1`;
    const firstB = `PMB${String(marker).slice(-6)}1`;
    const secondA = `PMA${String(marker).slice(-6)}2`;
    const secondB = `PMB${String(marker).slice(-6)}2`;
    const filenames = [
      `multi-first-a-${marker}.csv`,
      `multi-first-b-${marker}.csv`,
      `multi-second-b-${marker}.csv`,
      `multi-second-a-${marker}.csv`,
    ];
    const reportDate = new Date("2026-07-05T00:00:00.000Z");
    const firstReady = deferred<readonly string[]>();
    const releaseBoth = deferred<void>();
    const secondReady = deferred<readonly string[]>();

    try {
      const first = importParsedFilesAtomic(
        [
          {
            filename: filenames[0],
            fileType: "positions",
            parsed: positionImport(accountA, firstA, 1, reportDate),
            positionSnapshotMode: "full",
          },
          {
            filename: filenames[1],
            fileType: "positions",
            parsed: positionImport(accountB, firstB, 1, reportDate),
            positionSnapshotMode: "full",
          },
        ],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: async (accounts) => {
              firstReady.resolve(accounts);
              await releaseBoth.promise;
            },
          },
        },
      );
      const expectedOrder = [accountA, accountB].sort();

      const second = importParsedFilesAtomic(
        [
          {
            filename: filenames[2],
            fileType: "positions",
            parsed: positionImport(accountB, secondB, 2, reportDate),
            positionSnapshotMode: "full",
          },
          {
            filename: filenames[3],
            fileType: "positions",
            parsed: positionImport(accountA, secondA, 2, reportDate),
            positionSnapshotMode: "full",
          },
        ],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: async (accounts) => {
              secondReady.resolve(accounts);
              await releaseBoth.promise;
            },
          },
        },
      );
      await expect(firstReady.promise).resolves.toEqual(expectedOrder);
      await expect(secondReady.promise).resolves.toEqual(expectedOrder);

      releaseBoth.resolve(undefined);
      await Promise.all([first, second]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: { in: [accountA, accountB] } } },
        include: { account: true, instrument: true },
      });
      const currentByAccount = new Map(
        positions.map((position) => [position.account.ibkrAccount, position.instrument.symbol]),
      );
      const finalSignature = `${currentByAccount.get(accountA)}|${currentByAccount.get(accountB)}`;

      expect(positions).toHaveLength(2);
      expect([`${firstA}|${firstB}`, `${secondA}|${secondB}`]).toContain(finalSignature);
    } finally {
      releaseBoth.resolve(undefined);
      await cleanupPositionScenario(
        [accountA, accountB],
        [firstA, firstB, secondA, secondB],
        filenames,
      );
    }
  });

  dbIt("does not block a different account while another position import holds its lock", async () => {
    const marker = Date.now();
    const blockedAccount = `POS-SERIAL-BLOCK-${marker}`;
    const freeAccount = `POS-SERIAL-FREE-${marker}`;
    const blockedSymbol = `PBL${String(marker).slice(-6)}`;
    const freeSymbol = `PFR${String(marker).slice(-6)}`;
    const filenames = [`independent-blocked-${marker}.csv`, `independent-free-${marker}.csv`];
    const reportDate = new Date("2026-07-06T00:00:00.000Z");
    const blockedLocked = deferred<void>();
    const releaseBlocked = deferred<void>();

    try {
      const blocked = importParsedFilesAtomic(
        [{
          filename: filenames[0],
          fileType: "positions",
          parsed: positionImport(blockedAccount, blockedSymbol, 3, reportDate),
          positionSnapshotMode: "full",
        }],
        createImportCohortContext(),
        {
          positionLockHooks: {
            afterAcquire: async () => {
              blockedLocked.resolve(undefined);
              await releaseBlocked.promise;
            },
          },
        },
      );
      await blockedLocked.promise;

      await importParsedFilesAtomic([{
        filename: filenames[1],
        fileType: "positions",
        parsed: positionImport(freeAccount, freeSymbol, 4, reportDate),
        positionSnapshotMode: "full",
      }]);

      const freePosition = await prisma.position.findFirst({
        where: { account: { ibkrAccount: freeAccount }, instrument: { symbol: freeSymbol } },
      });
      expect(freePosition?.quantity).toBe(4);

      releaseBlocked.resolve(undefined);
      await blocked;
    } finally {
      releaseBlocked.resolve(undefined);
      await cleanupPositionScenario(
        [blockedAccount, freeAccount],
        [blockedSymbol, freeSymbol],
        filenames,
      );
    }
  });

  dbIt("rejects an older partial snapshot before it can overwrite current state", async () => {
    const marker = Date.now();
    const accountCode = `POS-PARTIAL-STALE-${marker}`;
    const currentSymbol = `PPS${String(marker).slice(-6)}C`;
    const staleSymbol = `PPS${String(marker).slice(-6)}S`;
    const filename = `partial-stale-${marker}.csv`;

    try {
      const current = await seedOpenPosition(accountCode, currentSymbol, 10);
      await seedPositionSnapshot(current.account.id, current.instrument.id, "2026-07-08", 10);

      await expect(
        importParsedFilesAtomic([{
          filename,
          fileType: "positions",
          parsed: positionImport(
            accountCode,
            staleSymbol,
            99,
            new Date("2026-07-07T00:00:00.000Z"),
          ),
          positionSnapshotMode: "partial",
        }]),
      ).rejects.toThrow("Partial position snapshot");

      const currentAfter = await prisma.position.findUnique({
        where: {
          accountId_instrumentId: {
            accountId: current.account.id,
            instrumentId: current.instrument.id,
          },
        },
      });
      const stalePosition = await prisma.position.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol: staleSymbol } },
      });

      expect(currentAfter?.quantity).toBe(10);
      expect(stalePosition).toBeNull();
    } finally {
      await cleanupPositionScenario([accountCode], [currentSymbol, staleSymbol], [filename]);
    }
  });

  dbIt("rejects mixed-date partial rows before input order can regress current state", async () => {
    const marker = Date.now();
    const accountCode = `POS-PARTIAL-MIXED-${marker}`;
    const symbol = `PPM${String(marker).slice(-6)}`;
    const filename = `partial-mixed-${marker}.csv`;
    const parsed = positionRowsImport(accountCode, [
      { symbol, quantity: 20, reportDate: new Date("2026-07-10T00:00:00.000Z") },
      { symbol, quantity: 10, reportDate: new Date("2026-07-09T00:00:00.000Z") },
    ]);

    try {
      await expect(
        importParsedFilesAtomic([{
          filename,
          fileType: "positions",
          parsed,
          positionSnapshotMode: "partial",
        }]),
      ).rejects.toThrow("mixed effective dates");

      const position = await prisma.position.findFirst({
        where: { account: { ibkrAccount: accountCode } },
      });
      const snapshot = await prisma.positionSnapshot.findFirst({
        where: { account: { ibkrAccount: accountCode } },
      });
      const batch = await prisma.importBatch.findFirstOrThrow({ where: { filename } });

      expect(position).toBeNull();
      expect(snapshot).toBeNull();
      expect(batch).toMatchObject({
        status: "FAILED",
        cohortRole: "DIRECT_FAILURE",
        rowsSeen: 2,
        rowsImported: 0,
        rowsSkipped: 2,
      });
    } finally {
      await cleanupPositionScenario([accountCode], [symbol], [filename]);
    }
  });

  dbIt("updates the same instrument on a same-date full correction", async () => {
    const marker = Date.now();
    const accountCode = `POS-SAME-DATE-${marker}`;
    const symbol = `PSD${String(marker).slice(-6)}`;
    const filenames = [`same-date-first-${marker}.csv`, `same-date-correction-${marker}.csv`];
    const reportDate = new Date("2026-07-11T00:00:00.000Z");
    const corrected = positionImport(accountCode, symbol, 17, reportDate);
    corrected.positions[0].avgCost = 12.5;

    try {
      await importParsedFilesAtomic([{
        filename: filenames[0],
        fileType: "positions",
        parsed: positionImport(accountCode, symbol, 10, reportDate),
        positionSnapshotMode: "full",
      }]);
      await importParsedFilesAtomic([{
        filename: filenames[1],
        fileType: "positions",
        parsed: corrected,
        positionSnapshotMode: "full",
      }]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const snapshots = await prisma.positionSnapshot.findMany({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol }, date: reportDate },
      });

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({ quantity: 17, avgCost: 12.5 });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({ quantity: 17, avgCost: 12.5 });
    } finally {
      await cleanupPositionScenario([accountCode], [symbol], filenames);
    }
  });

  dbIt("orders shared instrument creation without blocking disjoint accounts", async () => {
    const marker = Date.now();
    const accountA = `POS-SHARED-A-${marker}`;
    const accountB = `POS-SHARED-B-${marker}`;
    const symbolX = `PSX${String(marker).slice(-6)}`;
    const symbolY = `PSY${String(marker).slice(-6)}`;
    const filenames = [
      `shared-instruments-a-x-${marker}.csv`,
      `shared-instruments-a-y-${marker}.csv`,
      `shared-instruments-b-y-${marker}.csv`,
      `shared-instruments-b-x-${marker}.csv`,
    ];
    const reportDate = new Date("2026-07-12T00:00:00.000Z");
    const firstReady = deferred<void>();
    const secondReady = deferred<void>();
    const releaseBoth = deferred<void>();

    try {
      const first = importParsedFilesAtomic(
        [
          {
            filename: filenames[0],
            fileType: "positions",
            parsed: positionImport(accountA, symbolX, 1, reportDate),
            positionSnapshotMode: "partial",
          },
          {
            filename: filenames[1],
            fileType: "positions",
            parsed: positionImport(accountA, symbolY, 2, reportDate),
            positionSnapshotMode: "partial",
          },
        ],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: async () => {
              firstReady.resolve(undefined);
              await releaseBoth.promise;
            },
          },
        },
      );
      const second = importParsedFilesAtomic(
        [
          {
            filename: filenames[2],
            fileType: "positions",
            parsed: positionImport(accountB, symbolY, 3, reportDate),
            positionSnapshotMode: "partial",
          },
          {
            filename: filenames[3],
            fileType: "positions",
            parsed: positionImport(accountB, symbolX, 4, reportDate),
            positionSnapshotMode: "partial",
          },
        ],
        createImportCohortContext(),
        {
          positionLockHooks: {
            beforeAcquire: async () => {
              secondReady.resolve(undefined);
              await releaseBoth.promise;
            },
          },
        },
      );
      await Promise.all([firstReady.promise, secondReady.promise]);

      releaseBoth.resolve(undefined);
      await Promise.all([first, second]);

      const positions = await prisma.position.findMany({
        where: { account: { ibkrAccount: { in: [accountA, accountB] } } },
        include: { account: true, instrument: true },
      });
      const quantities = new Map(
        positions.map((position) => [
          `${position.account.ibkrAccount}:${position.instrument.symbol}`,
          position.quantity,
        ]),
      );

      expect(quantities).toEqual(new Map([
        [`${accountA}:${symbolX}`, 1],
        [`${accountA}:${symbolY}`, 2],
        [`${accountB}:${symbolX}`, 4],
        [`${accountB}:${symbolY}`, 3],
      ]));
    } finally {
      releaseBoth.resolve(undefined);
      await cleanupPositionScenario([accountA, accountB], [symbolX, symbolY], filenames);
    }
  });

  dbIt("stores a safe row-error sentinel without blocking valid business rows", async () => {
    const filename = `row-error-persistence-${Date.now()}.csv`;
    const rawRow = { Quantity: "bad" } as Record<string, string>;
    (rawRow as unknown as Record<string, unknown>).self = rawRow;
    const parsed: ParsedImport = {
      kind: "executions",
      rawRowCount: 2,
      executions: [
        {
          account: "ROWERR",
          executedAt: new Date("2026-01-02T10:00:00.000Z"),
          symbol: "AAPL",
          exchange: "NASDAQ",
          assetType: "STOCK",
          side: "BUY",
          quantity: 1,
          price: 190.5,
          commission: 0.5,
          fees: 0,
          currency: "USD",
        },
      ],
      positions: [],
      snapshots: [],
      rowErrors: [
        {
          rowNumber: 2,
          severity: "ERROR",
          code: "EXECUTION_ROW_INVALID",
          message: "Malformed row kept for audit.",
          rawRow,
        },
      ],
    };

    try {
      const result = await importParsedFile({
        filename,
        parsed,
        fileType: "executions",
      });

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { filename },
        include: { rowErrors: true },
      });
      const execution = await prisma.execution.findFirst({ where: { account: { ibkrAccount: "ROWERR" } } });

      expect(result.rowsImported).toBe(1);
      expect(batch.status).toBe("ROWS_APPLIED");
      expect(batch.rowsSeen).toBe(2);
      expect(batch.rowsImported).toBe(1);
      expect(batch.rowsSkipped).toBe(1);
      expect(batch.errorMessage).toBeNull();
      expect(batch.rowErrors).toHaveLength(1);
      expect(JSON.parse(batch.rowErrors[0].rawJson)).toEqual({
        _importAudit: { version: 1, rawRow: "UNSERIALIZABLE" },
      });
      expect(execution).not.toBeNull();
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename } });
      await prisma.execution.deleteMany({ where: { account: { ibkrAccount: "ROWERR" } } });
      await prisma.account.deleteMany({ where: { ibkrAccount: "ROWERR" } });
    }
  });

  dbIt("persists an entire failed cohort atomically when audit payloads are malformed", async () => {
    const marker = Date.now();
    const filenames = [`ledger-sibling-${marker}.csv`, `ledger-direct-${marker}.csv`];
    const rawContents = [`sibling raw ${marker}`, `direct raw ${marker}`];
    const rawRow = { Quantity: "bad" } as Record<string, string>;
    (rawRow as unknown as Record<string, unknown>).self = rawRow;

    try {
      await recordFailedImportCohort({
        stage: "preflight",
        failures: [{ filename: filenames[1], message: "Position quantity is invalid." }],
        items: [
          {
            filename: filenames[0],
            fileType: "executions",
            rawContent: rawContents[0],
            rowsSeen: 1,
          },
          {
            filename: filenames[1],
            fileType: "positions",
            rawContent: rawContents[1],
            rowsSeen: 1,
            positionSnapshotMode: "full",
            rowErrors: [
              {
                rowNumber: 2,
                severity: "ERROR",
                code: "POSITION_ROW_INVALID",
                message: "Malformed position row kept for audit.",
                rawRow,
              },
            ],
          },
        ],
      });

      const batches = await prisma.importBatch.findMany({
        where: { filename: { in: filenames } },
        include: { rowErrors: true, rawArtifact: true },
      });
      const sibling = batches.find((batch) => batch.filename === filenames[0]);
      const direct = batches.find((batch) => batch.filename === filenames[1]);

      expect(batches).toHaveLength(2);
      expect(batches.every((batch) => batch.status === "FAILED" && batch.rowsImported === 0)).toBe(true);
      expect(batches.every((batch) => batch.rowsSeen === 1 && batch.rowsSkipped === 1)).toBe(true);
      expect(batches.every((batch) => batch.rawArtifact !== null)).toBe(true);
      expect(sibling?.notes).toContain(IMPORT_FAILURE_ROLLED_BACK_MARKER);
      expect(sibling?.rowErrors).toHaveLength(0);
      expect(direct?.notes).toContain(IMPORT_FAILURE_DIRECT_MARKER);
      expect(direct?.rowErrors).toHaveLength(1);
      expect(JSON.parse(direct?.rowErrors[0].rawJson ?? "{}")).toEqual({
        _importAudit: { version: 1, rawRow: "UNSERIALIZABLE" },
      });
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename: { in: filenames } } });
      await prisma.importArtifact.deleteMany({
        where: { storageKey: { in: rawContents.map((content) => rawImportArchiveIdentity(content).rawStorageKey) } },
      });
    }
  });
});
