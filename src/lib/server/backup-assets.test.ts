import { rawImportArchiveIdentity } from "@/lib/import/raw-archive";
import {
  buildBackupReadinessManifest,
  buildImportArtifactBackupManifest,
  buildJournalScreenshotBackupAssets,
  buildJournalScreenshotBackupManifest,
} from "@/lib/server/backup-assets";

function importArtifact(content: string) {
  const identity = rawImportArchiveIdentity(content);
  return {
    storageKey: identity.rawStorageKey,
    rawSha256: identity.rawSha256,
    rawBytes: identity.rawBytes,
    content,
  };
}

describe("buildJournalScreenshotBackupAssets", () => {
  it("embeds inline screenshot data URLs", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from("inline").toString("base64")}`;
    const assets = await buildJournalScreenshotBackupAssets([
      {
        id: "chart-1",
        journalEntryId: "entry-1",
        screenshotKey: "inline:journal/entry-1/chart-1.png",
        screenshotUrl: dataUrl,
        mimeType: "image/png",
      },
    ]);

    expect(assets).toEqual([
      expect.objectContaining({
        chartId: "chart-1",
        embedded: true,
        bytes: 6,
        dataUrl,
      }),
    ]);
  });

  it("embeds local screenshot files as data URLs", async () => {
    const assets = await buildJournalScreenshotBackupAssets(
      [
        {
          id: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "local:entry-1/chart-1.png",
          screenshotUrl: "/journal-screenshots/entry-1/chart-1.png",
          mimeType: "image/png",
        },
      ],
      {
        baseDir: "/screenshots",
        readLocalFile: async (absolutePath) => {
          expect(absolutePath.replace(/\\/g, "/")).toMatch(/\/screenshots\/entry-1\/chart-1\.png$/);
          return Buffer.from("local");
        },
      },
    );

    expect(assets[0]).toMatchObject({
      chartId: "chart-1",
      embedded: true,
      bytes: 5,
      sha256: expect.any(String),
      dataUrl: `data:image/png;base64,${Buffer.from("local").toString("base64")}`,
    });
  });

  it("can verify screenshot assets without embedding data URLs", async () => {
    const dataUrl = `data:image/png;base64,${Buffer.from("inline").toString("base64")}`;
    const assets = await buildJournalScreenshotBackupAssets(
      [
        {
          id: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "inline:journal/entry-1/chart-1.png",
          screenshotUrl: dataUrl,
          mimeType: "image/png",
        },
      ],
      { includeDataUrl: false },
    );

    expect(assets[0]).toMatchObject({
      chartId: "chart-1",
      embedded: true,
      bytes: 6,
      sha256: expect.any(String),
    });
    expect(assets[0].dataUrl).toBeUndefined();
  });

  it("does not count malformed inline screenshot data URLs as embedded", async () => {
    const assets = await buildJournalScreenshotBackupAssets([
      {
        id: "chart-1",
        journalEntryId: "entry-1",
        screenshotKey: "inline:journal/entry-1/chart-1.png",
        screenshotUrl: "data:image/png;base64,not valid base64!",
        mimeType: "image/png",
      },
    ]);

    expect(assets[0]).toMatchObject({
      chartId: "chart-1",
      embedded: false,
      bytes: null,
      reason: expect.stringContaining("could not be parsed"),
    });
    expect(buildJournalScreenshotBackupManifest(assets)).toMatchObject({
      complete: false,
      embedded: 0,
      missing: 1,
      warnings: [expect.objectContaining({ chartId: "chart-1" })],
    });
  });

  it("does not embed unsafe or external screenshot references silently", async () => {
    const assets = await buildJournalScreenshotBackupAssets(
      [
        {
          id: "unsafe-chart",
          journalEntryId: "entry-1",
          screenshotKey: "local:../secret.png",
          screenshotUrl: null,
          mimeType: "image/png",
        },
        {
          id: "remote-chart",
          journalEntryId: "entry-2",
          screenshotKey: "journal/entry-2/remote.png",
          screenshotUrl: "https://cdn.example.test/journal/entry-2/remote.png",
          mimeType: "image/png",
        },
      ],
      { baseDir: "/screenshots" },
    );

    expect(assets).toEqual([
      expect.objectContaining({ chartId: "unsafe-chart", embedded: false, reason: expect.stringContaining("outside") }),
      expect.objectContaining({ chartId: "remote-chart", embedded: false, reason: expect.stringContaining("External") }),
    ]);
  });
});

describe("buildBackupReadinessManifest", () => {
  it("returns the route-compatible complete manifest shape", () => {
    const artifact = importArtifact("account,symbol\nDU1,AAPL\n");
    const importArtifactManifest = buildImportArtifactBackupManifest(
      [
        {
          id: "batch-1",
          filename: "trades.csv",
          rawSha256: artifact.rawSha256,
          rawBytes: artifact.rawBytes,
          rawStorageKey: artifact.storageKey,
        },
      ],
      [artifact],
    );

    const manifest = buildBackupReadinessManifest({
      generatedAt: "2026-06-26T00:00:00.000Z",
      journalScreenshotAssets: [
        {
          chartId: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "inline:chart-1.png",
          screenshotUrl: "data:image/png;base64,aW1hZ2U=",
          embedded: true,
          mimeType: "image/png",
          bytes: 5,
          sha256: "sha",
        },
      ],
      importArtifactManifest,
    });

    expect(manifest).toMatchObject({
      schema: "trade-journal-backup",
      version: 1,
      generatedAt: "2026-06-26T00:00:00.000Z",
      assets: {
        journalScreenshots: {
          total: 1,
          embedded: 1,
          missing: 0,
          complete: true,
          warnings: [],
        },
        importArtifacts: {
          total: 1,
          complete: true,
          warnings: [],
        },
      },
    });
  });

  it("surfaces screenshot and import artifact warnings together", () => {
    const importArtifactManifest = buildImportArtifactBackupManifest(
      [
        {
          id: "batch-1",
          filename: "trades.csv",
          rawSha256: "sha",
          rawBytes: 10,
          rawStorageKey: "import-artifacts/sha256/sha.txt",
        },
      ],
      [],
    );

    const manifest = buildBackupReadinessManifest({
      journalScreenshotAssets: [
        {
          chartId: "chart-1",
          journalEntryId: "entry-1",
          screenshotKey: "journal/remote.png",
          screenshotUrl: "https://cdn.example.test/remote.png",
          embedded: false,
          mimeType: "image/png",
          bytes: null,
          reason: "External screenshot storage is referenced but not embedded.",
        },
      ],
      importArtifactManifest,
    });

    expect(manifest.assets.journalScreenshots).toMatchObject({
      complete: false,
      missing: 1,
      warnings: [expect.objectContaining({ chartId: "chart-1", reason: expect.stringContaining("External") })],
    });
    expect(manifest.assets.importArtifacts).toMatchObject({
      complete: false,
      missingArchivedImportBatches: 1,
      warnings: [expect.objectContaining({ type: "MISSING_ARCHIVED_IMPORT_BATCH", batchId: "batch-1" })],
    });
  });
});

describe("buildImportArtifactBackupManifest", () => {
  it("marks valid content-addressed import artifacts complete", () => {
    const artifact = importArtifact("account,symbol\nDU1,AAPL\n");
    const manifest = buildImportArtifactBackupManifest(
      [
        {
          id: "batch-1",
          filename: "trades.csv",
          rawSha256: artifact.rawSha256,
          rawBytes: artifact.rawBytes,
          rawStorageKey: artifact.storageKey,
        },
      ],
      [artifact],
    );

    expect(manifest).toMatchObject({
      total: 1,
      bytes: artifact.rawBytes,
      missingArchivedImportBatches: 0,
      invalidContent: 0,
      batchMetadataMismatches: 0,
      complete: true,
      warnings: [],
    });
  });

  it("reports tampered artifact content as incomplete", () => {
    const artifact = importArtifact("account,symbol\nDU1,AAPL\n");
    const manifest = buildImportArtifactBackupManifest([], [{ ...artifact, content: "account,symbol\nDU1,MSFT\n" }]);

    expect(manifest.complete).toBe(false);
    expect(manifest.invalidContent).toBe(1);
    expect(manifest.warnings[0]).toMatchObject({
      type: "ARTIFACT_CONTENT_MISMATCH",
      storageKey: artifact.storageKey,
      rawSha256: artifact.rawSha256,
      mismatches: expect.arrayContaining(["storageKey", "rawSha256"]),
    });
  });

  it("reports batches that reference missing archived artifacts", () => {
    const identity = rawImportArchiveIdentity("account,symbol\nDU1,AAPL\n");
    const manifest = buildImportArtifactBackupManifest(
      [
        {
          id: "batch-1",
          filename: "trades.csv",
          rawSha256: identity.rawSha256,
          rawBytes: identity.rawBytes,
          rawStorageKey: identity.rawStorageKey,
        },
      ],
      [],
    );

    expect(manifest.complete).toBe(false);
    expect(manifest.missingArchivedImportBatches).toBe(1);
    expect(manifest.warnings[0]).toMatchObject({
      type: "MISSING_ARCHIVED_IMPORT_BATCH",
      batchId: "batch-1",
      filename: "trades.csv",
    });
  });

  it("reports batch metadata that no longer matches the referenced artifact", () => {
    const artifact = importArtifact("account,symbol\nDU1,AAPL\n");
    const manifest = buildImportArtifactBackupManifest(
      [
        {
          id: "batch-1",
          filename: "trades.csv",
          rawSha256: "wrong",
          rawBytes: artifact.rawBytes + 1,
          rawStorageKey: artifact.storageKey,
        },
      ],
      [artifact],
    );

    expect(manifest.complete).toBe(false);
    expect(manifest.batchMetadataMismatches).toBe(1);
    expect(manifest.warnings[0]).toMatchObject({
      type: "BATCH_ARTIFACT_MISMATCH",
      batchId: "batch-1",
      mismatches: expect.arrayContaining(["rawSha256", "rawBytes"]),
    });
  });
});
