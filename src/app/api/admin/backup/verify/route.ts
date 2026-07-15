import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  BackupRestorePlanError,
  buildBackupRestorePlan,
  summarizeBackupRestorePlan,
} from "@/lib/server/backup-restore";
import { requireApiSession } from "@/lib/server/api-auth";
import { prisma } from "@/lib/prisma";
import { readBackupSourceMetadata } from "@/lib/server/backup-freshness";
import type { buildBackupTableManifest } from "@/lib/server/backup-contract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseExportedAt(payload: unknown) {
  if (!isRecord(payload) || typeof payload.exportedAt !== "string") return null;
  const date = new Date(payload.exportedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceMetadataIssues(
  payload: unknown,
  tableManifest: ReturnType<typeof buildBackupTableManifest>,
  exportedAt: Date,
) {
  const source = readBackupSourceMetadata(payload);
  if (!source) {
    return {
      source: null,
      issues: [
        {
          code: "INVALID_BACKUP_SOURCE_METADATA",
          message: "Backup source metadata is missing or invalid.",
          path: "manifest.source",
        },
      ],
    };
  }

  const issues: Array<{ code: string; message: string; path: string }> = [];
  for (const [key, count] of Object.entries(tableManifest.rowCounts)) {
    if (key === "backupAudits") continue;
    if (source.rowCounts[key as keyof typeof source.rowCounts] !== count) {
      issues.push({
        code: "BACKUP_SOURCE_ROW_COUNT_MISMATCH",
        message: `Backup source row count for ${key} does not match the table manifest.`,
        path: `manifest.source.rowCounts.${key}`,
      });
    }
  }

  if (source.latestDataChangeAt && new Date(source.latestDataChangeAt).getTime() > exportedAt.getTime()) {
    issues.push({
      code: "BACKUP_SOURCE_AFTER_EXPORT",
      message: "Backup source latest data change cannot be after exportedAt.",
      path: "manifest.source.latestDataChangeAt",
    });
  }

  return { source, issues };
}

function serializedAudit(audit: {
  id: string;
  sha256: string;
  exportedAt: Date;
  verifiedAt: Date;
  payloadBytes: number;
  totalRows: number;
  tableCount: number;
  strippedFieldCount: number;
  warningCount: number;
  errorCount: number;
  sourceSignature: string | null;
  sourceLatestDataChangeAt: Date | null;
}) {
  return {
    id: audit.id,
    sha256: audit.sha256,
    exportedAt: audit.exportedAt.toISOString(),
    verifiedAt: audit.verifiedAt.toISOString(),
    payloadBytes: audit.payloadBytes,
    totalRows: audit.totalRows,
    tableCount: audit.tableCount,
    strippedFieldCount: audit.strippedFieldCount,
    warningCount: audit.warningCount,
    errorCount: audit.errorCount,
    sourceSignature: audit.sourceSignature,
    sourceLatestDataChangeAt: audit.sourceLatestDataChangeAt?.toISOString() ?? null,
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON backup payload." }, { status: 400 });
  }

  const sha256 = crypto.createHash("sha256").update(rawBody).digest("hex");

  try {
    const plan = buildBackupRestorePlan(payload);
    const summary = summarizeBackupRestorePlan(plan);
    const tableManifest = plan.validation.tableManifest;
    if (!tableManifest) {
      throw new Error("Backup restore plan did not include a table manifest.");
    }
    const exportedAt = parseExportedAt(payload);
    if (!exportedAt) {
      return NextResponse.json(
        { ok: false, sha256, error: "Backup exportedAt is missing or invalid." },
        { status: 422 },
      );
    }
    const sourceValidation = sourceMetadataIssues(payload, tableManifest, exportedAt);
    if (sourceValidation.issues.length > 0 || !sourceValidation.source) {
      return NextResponse.json(
        {
          ok: false,
          sha256,
          error: "Backup source metadata is invalid.",
          errors: sourceValidation.issues,
        },
        { status: 422 },
      );
    }
    const source = sourceValidation.source;
    const audit = await prisma.backupAudit.create({
      data: {
        sha256,
        exportedAt,
        payloadBytes: Buffer.byteLength(rawBody, "utf8"),
        totalRows: summary.totalRows,
        tableCount: summary.tableCount,
        strippedFieldCount: summary.strippedFieldCount,
        warningCount: summary.warnings.length,
        errorCount: 0,
        sourceSignature: source.signature,
        sourceCountsJson: JSON.stringify(source.rowCounts),
        sourceLatestDataChangeAt: source.latestDataChangeAt ? new Date(source.latestDataChangeAt) : null,
      },
    });
    revalidatePath("/settings");

    return NextResponse.json({
      ...summary,
      sha256,
      audit: serializedAudit(audit),
    });
  } catch (error) {
    if (!(error instanceof BackupRestorePlanError)) throw error;

    return NextResponse.json(
      {
        ok: false,
        sha256,
        error: error.message,
        errors: error.issues,
        warnings: error.validation.warnings,
        tableManifest: error.validation.tableManifest,
      },
      { status: 422 },
    );
  }
}
