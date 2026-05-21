-- Add standalone Notion-style journal inputs and app-native relation tags.
CREATE TYPE "JournalNotionRelationKind" AS ENUM (
  'ACCOUNT',
  'TYPE_OF_REVIEW',
  'TYPE_OF_TRADE',
  'CHART_PATTERN',
  'CONFLUENCE',
  'CHARACTERISTIC',
  'NEWS_IMPACT',
  'NARRATIVE',
  'ORDER_TYPE',
  'BAIS',
  'PSYCHOLOGY',
  'MISTAKE',
  'ENTRY_PERFORMANCE',
  'WEEKLY_REPORT',
  'PARENT_ITEM',
  'SUB_ITEM'
);

ALTER TABLE "JournalEntry"
  ADD COLUMN "tradeTitle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "entryEndAt" TIMESTAMP(3),
  ADD COLUMN "tradeStatus" TEXT,
  ADD COLUMN "exitMarked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "highAvat" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "indexSupportive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "daysConsolidating" DOUBLE PRECISION,
  ADD COLUMN "daysFromT" DOUBLE PRECISION,
  ADD COLUMN "xFrom50Sma" DOUBLE PRECISION,
  ADD COLUMN "stopLossPercent" DOUBLE PRECISION,
  ADD COLUMN "riskPercent" DOUBLE PRECISION,
  ADD COLUMN "maxRiskReward" DOUBLE PRECISION,
  ADD COLUMN "idealExecutionOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "idealStopLossOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "JournalEntry_tradeStatus_ideaDate_idx" ON "JournalEntry"("tradeStatus", "ideaDate");

CREATE TABLE "JournalNotionRelationTag" (
  "id" TEXT NOT NULL,
  "kind" "JournalNotionRelationKind" NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalNotionRelationTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalNotionRelationTag_kind_normalizedName_key"
  ON "JournalNotionRelationTag"("kind", "normalizedName");

CREATE INDEX "JournalNotionRelationTag_kind_name_idx"
  ON "JournalNotionRelationTag"("kind", "name");

CREATE TABLE "JournalEntryNotionRelation" (
  "journalEntryId" TEXT NOT NULL,
  "relationTagId" TEXT NOT NULL,
  CONSTRAINT "JournalEntryNotionRelation_pkey" PRIMARY KEY ("journalEntryId", "relationTagId")
);

CREATE INDEX "JournalEntryNotionRelation_relationTagId_idx"
  ON "JournalEntryNotionRelation"("relationTagId");

ALTER TABLE "JournalEntryNotionRelation"
  ADD CONSTRAINT "JournalEntryNotionRelation_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalEntryNotionRelation"
  ADD CONSTRAINT "JournalEntryNotionRelation_relationTagId_fkey"
  FOREIGN KEY ("relationTagId") REFERENCES "JournalNotionRelationTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
