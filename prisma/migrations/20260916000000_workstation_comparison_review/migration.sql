ALTER TABLE "JournalEntry" ADD COLUMN "templateData" JSONB;
ALTER TABLE "WorkstationCandleChunk" ADD COLUMN "supplementary" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "WorkstationMetricCache" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "sessionDate" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "bytes" INTEGER NOT NULL,
  "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WorkstationMetricCache_symbol_sessionDate_provider_version_key" ON "WorkstationMetricCache"("symbol", "sessionDate", "provider", "version");
CREATE INDEX "WorkstationMetricCache_accessedAt_idx" ON "WorkstationMetricCache"("accessedAt");
