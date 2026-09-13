CREATE TABLE "WorkstationTradeView" (
  "groupKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "view" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkstationTradeView_pkey" PRIMARY KEY ("groupKey")
);
