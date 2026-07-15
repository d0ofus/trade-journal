import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewCsv } from "@/lib/import/ibkr-parser";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import { prisma } from "@/lib/prisma";

const mocks = vi.hoisted(() => ({
  refreshMaterializedClosedTrades: vi.fn(),
  refreshMaterializedExecutionAnalytics: vi.fn(),
  rejectE2eBlockedMutation: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eBlockedMutation: mocks.rejectE2eBlockedMutation,
}));

vi.mock("@/lib/server/closed-trades-materialized", () => ({
  refreshMaterializedClosedTrades: mocks.refreshMaterializedClosedTrades,
}));

vi.mock("@/lib/server/execution-analytics-materialized", () => ({
  refreshMaterializedExecutionAnalytics: mocks.refreshMaterializedExecutionAnalytics,
}));

function executionCsv(accountCode: string, symbol: string) {
  return [
    "ClientAccountID,DateTime,Symbol,Exchange,AssetClass,Buy/Sell,Quantity,TradePrice,IBCommission,Currency,OrderID",
    `${accountCode},2026-06-21 10:00:00,${symbol},NASDAQ,STK,BUY,1,10,0.5,USD,ROUTE-1`,
  ].join("\n");
}

function positionCsv(accountCode: string, symbol: string, reportDate: string) {
  return [
    "ClientAccountID,Symbol,Exchange,AssetClass,ReportDate,Quantity,AvgCost,UnrealizedPnl,Currency",
    `${accountCode},${symbol},NASDAQ,STK,${reportDate},12,10,0,USD`,
  ].join("\n");
}

function importRequest(params: {
  executionFilename: string;
  executionContent: string;
  positionFilename: string;
  positionContent: string;
}) {
  const executionPreview = previewCsv(params.executionFilename, params.executionContent);
  const positionPreview = previewCsv(params.positionFilename, params.positionContent);
  const formData = new FormData();

  formData.append("action", "commit");
  formData.append("files", new File([params.executionContent], params.executionFilename, { type: "text/csv" }));
  formData.append("files", new File([params.positionContent], params.positionFilename, { type: "text/csv" }));
  formData.append(
    "mappingByFile",
    JSON.stringify({
      [params.executionFilename]: executionPreview.mapping,
      [params.positionFilename]: positionPreview.mapping,
    }),
  );
  formData.append(
    "kindByFile",
    JSON.stringify({
      [params.executionFilename]: "executions",
      [params.positionFilename]: "positions",
    }),
  );
  formData.append("positionSnapshotModeByFile", JSON.stringify({ [params.positionFilename]: "full" }));

  return new NextRequest("http://localhost/api/import", {
    method: "POST",
    body: formData,
  });
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

async function cleanupRouteImportScenario(params: {
  accountCode: string;
  symbols: string[];
  filenames: string[];
  rawContents: string[];
}) {
  await prisma.importBatch.deleteMany({ where: { filename: { in: params.filenames } } });
  await prisma.importArtifact.deleteMany({
    where: { storageKey: { in: params.rawContents.map((content) => rawImportArchiveIdentity(content).rawStorageKey) } },
  });

  const account = await prisma.account.findUnique({ where: { ibkrAccount: params.accountCode } });
  if (account) {
    await prisma.execution.deleteMany({ where: { accountId: account.id } });
    await prisma.positionSnapshot.deleteMany({ where: { accountId: account.id } });
    await prisma.position.deleteMany({ where: { accountId: account.id } });
    await prisma.dailySnapshot.deleteMany({ where: { accountId: account.id } });
    await prisma.account.deleteMany({ where: { id: account.id } });
  }
  await prisma.instrument.deleteMany({ where: { symbol: { in: params.symbols } } });
}

describe("/api/import route", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.rejectE2eBlockedMutation.mockReturnValue(null);
    mocks.refreshMaterializedClosedTrades.mockResolvedValue(undefined);
    mocks.refreshMaterializedExecutionAnalytics.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated commits before parsing uploaded files", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { POST } = await import("./route");

    const response = await POST(
      importRequest({
        executionFilename: "unauth-executions.csv",
        executionContent: executionCsv("UNAUTH", "UNAUTHX"),
        positionFilename: "unauth-positions.csv",
        positionContent: positionCsv("UNAUTH", "UNAUTHP", "2026-06-20"),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.rejectE2eBlockedMutation).not.toHaveBeenCalled();
    expect(mocks.refreshMaterializedExecutionAnalytics).not.toHaveBeenCalled();
    expect(mocks.refreshMaterializedClosedTrades).not.toHaveBeenCalled();
  });

  dbIt("rolls back all multipart commit row writes when a later full-position file is rejected", async () => {
    const marker = Date.now();
    const accountCode = `ROUTE-ATOMIC-${marker}`;
    const executionSymbol = `RAX${String(marker).slice(-6)}`;
    const keptSymbol = `RAK${String(marker).slice(-6)}`;
    const protectedSymbol = `RAP${String(marker).slice(-6)}`;
    const executionFilename = `route-executions-${marker}.csv`;
    const positionFilename = `route-stale-positions-${marker}.csv`;
    const executionContent = executionCsv(accountCode, executionSymbol);
    const positionContent = positionCsv(accountCode, keptSymbol, "2026-06-20");
    const rawContents = [executionContent, positionContent];
    const filenames = [executionFilename, positionFilename];

    try {
      const kept = await seedOpenPosition(accountCode, keptSymbol, 10);
      const protectedPosition = await seedOpenPosition(accountCode, protectedSymbol, 5);
      await seedPositionSnapshot(kept.account.id, kept.instrument.id, "2026-06-22", 10);
      const { POST } = await import("./route");

      const response = await POST(
        importRequest({
          executionFilename,
          executionContent,
          positionFilename,
          positionContent,
        }),
      );
      const body = await response.json();

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
        where: { storageKey: { in: rawContents.map((content) => rawImportArchiveIdentity(content).rawStorageKey) } },
      });

      expect(response.status).toBe(400);
      expect(body.error).toContain("stale");
      expect(body.error).toContain("2026-06-20");
      expect(body.error).toContain("2026-06-22");
      expect(landedExecution).toBeNull();
      expect(executionInstrument).toBeNull();
      expect(keptAfter?.quantity).toBe(10);
      expect(protectedAfter?.quantity).toBe(5);
      expect(batches).toHaveLength(2);
      expect(batches.map((batch) => batch.status)).toEqual(["FAILED", "FAILED"]);
      expect(batches.every((batch) => batch.rowsImported === 0)).toBe(true);
      expect(batches.every((batch) => batch.rowsSkipped === batch.rowsSeen)).toBe(true);
      expect(batches.some((batch) => batch.positionSnapshotMode === "FULL")).toBe(true);
      expect(artifactCount).toBe(2);
      expect(mocks.refreshMaterializedExecutionAnalytics).not.toHaveBeenCalled();
      expect(mocks.refreshMaterializedClosedTrades).not.toHaveBeenCalled();
    } finally {
      await cleanupRouteImportScenario({
        accountCode,
        symbols: [executionSymbol, keptSymbol, protectedSymbol],
        filenames,
        rawContents,
      });
    }
  });
});
