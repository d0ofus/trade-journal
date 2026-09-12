CREATE TABLE "WorkstationCandleChunk" (
  "key" TEXT PRIMARY KEY, "symbol" TEXT NOT NULL, "timeframe" TEXT NOT NULL, "source" TEXT NOT NULL,
  "start" TIMESTAMP(3) NOT NULL, "end" TIMESTAMP(3) NOT NULL, "payload" BYTEA NOT NULL,
  "checksum" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "barCount" INTEGER NOT NULL,
  "tradeWindow" BOOLEAN NOT NULL DEFAULT false, "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WorkstationCandleChunk_symbol_timeframe_source_start_idx" ON "WorkstationCandleChunk" ("symbol", "timeframe", "source", "start");
CREATE INDEX "WorkstationCandleChunk_tradeWindow_accessedAt_idx" ON "WorkstationCandleChunk" ("tradeWindow", "accessedAt");
CREATE TABLE "WorkstationCandleCoverage" (
  "chunkKey" TEXT PRIMARY KEY REFERENCES "WorkstationCandleChunk" ("key") ON DELETE CASCADE,
  "segments" TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE "WorkstationCandleJob" (
  "key" TEXT PRIMARY KEY, "symbol" TEXT NOT NULL, "timeframe" TEXT NOT NULL, "source" TEXT NOT NULL,
  "session" TEXT NOT NULL, "start" TIMESTAMP(3) NOT NULL, "end" TIMESTAMP(3) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 10, "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3), "leaseToken" TEXT,
  "lastError" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WorkstationCandleJob_status_priority_availableAt_idx" ON "WorkstationCandleJob" ("status", "priority", "availableAt");
CREATE TABLE "WorkstationCandleLease" ("key" TEXT PRIMARY KEY, "token" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
