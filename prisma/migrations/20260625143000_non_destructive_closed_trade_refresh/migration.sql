ALTER TABLE "ClosedTrade" ADD COLUMN "isStale" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClosedTrade" ADD COLUMN "staleAt" TIMESTAMP(3);
ALTER TABLE "ClosedTrade" ADD COLUMN "staleReason" TEXT;

CREATE INDEX "ClosedTrade_isStale_tradeDate_idx" ON "ClosedTrade"("isStale", "tradeDate");
