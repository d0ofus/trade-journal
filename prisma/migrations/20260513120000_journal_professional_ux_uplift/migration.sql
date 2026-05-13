-- Additive journal-only fields for quick capture, review inboxes, and outcome audits.
ALTER TABLE "JournalEntry"
  ADD COLUMN "autoDraft" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "outcomeCalculatedAt" TIMESTAMP(3),
  ADD COLUMN "outcomeCalculationJson" TEXT;

CREATE INDEX "JournalEntry_autoDraft_updatedAt_idx" ON "JournalEntry"("autoDraft", "updatedAt");
CREATE INDEX "JournalEntry_reviewDueAt_idx" ON "JournalEntry"("reviewDueAt");

CREATE TABLE "JournalSavedView" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "viewType" TEXT NOT NULL,
  "filtersJson" TEXT NOT NULL DEFAULT '{}',
  "sortKey" TEXT,
  "sortDirection" TEXT NOT NULL DEFAULT 'desc',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "JournalSavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalSavedView_viewType_name_key" ON "JournalSavedView"("viewType", "name");
CREATE INDEX "JournalSavedView_viewType_updatedAt_idx" ON "JournalSavedView"("viewType", "updatedAt");

CREATE TABLE "JournalPlaybookExample" (
  "id" TEXT NOT NULL,
  "playbookId" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "chartId" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JournalPlaybookExample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalPlaybookExample_playbookId_journalEntryId_chartId_key"
  ON "JournalPlaybookExample"("playbookId", "journalEntryId", "chartId");
CREATE INDEX "JournalPlaybookExample_playbookId_sortOrder_idx" ON "JournalPlaybookExample"("playbookId", "sortOrder");
CREATE INDEX "JournalPlaybookExample_journalEntryId_idx" ON "JournalPlaybookExample"("journalEntryId");
CREATE INDEX "JournalPlaybookExample_chartId_idx" ON "JournalPlaybookExample"("chartId");

ALTER TABLE "JournalPlaybookExample"
  ADD CONSTRAINT "JournalPlaybookExample_playbookId_fkey"
  FOREIGN KEY ("playbookId") REFERENCES "JournalPlaybook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalPlaybookExample"
  ADD CONSTRAINT "JournalPlaybookExample_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalPlaybookExample"
  ADD CONSTRAINT "JournalPlaybookExample_chartId_fkey"
  FOREIGN KEY ("chartId") REFERENCES "JournalChart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
