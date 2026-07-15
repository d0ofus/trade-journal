ALTER TABLE "ClosedTradeChartLayout" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "ClosedTradeAnnotationState" (
  "closedTradeGroupKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClosedTradeAnnotationState_pkey" PRIMARY KEY ("closedTradeGroupKey")
);

ALTER TABLE "ClosedTradeAnnotationState"
  ADD CONSTRAINT "ClosedTradeAnnotationState_closedTradeGroupKey_fkey"
  FOREIGN KEY ("closedTradeGroupKey") REFERENCES "ClosedTrade"("groupKey") ON DELETE CASCADE ON UPDATE CASCADE;
