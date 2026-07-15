DO $$
DECLARE
  duplicate_group_key TEXT;
  duplicate_execution_id TEXT;
  duplicate_sort_order INTEGER;
BEGIN
  SELECT "closedTradeGroupKey", "executionId"
  INTO duplicate_group_key, duplicate_execution_id
  FROM "ClosedTradeExecution"
  GROUP BY "closedTradeGroupKey", "executionId"
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot enforce ClosedTradeExecution uniqueness on (closedTradeGroupKey, executionId): duplicate key (%, %) exists.',
      duplicate_group_key,
      duplicate_execution_id;
  END IF;

  SELECT "closedTradeGroupKey", "sortOrder"
  INTO duplicate_group_key, duplicate_sort_order
  FROM "ClosedTradeExecution"
  GROUP BY "closedTradeGroupKey", "sortOrder"
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot enforce ClosedTradeExecution uniqueness on (closedTradeGroupKey, sortOrder): duplicate key (%, %) exists.',
      duplicate_group_key,
      duplicate_sort_order;
  END IF;
END $$;

DROP INDEX IF EXISTS "ClosedTradeExecution_closedTradeGroupKey_executionId_sortOrder_";
DROP INDEX IF EXISTS "ClosedTradeExecution_closedTradeGroupKey_executionId_sortOrder_key";

CREATE UNIQUE INDEX "ClosedTradeExecution_closedTradeGroupKey_executionId_key"
ON "ClosedTradeExecution"("closedTradeGroupKey", "executionId");

CREATE UNIQUE INDEX "ClosedTradeExecution_closedTradeGroupKey_sortOrder_key"
ON "ClosedTradeExecution"("closedTradeGroupKey", "sortOrder");

ALTER TABLE "Execution" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "PositionSnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "status" SET DEFAULT 'STARTED';
