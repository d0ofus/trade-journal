CREATE TABLE "ImportArtifact" (
    "storageKey" TEXT NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "rawBytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportArtifact_pkey" PRIMARY KEY ("storageKey")
);

CREATE UNIQUE INDEX "ImportArtifact_rawSha256_key" ON "ImportArtifact"("rawSha256");

UPDATE "ImportBatch"
SET "rawStorageKey" = NULL
WHERE "rawStorageKey" IS NOT NULL;

ALTER TABLE "ImportBatch"
ADD CONSTRAINT "ImportBatch_rawStorageKey_fkey"
FOREIGN KEY ("rawStorageKey") REFERENCES "ImportArtifact"("storageKey")
ON DELETE SET NULL ON UPDATE CASCADE;
