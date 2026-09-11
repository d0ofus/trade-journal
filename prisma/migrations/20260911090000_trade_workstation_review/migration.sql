-- Additive: existing reviews and annotation records are preserved.
ALTER TABLE "ClosedTradeNote" ADD COLUMN "workstationJson" TEXT;
ALTER TABLE "ClosedTradeNote" ADD COLUMN "workstationVersion" INTEGER NOT NULL DEFAULT 0;
