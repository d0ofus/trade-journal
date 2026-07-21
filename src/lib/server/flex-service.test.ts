import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IMPORT_FAILURE_DIRECT_MARKER,
  IMPORT_FAILURE_ROLLED_BACK_MARKER,
} from "@/lib/import/import-history";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";
import { runFlexImport } from "@/lib/server/flex-service";
import { markImportBatchesMaterializationFailed } from "@/lib/server/import-service";

function mockFlexStatement(csv: string) {
  const responses = [
    new Response("<FlexStatementResponse><Status>Success</Status><ReferenceCode>TEST-REF</ReferenceCode></FlexStatementResponse>"),
    new Response(csv),
  ];

  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Flex fetch call.");
    return response;
  });
}

async function cleanupRawImport(rawSha256: string) {
  await prisma.importBatch.deleteMany({ where: { rawSha256 } });
  await prisma.importArtifact.deleteMany({ where: { rawSha256 } });
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

describe("runFlexImport lifecycle guardrails", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  dbIt("records empty Flex statements as failed archived attempts", async () => {
    const marker = Date.now();
    const csv = [
      "Trades",
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Currency",
      "Positions",
      `ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency,Marker${marker}`,
    ].join("\n");
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      await expect(
        runFlexImport({ token: "token", queryId: "query", baseUrl: "https://flex.example.test" }),
      ).rejects.toThrow("No importable Flex trade or position rows were found.");

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { rawSha256: identity.rawSha256 },
      });

      expect(batch.status).toBe("FAILED");
      expect(batch.fileType).toBe("flex");
      expect(batch.rowsSeen).toBe(0);
      expect(batch.rawStorageKey).toBe(identity.rawStorageKey);
      expect(batch.errorMessage).toContain("No importable Flex trade or position rows");
      expect(batch.cohortId).toBeTruthy();
      expect(batch.sourceId).toBeTruthy();
      expect(batch.sourceFilename).toMatch(/^flex-statement-/);
      expect(batch.sourceSection).toBeNull();
      expect(batch.cohortRole).toBe("DIRECT_FAILURE");
    } finally {
      await cleanupRawImport(identity.rawSha256);
    }
  });

  dbIt("retains parent provenance when the whole Flex statement cannot be parsed", async () => {
    const csv = 'Trades\nClientAccountID,DateTime,Symbol\n"unterminated';
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      await expect(
        runFlexImport({ token: "token", queryId: "query", baseUrl: "https://flex.example.test" }),
      ).rejects.toThrow();

      const batch = await prisma.importBatch.findFirstOrThrow({
        where: { rawSha256: identity.rawSha256 },
      });

      expect(batch.fileType).toBe("flex");
      expect(batch.cohortId).toBeTruthy();
      expect(batch.sourceId).toBeTruthy();
      expect(batch.sourceFilename).toMatch(/^flex-statement-/);
      expect(batch.sourceSection).toBeNull();
      expect(batch.cohortRole).toBe("DIRECT_FAILURE");
      expect(batch.rawStorageKey).toBe(identity.rawStorageKey);
    } finally {
      await cleanupRawImport(identity.rawSha256);
    }
  });

  dbIt("rolls back Flex trades when a later section is rejected", async () => {
    const marker = Date.now();
    const accountCode = `TEST-FLEX-${marker}`;
    const symbol = `TF${String(marker).slice(-6)}`;
    const csv = [
      "Trades",
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Currency",
      `${accountCode},2026-01-02 10:00:00,${symbol},NASDAQ,STK,BUY,1,10,0.5,USD`,
      "Positions",
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      `${accountCode},${symbol},NASDAQ,STK,2026-01-02,not-a-number,10,0,USD`,
    ].join("\n");
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      await expect(
        runFlexImport({ token: "token", queryId: "query", baseUrl: "https://flex.example.test" }),
      ).rejects.toThrow("quantity");

      const batches = await prisma.importBatch.findMany({
        where: { rawSha256: identity.rawSha256 },
        include: { rowErrors: true },
        orderBy: { fileType: "asc" },
      });
      const tradeBatch = batches.find((batch) => batch.fileType === "flex-trades");
      const positionBatch = batches.find((batch) => batch.fileType === "flex-positions");
      const landedExecution = await prisma.execution.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const artifact = await prisma.importArtifact.findUnique({ where: { storageKey: identity.rawStorageKey } });

      expect(landedExecution).toBeNull();
      expect(tradeBatch?.status).toBe("FAILED");
      expect(tradeBatch?.rowsImported).toBe(0);
      expect(tradeBatch?.rowsSeen).toBe(1);
      expect(tradeBatch?.rowsSkipped).toBe(1);
      expect(tradeBatch?.notes?.startsWith(IMPORT_FAILURE_ROLLED_BACK_MARKER)).toBe(true);
      expect(tradeBatch?.errorMessage).not.toContain("quantity");
      expect(positionBatch?.status).toBe("FAILED");
      expect(positionBatch?.rowsImported).toBe(0);
      expect(positionBatch?.rowsSeen).toBe(1);
      expect(positionBatch?.rowsSkipped).toBe(1);
      expect(positionBatch?.notes?.startsWith(IMPORT_FAILURE_DIRECT_MARKER)).toBe(true);
      expect(positionBatch?.errorMessage).toContain("quantity");
      expect(positionBatch?.rowErrors).toHaveLength(1);
      expect(tradeBatch?.rawStorageKey).toBe(positionBatch?.rawStorageKey);
      expect(tradeBatch?.cohortId).toBeTruthy();
      expect(tradeBatch?.cohortId).toBe(positionBatch?.cohortId);
      expect(tradeBatch?.sourceId).toBe(positionBatch?.sourceId);
      expect(tradeBatch?.sourceFilename).toBe(positionBatch?.sourceFilename);
      expect(tradeBatch?.sourceSection).toBe("trades");
      expect(positionBatch?.sourceSection).toBe("positions");
      expect(tradeBatch?.cohortRole).toBe("ROLLED_BACK");
      expect(positionBatch?.cohortRole).toBe("DIRECT_FAILURE");
      expect(tradeBatch?.importedAt).toEqual(positionBatch?.importedAt);
      expect(artifact?.content).toBe(csv);
    } finally {
      const account = await prisma.account.findUnique({ where: { ibkrAccount: accountCode } });
      if (account) {
        await prisma.execution.deleteMany({ where: { accountId: account.id } });
        await prisma.positionSnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.position.deleteMany({ where: { accountId: account.id } });
        await prisma.dailySnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.account.deleteMany({ where: { id: account.id } });
      }
      await prisma.instrument.deleteMany({ where: { symbol } });
      await cleanupRawImport(identity.rawSha256);
    }
  });

  dbIt("imports Flex positions as explicit partial snapshots", async () => {
    const marker = Date.now();
    const accountCode = `TEST-FLEX-PARTIAL-${marker}`;
    const importedSymbol = `TFP${String(marker).slice(-6)}`;
    const absentSymbol = `TFA${String(marker).slice(-6)}`;
    const csv = [
      "Positions",
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      `${accountCode},${importedSymbol},NASDAQ,STK,2026-01-02,3,10,0,USD`,
    ].join("\n");
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      const absent = await seedOpenPosition(accountCode, absentSymbol, 7);

      const result = await runFlexImport(
        { token: "token", queryId: "query", baseUrl: "https://flex.example.test" },
        {
          refreshExecutionAnalytics: async () => undefined,
          refreshClosedTrades: async () => undefined,
        },
      );

      const positionBatch = await prisma.importBatch.findFirstOrThrow({
        where: { rawSha256: identity.rawSha256, fileType: "flex-positions" },
      });
      const absentPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: absent.account.id, instrumentId: absent.instrument.id } },
      });

      expect(result.positions.positionSnapshotMode).toBe("partial");
      expect(positionBatch.positionSnapshotMode).toBe("PARTIAL");
      expect(positionBatch.cohortRole).toBe("MEMBER");
      expect(positionBatch.sourceSection).toBe("positions");
      expect(positionBatch.sourceFilename).toMatch(/^flex-statement-/);
      expect(positionBatch.notes).toContain("partial snapshot");
      expect(absentPosition?.quantity).toBe(7);
    } finally {
      const account = await prisma.account.findUnique({ where: { ibkrAccount: accountCode } });
      if (account) {
        await prisma.execution.deleteMany({ where: { accountId: account.id } });
        await prisma.positionSnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.position.deleteMany({ where: { accountId: account.id } });
        await prisma.dailySnapshot.deleteMany({ where: { accountId: account.id } });
        await prisma.account.deleteMany({ where: { id: account.id } });
      }
      await prisma.instrument.deleteMany({ where: { symbol: { in: [importedSymbol, absentSymbol] } } });
      await cleanupRawImport(identity.rawSha256);
    }
  }, 20_000);

  dbIt("retains committed Flex rows and marks the cohort failed when materialization fails", async () => {
    const marker = Date.now();
    const accountCode = `TEST-FLEX-MAT-${marker}`;
    const symbol = `TFM${String(marker).slice(-6)}`;
    const csv = [
      "Trades",
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Currency,TradeID",
      `${accountCode},2026-01-02 10:00:00,${symbol},NASDAQ,STK,BUY,1,10,0.5,USD,FLEX-MAT-${marker}`,
    ].join("\n");
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      await expect(
        runFlexImport(
          { token: "token", queryId: "query", baseUrl: "https://flex.example.test" },
          {
            refreshExecutionAnalytics: async () => {
              throw new Error("phase15 analytics refresh unavailable");
            },
          },
        ),
      ).rejects.toThrow("phase15 analytics refresh unavailable");

      const batch = await prisma.importBatch.findFirstOrThrow({ where: { rawSha256: identity.rawSha256 } });
      const execution = await prisma.execution.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const artifact = await prisma.importArtifact.findUnique({ where: { storageKey: identity.rawStorageKey } });

      expect(batch.status).toBe("MATERIALIZATION_FAILED");
      expect(batch.errorMessage).toContain("Materialization refresh failed");
      expect(batch.rowsImported).toBe(1);
      expect(execution).not.toBeNull();
      expect(artifact?.content).toBe(csv);
    } finally {
      const account = await prisma.account.findUnique({ where: { ibkrAccount: accountCode } });
      if (account) await prisma.account.delete({ where: { id: account.id } });
      await prisma.instrument.deleteMany({ where: { symbol } });
      await cleanupRawImport(identity.rawSha256);
    }
  });

  dbIt("recovers Flex final status failures instead of stranding rows applied", async () => {
    const marker = Date.now();
    const accountCode = `TEST-FLEX-FINAL-${marker}`;
    const symbol = `TFF${String(marker).slice(-6)}`;
    const csv = [
      "Trades",
      "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Currency,TradeID",
      `${accountCode},2026-01-02 10:00:00,${symbol},NASDAQ,STK,BUY,1,10,0.5,USD,FLEX-FINAL-${marker}`,
      "Positions",
      "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
      `${accountCode},${symbol},NASDAQ,STK,2026-01-02,1,10,0,USD`,
    ].join("\n");
    const identity = rawImportArchiveIdentity(csv);
    mockFlexStatement(csv);

    try {
      await expect(
        runFlexImport(
          { token: "token", queryId: "query", baseUrl: "https://flex.example.test" },
          {
            refreshExecutionAnalytics: async () => undefined,
            refreshClosedTrades: async () => undefined,
            importLifecycle: {
              markMaterialized: async () => {
                throw new Error("phase15 final status unavailable");
              },
              markMaterializationFailed: markImportBatchesMaterializationFailed,
            },
          },
        ),
      ).rejects.toThrow("phase15 final status unavailable");

      const batches = await prisma.importBatch.findMany({
        where: { rawSha256: identity.rawSha256 },
        orderBy: { fileType: "asc" },
      });
      const execution = await prisma.execution.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const position = await prisma.position.findFirst({
        where: { account: { ibkrAccount: accountCode }, instrument: { symbol } },
      });
      const artifact = await prisma.importArtifact.findUnique({ where: { storageKey: identity.rawStorageKey } });

      expect(batches).toHaveLength(2);
      expect(new Set(batches.map((batch) => batch.cohortId))).toEqual(new Set([batches[0].cohortId]));
      expect(batches.every((batch) => batch.status === "MATERIALIZATION_FAILED")).toBe(true);
      expect(batches.every((batch) => batch.errorMessage?.includes("Final import status update failed"))).toBe(true);
      expect(batches.every((batch) => batch.notes?.includes("post-import processing did not complete"))).toBe(true);
      expect(execution).not.toBeNull();
      expect(position).not.toBeNull();
      expect(artifact?.content).toBe(csv);
    } finally {
      const account = await prisma.account.findUnique({ where: { ibkrAccount: accountCode } });
      if (account) await prisma.account.delete({ where: { id: account.id } });
      await prisma.instrument.deleteMany({ where: { symbol } });
      await cleanupRawImport(identity.rawSha256);
    }
  });
});
