import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import {
  buildBackupReadinessManifest,
  buildImportArtifactBackupManifest,
  buildJournalScreenshotBackupAssets,
} from "@/lib/server/backup-assets";
import { buildBackupTableManifest } from "@/lib/server/backup-contract";
import { buildBackupSourceMetadata } from "@/lib/server/backup-freshness";
import { getLatestBackupRelevantUpdateAt } from "@/lib/server/queries";
import { BackupRestorePlanError, buildBackupRestorePlan } from "@/lib/server/backup-restore";
import { validateBackupRestoreDryRun } from "@/lib/server/backup-restore-validator";

const BACKUP_EXPORT_TRANSACTION_TIMEOUT_MS = 30_000;
const BACKUP_EXPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

export async function GET() {
  const authError = await requireApiSession();
  if (authError) return authError;

  const [
    accounts,
    instruments,
    positions,
    positionSnapshots,
    dailySnapshots,
    executions,
    executionTags,
    executionAnalytics,
    tradeNotes,
    dayNotes,
    dayNoteTags,
    symbolNotes,
    symbolNoteTags,
    closedTrades,
    closedTradeExecutions,
    closedTradeNotes,
    closedTradeLayouts,
    closedTradeAnnotationStates,
    closedTradeAnnotations,
    closedTradeTags,
    marketCandles,
    journalEntries,
    journalEntryTags,
    journalCharts,
    journalChartMarkers,
    journalContextSnapshots,
    journalLinks,
    journalRuleChecks,
    journalReviews,
    journalReviewActions,
    playbooks,
    playbookRules,
    playbookExamples,
    journalSavedViews,
    journalNotionRelationTags,
    journalEntryNotionRelations,
    tags,
    importBatches,
    importRowErrors,
    importArtifacts,
    materializationWatermarks,
    backupAudits,
    latestBackupRelevantUpdateAt,
  ] = await prisma.$transaction(
    async (tx) =>
      Promise.all([
        tx.account.findMany({ orderBy: { createdAt: "asc" } }),
        tx.instrument.findMany({ orderBy: { symbol: "asc" } }),
        tx.position.findMany({ orderBy: [{ accountId: "asc" }, { instrumentId: "asc" }] }),
        tx.positionSnapshot.findMany({ orderBy: [{ date: "asc" }, { accountId: "asc" }, { instrumentId: "asc" }] }),
        tx.dailySnapshot.findMany({ orderBy: [{ date: "asc" }, { accountId: "asc" }] }),
        tx.execution.findMany({ orderBy: { executedAt: "asc" } }),
        tx.executionTag.findMany({ orderBy: [{ executionId: "asc" }, { tagId: "asc" }] }),
        tx.executionAnalytics.findMany({ orderBy: { executionId: "asc" } }),
        tx.tradeNote.findMany({ orderBy: { updatedAt: "asc" } }),
        tx.dayNote.findMany({ orderBy: [{ date: "asc" }, { accountId: "asc" }] }),
        tx.dayNoteTag.findMany({ orderBy: [{ dayNoteId: "asc" }, { tagId: "asc" }] }),
        tx.symbolNote.findMany({ orderBy: [{ accountId: "asc" }, { instrumentId: "asc" }] }),
        tx.symbolNoteTag.findMany({ orderBy: [{ symbolNoteId: "asc" }, { tagId: "asc" }] }),
        tx.closedTrade.findMany({ orderBy: [{ closeTime: "asc" }, { groupKey: "asc" }] }),
        tx.closedTradeExecution.findMany({ orderBy: [{ closedTradeGroupKey: "asc" }, { sortOrder: "asc" }] }),
        tx.closedTradeNote.findMany({ orderBy: { updatedAt: "asc" } }),
        tx.closedTradeChartLayout.findMany({ orderBy: { updatedAt: "asc" } }),
        tx.closedTradeAnnotationState.findMany({ orderBy: { updatedAt: "asc" } }),
        tx.closedTradeAnnotation.findMany({ orderBy: { updatedAt: "asc" } }),
        tx.closedTradeTag.findMany({ include: { tag: true }, orderBy: { tag: { name: "asc" } } }),
        tx.marketCandle.findMany({ orderBy: [{ symbol: "asc" }, { timeframe: "asc" }, { time: "asc" }] }),
        tx.journalEntry.findMany({
          include: {
            tags: { include: { tag: true } },
            ruleChecks: true,
            contextSnapshots: true,
            links: true,
            notionRelations: { include: { relationTag: true } },
          },
          orderBy: { ideaDate: "asc" },
        }),
        tx.journalEntryTag.findMany({ orderBy: [{ journalEntryId: "asc" }, { tagId: "asc" }, { category: "asc" }] }),
        tx.journalChart.findMany({ include: { markers: true }, orderBy: { createdAt: "asc" } }),
        tx.journalChartMarker.findMany({ orderBy: [{ chartId: "asc" }, { time: "asc" }] }),
        tx.journalContextSnapshot.findMany({ orderBy: [{ journalEntryId: "asc" }, { createdAt: "asc" }] }),
        tx.journalLink.findMany({ orderBy: [{ journalEntryId: "asc" }, { createdAt: "asc" }] }),
        tx.journalEntryRuleCheck.findMany({ orderBy: [{ journalEntryId: "asc" }, { createdAt: "asc" }] }),
        tx.journalReview.findMany({ include: { actions: true }, orderBy: { startDate: "asc" } }),
        tx.journalReviewAction.findMany({ orderBy: [{ reviewId: "asc" }, { createdAt: "asc" }] }),
        tx.journalPlaybook.findMany({ include: { rules: true, examples: true }, orderBy: { name: "asc" } }),
        tx.journalPlaybookRule.findMany({ orderBy: [{ playbookId: "asc" }, { sortOrder: "asc" }] }),
        tx.journalPlaybookExample.findMany({ orderBy: [{ playbookId: "asc" }, { createdAt: "asc" }] }),
        tx.journalSavedView.findMany({ orderBy: [{ viewType: "asc" }, { updatedAt: "asc" }] }),
        tx.journalNotionRelationTag.findMany({ orderBy: { name: "asc" } }),
        tx.journalEntryNotionRelation.findMany({ orderBy: [{ journalEntryId: "asc" }, { relationTagId: "asc" }] }),
        tx.tag.findMany({ orderBy: { name: "asc" } }),
        tx.importBatch.findMany({ orderBy: { importedAt: "asc" } }),
        tx.importRowError.findMany({ orderBy: [{ importBatchId: "asc" }, { rowNumber: "asc" }, { createdAt: "asc" }] }),
        tx.importArtifact.findMany({ orderBy: { createdAt: "asc" } }),
        tx.materializationWatermark.findMany({ orderBy: { key: "asc" } }),
        tx.backupAudit.findMany({ orderBy: { verifiedAt: "asc" } }),
        getLatestBackupRelevantUpdateAt(tx),
      ] as const),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: BACKUP_EXPORT_TRANSACTION_TIMEOUT_MS,
      maxWait: BACKUP_EXPORT_TRANSACTION_MAX_WAIT_MS,
    },
  );

  const journalScreenshotAssets = await buildJournalScreenshotBackupAssets(journalCharts);
  const importArtifactManifest = buildImportArtifactBackupManifest(importBatches, importArtifacts);
  const tablePayload = {
    accounts,
    instruments,
    positions,
    positionSnapshots,
    dailySnapshots,
    executions,
    executionTags,
    executionAnalytics,
    tradeNotes,
    dayNotes,
    dayNoteTags,
    symbolNotes,
    symbolNoteTags,
    closedTrades,
    closedTradeExecutions,
    closedTradeNotes,
    closedTradeLayouts,
    closedTradeAnnotationStates,
    closedTradeAnnotations,
    closedTradeTags,
    marketCandles,
    journalEntries,
    journalEntryTags,
    journalCharts,
    journalChartMarkers,
    journalContextSnapshots,
    journalLinks,
    journalRuleChecks,
    journalReviews,
    journalReviewActions,
    playbooks,
    playbookRules,
    playbookExamples,
    journalSavedViews,
    journalNotionRelationTags,
    journalEntryNotionRelations,
    tags,
    importBatches,
    importRowErrors,
    importArtifacts,
    materializationWatermarks,
    backupAudits,
  };
  const tableManifest = buildBackupTableManifest(tablePayload);
  const source = buildBackupSourceMetadata({
    latestDataChangeAt: latestBackupRelevantUpdateAt,
    rowCounts: tableManifest.rowCounts,
  });
  const backupManifest = buildBackupReadinessManifest({ journalScreenshotAssets, importArtifactManifest, tableManifest, source });

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    manifest: backupManifest,
    ...tablePayload,
    assets: {
      journalScreenshots: journalScreenshotAssets,
    },
  };
  const serializedPayload = JSON.stringify(payload, null, 2);
  const serializedBackupPayload = JSON.parse(serializedPayload);
  const restoreDryRun = validateBackupRestoreDryRun(serializedBackupPayload);

  if (!restoreDryRun.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Backup restore dry-run failed. Refusing to export a structurally unsafe backup.",
        errors: restoreDryRun.errors,
        warnings: restoreDryRun.warnings,
      },
      { status: 500 },
    );
  }

  try {
    buildBackupRestorePlan(serializedBackupPayload);
  } catch (error) {
    if (!(error instanceof BackupRestorePlanError)) throw error;

    return NextResponse.json(
      {
        ok: false,
        error: "Backup restore plan failed. Refusing to export a backup that cannot be converted into restore rows.",
        errors: error.issues,
        warnings: error.validation.warnings,
      },
      { status: 500 },
    );
  }

  return new NextResponse(serializedPayload, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="trade-journal-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
