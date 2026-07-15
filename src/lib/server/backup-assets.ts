import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import type { buildBackupTableManifest } from "@/lib/server/backup-contract";

export type JournalScreenshotBackupChart = {
  id: string;
  journalEntryId: string;
  screenshotKey: string | null;
  screenshotUrl: string | null;
  mimeType: string | null;
};

export type JournalScreenshotBackupAsset = {
  chartId: string;
  journalEntryId: string;
  screenshotKey: string | null;
  screenshotUrl: string | null;
  embedded: boolean;
  mimeType: string | null;
  bytes: number | null;
  sha256?: string;
  dataUrl?: string;
  reason?: string;
};

export type ImportArtifactBackupBatch = {
  id: string;
  filename: string;
  rawSha256: string | null;
  rawBytes: number | null;
  rawStorageKey: string | null;
};

export type ImportArtifactBackupArtifact = {
  storageKey: string;
  rawSha256: string;
  rawBytes: number;
  content: string;
};

type BuildJournalScreenshotBackupAssetsOptions = {
  baseDir?: string;
  readLocalFile?: (absolutePath: string) => Promise<Buffer>;
  includeDataUrl?: boolean;
};

function extensionMimeType(value: string | null | undefined) {
  const lower = (value ?? "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

export function inspectInlineDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0) return null;
  return {
    mimeType: match[1],
    bytes: buffer.byteLength,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function localScreenshotRelativePath(chart: JournalScreenshotBackupChart) {
  if (chart.screenshotKey?.startsWith("local:")) {
    return chart.screenshotKey.slice("local:".length);
  }
  if (chart.screenshotUrl?.startsWith("/journal-screenshots/")) {
    return chart.screenshotUrl.slice("/journal-screenshots/".length);
  }
  return null;
}

function resolveLocalScreenshotPath(baseDir: string, relativePath: string) {
  const resolvedBase = path.resolve(/*turbopackIgnore: true*/ baseDir);
  const resolvedPath = path.resolve(/*turbopackIgnore: true*/ resolvedBase, relativePath);
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(`${resolvedBase}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

export async function buildJournalScreenshotBackupAssets(
  charts: JournalScreenshotBackupChart[],
  options: BuildJournalScreenshotBackupAssetsOptions = {},
) {
  const baseDir = options.baseDir ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "journal-screenshots");
  const readLocalFile = options.readLocalFile ?? readFile;
  const includeDataUrl = options.includeDataUrl ?? true;
  const assets: JournalScreenshotBackupAsset[] = [];

  for (const chart of charts) {
    if (!chart.screenshotKey && !chart.screenshotUrl) continue;

    if (chart.screenshotUrl?.startsWith("data:")) {
      const parsed = inspectInlineDataUrl(chart.screenshotUrl);
      assets.push({
        chartId: chart.id,
        journalEntryId: chart.journalEntryId,
        screenshotKey: chart.screenshotKey,
        screenshotUrl: chart.screenshotUrl,
        embedded: Boolean(parsed),
        mimeType: parsed?.mimeType ?? chart.mimeType,
        bytes: parsed?.bytes ?? null,
        sha256: parsed?.sha256,
        dataUrl: includeDataUrl ? chart.screenshotUrl : undefined,
        reason: parsed ? undefined : "Inline screenshot data URL could not be parsed.",
      });
      continue;
    }

    const relativePath = localScreenshotRelativePath(chart);
    if (relativePath) {
      const localPath = resolveLocalScreenshotPath(baseDir, relativePath);
      if (!localPath) {
        assets.push({
          chartId: chart.id,
          journalEntryId: chart.journalEntryId,
          screenshotKey: chart.screenshotKey,
          screenshotUrl: chart.screenshotUrl,
          embedded: false,
          mimeType: chart.mimeType,
          bytes: null,
          reason: "Local screenshot path is outside the screenshot directory.",
        });
        continue;
      }

      try {
        const buffer = await readLocalFile(/*turbopackIgnore: true*/ localPath);
        const mimeType = chart.mimeType ?? extensionMimeType(localPath);
        assets.push({
          chartId: chart.id,
          journalEntryId: chart.journalEntryId,
          screenshotKey: chart.screenshotKey,
          screenshotUrl: chart.screenshotUrl,
          embedded: true,
          mimeType,
          bytes: buffer.byteLength,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
          dataUrl: includeDataUrl ? `data:${mimeType};base64,${buffer.toString("base64")}` : undefined,
        });
      } catch {
        assets.push({
          chartId: chart.id,
          journalEntryId: chart.journalEntryId,
          screenshotKey: chart.screenshotKey,
          screenshotUrl: chart.screenshotUrl,
          embedded: false,
          mimeType: chart.mimeType,
          bytes: null,
          reason: "Local screenshot file could not be read.",
        });
      }
      continue;
    }

    assets.push({
      chartId: chart.id,
      journalEntryId: chart.journalEntryId,
      screenshotKey: chart.screenshotKey,
      screenshotUrl: chart.screenshotUrl,
      embedded: false,
      mimeType: chart.mimeType,
      bytes: null,
      reason: "External screenshot storage is referenced but not embedded.",
    });
  }

  return assets;
}

export function buildJournalScreenshotBackupManifest(journalScreenshotAssets: JournalScreenshotBackupAsset[]) {
  const completeAssets = journalScreenshotAssets.filter((asset) => asset.embedded && asset.bytes != null && Boolean(asset.sha256));
  return {
    total: journalScreenshotAssets.length,
    embedded: completeAssets.length,
    missing: journalScreenshotAssets.length - completeAssets.length,
    complete: journalScreenshotAssets.every((asset) => asset.embedded && asset.bytes != null && Boolean(asset.sha256)),
    warnings: journalScreenshotAssets
      .filter((asset) => !asset.embedded || asset.bytes == null || !asset.sha256)
      .map((asset) => ({
        chartId: asset.chartId,
        screenshotKey: asset.screenshotKey,
        screenshotUrl: asset.screenshotUrl,
        reason: asset.reason ?? "Screenshot was not embedded.",
      })),
  };
}

export function buildImportArtifactBackupManifest(
  importBatches: ImportArtifactBackupBatch[],
  importArtifacts: ImportArtifactBackupArtifact[],
) {
  const artifactsByKey = new Map(importArtifacts.map((artifact) => [artifact.storageKey, artifact]));
  const warnings: Array<{
    type: "ARTIFACT_CONTENT_MISMATCH" | "BATCH_ARTIFACT_MISMATCH" | "MISSING_ARCHIVED_IMPORT_BATCH";
    storageKey: string | null;
    batchId?: string;
    filename?: string;
    rawSha256?: string | null;
    computedRawSha256?: string;
    rawBytes?: number | null;
    computedRawBytes?: number;
    expectedStorageKey?: string;
    mismatches: string[];
  }> = [];

  for (const artifact of importArtifacts) {
    const computed = rawImportArchiveIdentity(artifact.content);
    const mismatches = [
      artifact.storageKey !== computed.rawStorageKey ? "storageKey" : "",
      artifact.rawSha256 !== computed.rawSha256 ? "rawSha256" : "",
      artifact.rawBytes !== computed.rawBytes ? "rawBytes" : "",
    ].filter(Boolean);

    if (mismatches.length > 0) {
      warnings.push({
        type: "ARTIFACT_CONTENT_MISMATCH",
        storageKey: artifact.storageKey,
        rawSha256: artifact.rawSha256,
        computedRawSha256: computed.rawSha256,
        rawBytes: artifact.rawBytes,
        computedRawBytes: computed.rawBytes,
        expectedStorageKey: computed.rawStorageKey,
        mismatches,
      });
    }
  }

  const missingArchivedImportBatches = importBatches.filter((batch) => {
    return Boolean(batch.rawSha256 && (!batch.rawStorageKey || !artifactsByKey.has(batch.rawStorageKey)));
  });
  for (const batch of missingArchivedImportBatches) {
    warnings.push({
      type: "MISSING_ARCHIVED_IMPORT_BATCH",
      batchId: batch.id,
      filename: batch.filename,
      storageKey: batch.rawStorageKey,
      rawSha256: batch.rawSha256,
      rawBytes: batch.rawBytes,
      mismatches: ["rawStorageKey"],
    });
  }

  for (const batch of importBatches) {
    if (!batch.rawStorageKey) continue;
    const artifact = artifactsByKey.get(batch.rawStorageKey);
    if (!artifact) continue;
    const mismatches = [
      batch.rawSha256 && batch.rawSha256 !== artifact.rawSha256 ? "rawSha256" : "",
      batch.rawBytes != null && batch.rawBytes !== artifact.rawBytes ? "rawBytes" : "",
    ].filter(Boolean);

    if (mismatches.length > 0) {
      warnings.push({
        type: "BATCH_ARTIFACT_MISMATCH",
        batchId: batch.id,
        filename: batch.filename,
        storageKey: batch.rawStorageKey,
        rawSha256: batch.rawSha256,
        computedRawSha256: artifact.rawSha256,
        rawBytes: batch.rawBytes,
        computedRawBytes: artifact.rawBytes,
        expectedStorageKey: artifact.storageKey,
        mismatches,
      });
    }
  }

  const invalidContent = warnings.filter((warning) => warning.type === "ARTIFACT_CONTENT_MISMATCH").length;
  const batchMetadataMismatches = warnings.filter((warning) => warning.type === "BATCH_ARTIFACT_MISMATCH").length;
  const legacyImportBatchesWithoutRawArchive = importBatches.filter((batch) => !batch.rawSha256).length;

  return {
    total: importArtifacts.length,
    bytes: importArtifacts.reduce((sum, artifact) => sum + artifact.rawBytes, 0),
    missingArchivedImportBatches: missingArchivedImportBatches.length,
    legacyImportBatchesWithoutRawArchive,
    invalidContent,
    batchMetadataMismatches,
    complete: missingArchivedImportBatches.length === 0 && invalidContent === 0 && batchMetadataMismatches === 0,
    warnings,
  };
}

export function buildBackupReadinessManifest(input: {
  generatedAt?: string;
  journalScreenshotAssets: JournalScreenshotBackupAsset[];
  importArtifactManifest: ReturnType<typeof buildImportArtifactBackupManifest>;
  tableManifest?: ReturnType<typeof buildBackupTableManifest>;
  source?: {
    latestDataChangeAt: string | null;
    rowCounts: Record<string, number>;
    signature: string;
  };
}) {
  return {
    schema: "trade-journal-backup",
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    assets: {
      journalScreenshots: buildJournalScreenshotBackupManifest(input.journalScreenshotAssets),
      importArtifacts: input.importArtifactManifest,
    },
    tables: input.tableManifest,
    source: input.source,
  };
}
