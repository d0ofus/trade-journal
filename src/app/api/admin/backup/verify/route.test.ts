import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBackupReadinessManifest, buildImportArtifactBackupManifest } from "@/lib/server/backup-assets";
import { buildBackupSourceMetadata } from "@/lib/server/backup-freshness";
import { BACKUP_TABLES, buildBackupTableManifest, type BackupTableKey } from "@/lib/server/backup-contract";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  backupAuditCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backupAudit: {
      create: mocks.backupAuditCreate,
    },
  },
}));

function emptyTablePayload() {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table.key, []])) as Record<BackupTableKey, unknown[]>;
}

function buildPayload() {
  const tablePayload = emptyTablePayload();
  const tableManifest = buildBackupTableManifest(tablePayload);
  const importArtifactManifest = buildImportArtifactBackupManifest([], []);
  const source = buildBackupSourceMetadata({
    latestDataChangeAt: "2026-06-25T23:59:00.000Z",
    rowCounts: tableManifest.rowCounts,
  });

  return {
    exportedAt: "2026-06-26T00:00:00.000Z",
    version: 1,
    manifest: buildBackupReadinessManifest({
      journalScreenshotAssets: [],
      importArtifactManifest,
      tableManifest,
      source,
    }),
    ...tablePayload,
    assets: { journalScreenshots: [] },
  };
}

function verifyRequest(body: string) {
  return new NextRequest("http://localhost/api/admin/backup/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function expectSourceMetadataRejection(payload: ReturnType<typeof buildPayload>, expectedCode: string) {
  const rawBody = JSON.stringify(payload);
  const { POST } = await import("./route");

  const response = await POST(verifyRequest(rawBody));
  const body = await response.json();

  expect(response.status).toBe(422);
  expect(body).toMatchObject({
    ok: false,
    sha256: crypto.createHash("sha256").update(rawBody).digest("hex"),
    error: "Backup source metadata is invalid.",
    errors: expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
  });
  expect(mocks.backupAuditCreate).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
}

describe("admin backup verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(null);
    mocks.backupAuditCreate.mockImplementation(async ({ data }) => ({
      id: "backup-audit-1",
      ...data,
      verifiedAt: new Date("2026-06-26T00:01:00.000Z"),
    }));
  });

  it("rejects unauthenticated backup verification before reading the body", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { POST } = await import("./route");

    const response = await POST(verifyRequest(JSON.stringify(buildPayload())));

    expect(response.status).toBe(401);
    expect(mocks.backupAuditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const { POST } = await import("./route");

    const response = await POST(verifyRequest("{not-json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: "Invalid JSON backup payload." });
    expect(mocks.backupAuditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns restore-plan summary, content hash, and records an audit row for a valid backup payload", async () => {
    const rawBody = JSON.stringify(buildPayload(), null, 2);
    const sha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    const { POST } = await import("./route");

    const response = await POST(verifyRequest(rawBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      sha256,
      tableCount: BACKUP_TABLES.length,
      totalRows: 0,
      strippedFieldCount: 0,
      dateFieldCount: 0,
      audit: {
        id: "backup-audit-1",
        sha256,
        exportedAt: "2026-06-26T00:00:00.000Z",
        verifiedAt: "2026-06-26T00:01:00.000Z",
        payloadBytes: Buffer.byteLength(rawBody, "utf8"),
        totalRows: 0,
        tableCount: BACKUP_TABLES.length,
        strippedFieldCount: 0,
        warningCount: 0,
        errorCount: 0,
        sourceSignature: body.audit.sourceSignature,
        sourceLatestDataChangeAt: "2026-06-25T23:59:00.000Z",
      },
    });
    expect(body.tables).toHaveLength(BACKUP_TABLES.length);
    expect(body.tables[0]).toMatchObject({ key: "accounts", prismaModel: "Account", delegateName: "account", rowCount: 0 });
    expect(mocks.backupAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sha256,
        exportedAt: new Date("2026-06-26T00:00:00.000Z"),
        payloadBytes: Buffer.byteLength(rawBody, "utf8"),
        totalRows: 0,
        tableCount: BACKUP_TABLES.length,
        strippedFieldCount: 0,
        warningCount: 0,
        errorCount: 0,
        sourceSignature: body.audit.sourceSignature,
        sourceLatestDataChangeAt: new Date("2026-06-25T23:59:00.000Z"),
      }),
    });
    expect(body.audit.sourceSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects backups without source metadata before recording an audit row", async () => {
    const payload = buildPayload();
    delete (payload.manifest as Record<string, unknown>).source;

    await expectSourceMetadataRejection(payload, "INVALID_BACKUP_SOURCE_METADATA");
  });

  it("rejects backups with tampered source metadata before recording an audit row", async () => {
    const payload = buildPayload();
    (payload.manifest.source as Record<string, unknown>).signature = "bad";

    await expectSourceMetadataRejection(payload, "INVALID_BACKUP_SOURCE_METADATA");
  });

  it("rejects backups whose source row counts differ from the table manifest", async () => {
    const payload = buildPayload();
    const tableManifest = payload.manifest.tables;
    payload.manifest.source = buildBackupSourceMetadata({
      latestDataChangeAt: "2026-06-25T23:59:00.000Z",
      rowCounts: {
        ...tableManifest.rowCounts,
        accounts: tableManifest.rowCounts.accounts + 1,
      },
    });

    await expectSourceMetadataRejection(payload, "BACKUP_SOURCE_ROW_COUNT_MISMATCH");
  });

  it("rejects backups whose source latest change is after the export timestamp", async () => {
    const payload = buildPayload();
    payload.manifest.source = buildBackupSourceMetadata({
      latestDataChangeAt: "2026-06-26T00:01:00.000Z",
      rowCounts: payload.manifest.tables.rowCounts,
    });

    await expectSourceMetadataRejection(payload, "BACKUP_SOURCE_AFTER_EXPORT");
  });

  it("does not record an audit row when exportedAt is missing", async () => {
    const payload = buildPayload();
    delete (payload as Record<string, unknown>).exportedAt;
    const rawBody = JSON.stringify(payload);
    const { POST } = await import("./route");

    const response = await POST(verifyRequest(rawBody));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ ok: false, error: "Backup exportedAt is missing or invalid." });
    expect(mocks.backupAuditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 422 with validator issues for unsafe backup payloads", async () => {
    const payload = buildPayload();
    delete (payload as Record<string, unknown>).accounts;
    const rawBody = JSON.stringify(payload);
    const { POST } = await import("./route");

    const response = await POST(verifyRequest(rawBody));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.sha256).toBe(crypto.createHash("sha256").update(rawBody).digest("hex"));
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_BACKUP_TABLE", path: "accounts" })]));
    expect(mocks.backupAuditCreate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
