CREATE TABLE "ImportRowError" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "severity" TEXT NOT NULL DEFAULT 'ERROR',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowError_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportRowError_importBatchId_idx" ON "ImportRowError"("importBatchId");
CREATE INDEX "ImportRowError_code_idx" ON "ImportRowError"("code");

ALTER TABLE "ImportRowError"
ADD CONSTRAINT "ImportRowError_importBatchId_fkey"
FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
