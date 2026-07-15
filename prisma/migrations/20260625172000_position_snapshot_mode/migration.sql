CREATE TYPE "PositionSnapshotMode" AS ENUM ('PARTIAL', 'FULL');

ALTER TABLE "ImportBatch"
ADD COLUMN "positionSnapshotMode" "PositionSnapshotMode";

UPDATE "ImportBatch"
SET "positionSnapshotMode" = 'PARTIAL'
WHERE "fileType" IN ('positions', 'flex-positions');
