DELETE FROM "JournalLink" duplicate
USING "JournalLink" keeper
WHERE duplicate."linkType" = 'REVIEW_SOURCE'
  AND duplicate."targetType" = 'CLOSED_TRADE'
  AND duplicate."targetId" IS NOT NULL
  AND keeper."linkType" = duplicate."linkType"
  AND keeper."targetType" = duplicate."targetType"
  AND keeper."targetId" = duplicate."targetId"
  AND (
    duplicate."createdAt" > keeper."createdAt"
    OR (duplicate."createdAt" = keeper."createdAt" AND duplicate."id" > keeper."id")
  );

CREATE UNIQUE INDEX "JournalLink_closed_trade_review_source_unique"
ON "JournalLink"("linkType", "targetType", "targetId")
WHERE "linkType" = 'REVIEW_SOURCE'
  AND "targetType" = 'CLOSED_TRADE'
  AND "targetId" IS NOT NULL;
