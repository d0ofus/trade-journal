import { describe, expect, it } from "vitest";

import { parseCsvWithMapping, previewCsv, type ParsedImport } from "@/lib/import/ibkr-parser";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";
import {
  ImportRejectedError,
  importParsedFile,
  importParsedFilesAtomic,
  recordFailedImportAttempt,
} from "@/lib/server/import-service";

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
      expect(correctedBatch.notes).toContain("Updated commission or fee values");
    } finally {
      await cleanupExecutionScenario(accountCode, symbol, filenames);
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
      expect(batch.notes).toBe("Import failed because no valid rows could be applied.");
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
      expect(batches.every((batch) => batch.errorMessage?.includes("stale"))).toBe(true);
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

  dbIt("marks the batch failed when row-error persistence fails before rows are applied", async () => {
    const filename = `row-error-persistence-${Date.now()}.csv`;
    const rawRow = { Quantity: "bad" } as Record<string, string>;
    (rawRow as unknown as Record<string, unknown>).self = rawRow;
    const parsed: ParsedImport = {
      kind: "executions",
      rawRowCount: 1,
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
      await expect(
        importParsedFile({
          filename,
          parsed,
          fileType: "executions",
        }),
      ).rejects.toThrow(/circular/i);

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { filename },
        include: { rowErrors: true },
      });
      const execution = await prisma.execution.findFirst({ where: { account: { ibkrAccount: "ROWERR" } } });

      expect(batch.status).toBe("FAILED");
      expect(batch.rowsSeen).toBe(1);
      expect(batch.rowsImported).toBe(0);
      expect(batch.rowsSkipped).toBe(1);
      expect(batch.errorMessage).toMatch(/circular/i);
      expect(batch.rowErrors).toHaveLength(0);
      expect(execution).toBeNull();
    } finally {
      await prisma.importBatch.deleteMany({ where: { filename } });
      await prisma.execution.deleteMany({ where: { account: { ibkrAccount: "ROWERR" } } });
      await prisma.account.deleteMany({ where: { ibkrAccount: "ROWERR" } });
    }
  });
});
