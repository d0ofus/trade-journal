-- CreateEnum
CREATE TYPE "JournalOutcomeStatus" AS ENUM ('UNREVIEWED', 'TRIGGERED', 'NEVER_TRIGGERED', 'WORKED_WITHOUT_ME', 'FAILED', 'STILL_DEVELOPING');

-- CreateEnum
CREATE TYPE "JournalMarketRegime" AS ENUM ('UNKNOWN', 'RISK_ON', 'MIXED', 'RISK_OFF');

-- CreateEnum
CREATE TYPE "JournalTrendState" AS ENUM ('UNKNOWN', 'BULLISH', 'NEUTRAL', 'BEARISH');

-- CreateEnum
CREATE TYPE "JournalChartPurpose" AS ENUM ('THESIS', 'TRIGGER', 'MARKET_CONTEXT', 'PEER_CONTEXT', 'FOLLOW_THROUGH', 'REVIEW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "JournalRuleCheckStatus" AS ENUM ('PASS', 'FAIL', 'NA');

-- CreateEnum
CREATE TYPE "JournalReviewPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "JournalActionStatus" AS ENUM ('OPEN', 'DONE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "playbookId" TEXT,
ADD COLUMN     "plannedEntry" DOUBLE PRECISION,
ADD COLUMN     "plannedStop" DOUBLE PRECISION,
ADD COLUMN     "plannedTarget1" DOUBLE PRECISION,
ADD COLUMN     "plannedTarget2" DOUBLE PRECISION,
ADD COLUMN     "plannedTarget3" DOUBLE PRECISION,
ADD COLUMN     "invalidationLevel" DOUBLE PRECISION,
ADD COLUMN     "expectedR" DOUBLE PRECISION,
ADD COLUMN     "actualTriggerAt" TIMESTAMP(3),
ADD COLUMN     "followThroughDays" INTEGER,
ADD COLUMN     "mfeR" DOUBLE PRECISION,
ADD COLUMN     "maeR" DOUBLE PRECISION,
ADD COLUMN     "bestExitR" DOUBLE PRECISION,
ADD COLUMN     "outcomeStatus" "JournalOutcomeStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "outcomeNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "confidenceScore" INTEGER,
ADD COLUMN     "planClarityScore" INTEGER,
ADD COLUMN     "preparationScore" INTEGER,
ADD COLUMN     "patienceScore" INTEGER,
ADD COLUMN     "ruleAdherenceScore" INTEGER,
ADD COLUMN     "emotionalState" TEXT,
ADD COLUMN     "wouldTakeAgain" BOOLEAN,
ADD COLUMN     "marketRegime" "JournalMarketRegime" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "spyTrend" "JournalTrendState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "qqqTrend" "JournalTrendState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "iwmTrend" "JournalTrendState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "sectorTrend" "JournalTrendState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "sectorEtf" TEXT,
ADD COLUMN     "breadthNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "catalystNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "relativeStrengthNotes" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "JournalChart" ADD COLUMN     "purpose" "JournalChartPurpose" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "compareSymbol" TEXT;

-- CreateTable
CREATE TABLE "JournalPlaybook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setupType" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "idealConditions" TEXT NOT NULL DEFAULT '',
    "invalidationRules" TEXT NOT NULL DEFAULT '',
    "marketRegimeFit" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalPlaybookRule" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SETUP',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalPlaybookRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryRuleCheck" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "playbookRuleId" TEXT,
    "status" "JournalRuleCheckStatus" NOT NULL DEFAULT 'NA',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntryRuleCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalReview" (
    "id" TEXT NOT NULL,
    "period" "JournalReviewPeriod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "bestIdea" TEXT NOT NULL DEFAULT '',
    "bestIdeaEntryId" TEXT,
    "worstMiss" TEXT NOT NULL DEFAULT '',
    "worstMissEntryId" TEXT,
    "recurringLesson" TEXT NOT NULL DEFAULT '',
    "nextFocus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalReviewAction" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "JournalActionStatus" NOT NULL DEFAULT 'OPEN',
    "journalEntryId" TEXT,
    "playbookId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalReviewAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalPlaybook_name_key" ON "JournalPlaybook"("name");

-- CreateIndex
CREATE INDEX "JournalPlaybook_archived_name_idx" ON "JournalPlaybook"("archived", "name");

-- CreateIndex
CREATE INDEX "JournalPlaybookRule_playbookId_sortOrder_idx" ON "JournalPlaybookRule"("playbookId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntryRuleCheck_journalEntryId_playbookRuleId_key" ON "JournalEntryRuleCheck"("journalEntryId", "playbookRuleId");

-- CreateIndex
CREATE INDEX "JournalEntryRuleCheck_journalEntryId_idx" ON "JournalEntryRuleCheck"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalEntryRuleCheck_playbookRuleId_status_idx" ON "JournalEntryRuleCheck"("playbookRuleId", "status");

-- CreateIndex
CREATE INDEX "JournalReview_period_startDate_idx" ON "JournalReview"("period", "startDate");

-- CreateIndex
CREATE INDEX "JournalReviewAction_reviewId_status_idx" ON "JournalReviewAction"("reviewId", "status");

-- CreateIndex
CREATE INDEX "JournalReviewAction_journalEntryId_idx" ON "JournalReviewAction"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalReviewAction_playbookId_idx" ON "JournalReviewAction"("playbookId");

-- CreateIndex
CREATE INDEX "JournalEntry_playbookId_ideaDate_idx" ON "JournalEntry"("playbookId", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalEntry_outcomeStatus_ideaDate_idx" ON "JournalEntry"("outcomeStatus", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalEntry_marketRegime_ideaDate_idx" ON "JournalEntry"("marketRegime", "ideaDate");

-- CreateIndex
CREATE INDEX "JournalChart_purpose_idx" ON "JournalChart"("purpose");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "JournalPlaybook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalPlaybookRule" ADD CONSTRAINT "JournalPlaybookRule_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "JournalPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryRuleCheck" ADD CONSTRAINT "JournalEntryRuleCheck_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryRuleCheck" ADD CONSTRAINT "JournalEntryRuleCheck_playbookRuleId_fkey" FOREIGN KEY ("playbookRuleId") REFERENCES "JournalPlaybookRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalReviewAction" ADD CONSTRAINT "JournalReviewAction_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "JournalReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
