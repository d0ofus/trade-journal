-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "quantity" REAL NOT NULL,
    "avgCost" REAL NOT NULL,
    "unrealizedPnl" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PositionSnapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClosedTradeNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PositionSnapshot_accountId_date_idx" ON "PositionSnapshot"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PositionSnapshot_accountId_instrumentId_date_key" ON "PositionSnapshot"("accountId", "instrumentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ClosedTradeNote_groupKey_key" ON "ClosedTradeNote"("groupKey");
