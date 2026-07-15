-- CreateTable
CREATE TABLE "BackupAudit" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadBytes" INTEGER NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "tableCount" INTEGER NOT NULL,
    "strippedFieldCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sourceSignature" TEXT,
    "sourceCountsJson" TEXT NOT NULL DEFAULT '{}',
    "sourceLatestDataChangeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupAudit_verifiedAt_idx" ON "BackupAudit"("verifiedAt");

-- CreateIndex
CREATE INDEX "BackupAudit_exportedAt_idx" ON "BackupAudit"("exportedAt");

-- CreateIndex
CREATE INDEX "BackupAudit_sha256_idx" ON "BackupAudit"("sha256");

-- CreateIndex
CREATE INDEX "BackupAudit_sourceSignature_idx" ON "BackupAudit"("sourceSignature");
