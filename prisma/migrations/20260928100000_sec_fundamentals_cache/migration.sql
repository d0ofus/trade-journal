CREATE TABLE "SecFundamentalsCache" (
  "key" TEXT NOT NULL,
  "payload" BYTEA NOT NULL,
  "bytes" INTEGER NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecFundamentalsCache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "SecFundamentalsCache_accessedAt_idx" ON "SecFundamentalsCache"("accessedAt");
