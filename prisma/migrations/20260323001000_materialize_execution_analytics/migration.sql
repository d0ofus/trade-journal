CREATE TABLE "ExecutionAnalytics" (
    "executionId" TEXT NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "grossRealizedPnl" DOUBLE PRECISION NOT NULL,
    "cumulativePnl" DOUBLE PRECISION NOT NULL,
    "matchedQuantity" DOUBLE PRECISION NOT NULL,
    "avgHoldTimeMs" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionAnalytics_pkey" PRIMARY KEY ("executionId")
);

ALTER TABLE "ExecutionAnalytics" ADD CONSTRAINT "ExecutionAnalytics_executionId_fkey"
FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
