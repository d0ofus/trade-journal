import { afterEach, describe, expect, it, vi } from "vitest";

import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";
import { runFlexImport } from "@/lib/server/flex-service";

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
      expect(tradeBatch?.errorMessage).toContain("quantity");
      expect(positionBatch?.status).toBe("FAILED");
      expect(positionBatch?.rowsImported).toBe(0);
      expect(positionBatch?.rowErrors).toHaveLength(1);
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

      const result = await runFlexImport({ token: "token", queryId: "query", baseUrl: "https://flex.example.test" });

      const positionBatch = await prisma.importBatch.findFirstOrThrow({
        where: { rawSha256: identity.rawSha256, fileType: "flex-positions" },
      });
      const absentPosition = await prisma.position.findUnique({
        where: { accountId_instrumentId: { accountId: absent.account.id, instrumentId: absent.instrument.id } },
      });

      expect(result.positions.positionSnapshotMode).toBe("partial");
      expect(positionBatch.positionSnapshotMode).toBe("PARTIAL");
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
});
