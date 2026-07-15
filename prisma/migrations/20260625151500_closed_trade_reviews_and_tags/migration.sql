ALTER TABLE "ClosedTradeNote" ADD COLUMN "setup" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "thesis" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "entryReview" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "exitReview" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "mistake" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "lesson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ClosedTradeNote" ADD COLUMN "followUp" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ClosedTradeTag" (
  "closedTradeGroupKey" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,

  CONSTRAINT "ClosedTradeTag_pkey" PRIMARY KEY ("closedTradeGroupKey", "tagId")
);

CREATE INDEX "ClosedTradeTag_tagId_idx" ON "ClosedTradeTag"("tagId");

ALTER TABLE "ClosedTradeTag"
  ADD CONSTRAINT "ClosedTradeTag_closedTradeGroupKey_fkey"
  FOREIGN KEY ("closedTradeGroupKey") REFERENCES "ClosedTrade"("groupKey") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedTradeTag"
  ADD CONSTRAINT "ClosedTradeTag_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
