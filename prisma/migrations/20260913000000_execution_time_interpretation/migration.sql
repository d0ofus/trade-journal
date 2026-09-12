CREATE TABLE "ExecutionTimeInterpretation" (
  "id" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "basis" TEXT NOT NULL DEFAULT 'user-confirmed',
  "normalizerVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceHash" TEXT NOT NULL,
  "parserVersion" TEXT,
  "fingerprint" TEXT NOT NULL,
  "rowsJson" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExecutionTimeInterpretation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExecutionTimeInterpretation_importBatchId_key" ON "ExecutionTimeInterpretation"("importBatchId");
ALTER TABLE "ExecutionTimeInterpretation" ADD CONSTRAINT "ExecutionTimeInterpretation_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
