CREATE TYPE "ImportBatchStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

ALTER TABLE "ImportBatch" ADD COLUMN "status" "ImportBatchStatus" NOT NULL DEFAULT 'SUCCEEDED';
ALTER TABLE "ImportBatch" ADD COLUMN "rawSha256" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "rawBytes" INTEGER;
ALTER TABLE "ImportBatch" ADD COLUMN "rawStorageKey" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "parserVersion" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "errorMessage" TEXT;

CREATE INDEX "ImportBatch_status_importedAt_idx" ON "ImportBatch"("status", "importedAt");
CREATE INDEX "ImportBatch_rawSha256_idx" ON "ImportBatch"("rawSha256");
