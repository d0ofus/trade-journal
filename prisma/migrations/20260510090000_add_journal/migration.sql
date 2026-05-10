-- CreateEnum
CREATE TYPE "JournalDirection" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'WATCHING', 'MISSED', 'PASSED', 'INVALIDATED', 'PLAYBOOK', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MacroSentiment" AS ENUM ('BULLISH', 'NEUTRAL', 'BEARISH');

-- CreateEnum
CREATE TYPE "JournalTagCategory" AS ENUM ('SETUP', 'LESSON', 'MISTAKE', 'CONTEXT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "JournalMarkerType" AS ENUM ('IDEAL_ENTRY', 'STOP', 'TARGET', 'IDEAL_EXIT', 'MISSED_TRIGGER', 'DECISION_POINT');

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "ideaDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "JournalDirection" NOT NULL DEFAULT 'LONG',
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "setup" TEXT,
    "timeframe" TEXT NOT NULL DEFAULT '1D',
    "macroSentiment" "MacroSentiment" NOT NULL DEFAULT 'NEUTRAL',
    "thesis" TEXT NOT NULL DEFAULT '',
    "trigger" TEXT NOT NULL DEFAULT '',
    "riskPlan" TEXT NOT NULL DEFAULT '',
    "idealExecutionPlan" TEXT NOT NULL DEFAULT '',
    "missedReason" TEXT NOT NULL DEFAULT '',
    "marketContext" TEXT NOT NULL DEFAULT '',
    "peerContext" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "lessonLearned" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalChart" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1D',
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "tradingViewLayoutJson" TEXT,
    "screenshotKey" TEXT,
    "screenshotUrl" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalChartMarker" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "markerType" "JournalMarkerType" NOT NULL,
    "time" TIMESTAMP(3),
    "price" DOUBLE PRECISION,
    "label" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalChartMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryTag" (
    "journalEntryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "category" "JournalTagCategory" NOT NULL DEFAULT 'CUSTOM',

    CONSTRAINT "JournalEntryTag_pkey" PRIMARY KEY ("journalEntryId","tagId","category")
);

-- CreateTable
CREATE TABLE "JournalContextSnapshot" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalContextSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLink" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "url" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalEntry_ideaDate_idx" ON "JournalEntry"("ideaDate");

-- CreateIndex
CREATE INDEX "JournalEntry_symbol_ideaDate_idx" ON "JournalEntry"("symbol", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalEntry_status_ideaDate_idx" ON "JournalEntry"("status", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalEntry_macroSentiment_ideaDate_idx" ON "JournalEntry"("macroSentiment", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalChart_journalEntryId_createdAt_idx" ON "JournalChart"("journalEntryId", "createdAt");

-- CreateIndex
CREATE INDEX "JournalChart_symbol_timeframe_idx" ON "JournalChart"("symbol", "timeframe");

-- CreateIndex
CREATE INDEX "JournalChartMarker_chartId_idx" ON "JournalChartMarker"("chartId");

-- CreateIndex
CREATE INDEX "JournalChartMarker_markerType_idx" ON "JournalChartMarker"("markerType");

-- CreateIndex
CREATE INDEX "JournalEntryTag_tagId_category_idx" ON "JournalEntryTag"("tagId", "category");

-- CreateIndex
CREATE INDEX "JournalContextSnapshot_journalEntryId_kind_createdAt_idx" ON "JournalContextSnapshot"("journalEntryId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "JournalLink_journalEntryId_linkType_idx" ON "JournalLink"("journalEntryId", "linkType");

-- CreateIndex
CREATE INDEX "JournalLink_targetType_targetId_idx" ON "JournalLink"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "JournalChart" ADD CONSTRAINT "JournalChart_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalChartMarker" ADD CONSTRAINT "JournalChartMarker_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "JournalChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryTag" ADD CONSTRAINT "JournalEntryTag_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryTag" ADD CONSTRAINT "JournalEntryTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalContextSnapshot" ADD CONSTRAINT "JournalContextSnapshot_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLink" ADD CONSTRAINT "JournalLink_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
