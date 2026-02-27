-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ibkrAccount" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'STOCK',
    "currency" TEXT NOT NULL DEFAULT 'USD'
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT,
    "rowsSeen" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "ImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "executedAt" DATETIME NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "price" REAL NOT NULL,
    "commission" REAL NOT NULL DEFAULT 0,
    "fees" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Execution_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Execution_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Execution_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "avgCost" REAL NOT NULL,
    "unrealizedPnl" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Position_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "equity" REAL,
    "realizedPnl" REAL,
    "unrealizedPnl" REAL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailySnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExecutionTag" (
    "executionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("executionId", "tagId"),
    CONSTRAINT "ExecutionTag_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeNote_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DayNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DayNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SymbolNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SymbolNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SymbolNote_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DayNoteTag" (
    "dayNoteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("dayNoteId", "tagId"),
    CONSTRAINT "DayNoteTag_dayNoteId_fkey" FOREIGN KEY ("dayNoteId") REFERENCES "DayNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DayNoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SymbolNoteTag" (
    "symbolNoteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("symbolNoteId", "tagId"),
    CONSTRAINT "SymbolNoteTag_symbolNoteId_fkey" FOREIGN KEY ("symbolNoteId") REFERENCES "SymbolNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SymbolNoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_ibkrAccount_key" ON "Account"("ibkrAccount");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_exchange_assetType_key" ON "Instrument"("symbol", "exchange", "assetType");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_dedupeKey_key" ON "Execution"("dedupeKey");

-- CreateIndex
CREATE INDEX "Execution_executedAt_idx" ON "Execution"("executedAt");

-- CreateIndex
CREATE INDEX "Execution_accountId_executedAt_idx" ON "Execution"("accountId", "executedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Position_accountId_instrumentId_key" ON "Position"("accountId", "instrumentId");

-- CreateIndex
CREATE INDEX "DailySnapshot_date_idx" ON "DailySnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySnapshot_accountId_date_key" ON "DailySnapshot"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TradeNote_executionId_key" ON "TradeNote"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "DayNote_accountId_date_key" ON "DayNote"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SymbolNote_accountId_instrumentId_key" ON "SymbolNote"("accountId", "instrumentId");
