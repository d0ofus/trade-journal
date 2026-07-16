CREATE TYPE "ImportCohortRole" AS ENUM ('MEMBER', 'DIRECT_FAILURE', 'ROLLED_BACK');

ALTER TABLE "ImportBatch"
ADD COLUMN "cohortId" TEXT,
ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceFilename" TEXT,
ADD COLUMN "sourceSection" TEXT,
ADD COLUMN "cohortRole" "ImportCohortRole";

CREATE INDEX "ImportBatch_importedAt_id_idx" ON "ImportBatch"("importedAt", "id");
CREATE INDEX "ImportBatch_cohortId_importedAt_id_idx" ON "ImportBatch"("cohortId", "importedAt", "id");
CREATE INDEX "ImportBatch_sourceId_idx" ON "ImportBatch"("sourceId");
