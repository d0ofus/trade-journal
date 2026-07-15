DELETE FROM "ClosedTradeExecution" duplicate
USING "ClosedTradeExecution" keeper
WHERE duplicate.ctid < keeper.ctid
  AND duplicate."closedTradeGroupKey" = keeper."closedTradeGroupKey"
  AND duplicate."executionId" = keeper."executionId"
  AND duplicate."sortOrder" = keeper."sortOrder";

CREATE UNIQUE INDEX "ClosedTradeExecution_closedTradeGroupKey_executionId_sortOrder_key"
ON "ClosedTradeExecution"("closedTradeGroupKey", "executionId", "sortOrder");
