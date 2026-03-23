CREATE TABLE "ClosedTrade" (
    "groupKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL,
    "closeTime" TIMESTAMP(3) NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "totalQuantity" DOUBLE PRECISION NOT NULL,
    "avgEntryPrice" DOUBLE PRECISION NOT NULL,
    "avgExitPrice" DOUBLE PRECISION NOT NULL,
    "grossRealizedPnl" DOUBLE PRECISION NOT NULL,
    "openingQuantity" DOUBLE PRECISION NOT NULL,
    "closingQuantity" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "totalCommission" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosedTrade_pkey" PRIMARY KEY ("groupKey")
);

CREATE TABLE "ClosedTradeExecution" (
    "id" TEXT NOT NULL,
    "closedTradeGroupKey" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "side" "Side" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ClosedTradeExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClosedTrade_tradeDate_idx" ON "ClosedTrade"("tradeDate");
CREATE INDEX "ClosedTrade_accountId_tradeDate_idx" ON "ClosedTrade"("accountId", "tradeDate");
CREATE INDEX "ClosedTrade_symbol_tradeDate_idx" ON "ClosedTrade"("symbol", "tradeDate");
CREATE INDEX "ClosedTradeExecution_closedTradeGroupKey_sortOrder_idx" ON "ClosedTradeExecution"("closedTradeGroupKey", "sortOrder");
CREATE INDEX "ClosedTradeExecution_executionId_idx" ON "ClosedTradeExecution"("executionId");
CREATE INDEX "ClosedTradeExecution_side_executedAt_idx" ON "ClosedTradeExecution"("side", "executedAt");

ALTER TABLE "ClosedTrade" ADD CONSTRAINT "ClosedTrade_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedTrade" ADD CONSTRAINT "ClosedTrade_instrumentId_fkey"
FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedTradeExecution" ADD CONSTRAINT "ClosedTradeExecution_closedTradeGroupKey_fkey"
FOREIGN KEY ("closedTradeGroupKey") REFERENCES "ClosedTrade"("groupKey") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedTradeExecution" ADD CONSTRAINT "ClosedTradeExecution_executionId_fkey"
FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
