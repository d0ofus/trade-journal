CREATE TABLE "EvidenceAsset" (
 "id" TEXT PRIMARY KEY, "tradeId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "sha256" TEXT NOT NULL, "notionHash" TEXT NOT NULL, "objectKey" TEXT NOT NULL,
 "thumbnailKey" TEXT NOT NULL, "bytes" INTEGER NOT NULL, "thumbnailBytes" INTEGER NOT NULL,
 "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "state" TEXT NOT NULL DEFAULT 'ready',
 "unreferencedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EvidenceAsset_limits" CHECK ("bytes" > 0 AND "bytes" <= 20000000 AND "width" > 0 AND "height" > 0 AND "width"::bigint * "height" <= 16000000)
);
CREATE UNIQUE INDEX "EvidenceAsset_tradeId_sha256_key" ON "EvidenceAsset"("tradeId", "sha256");
CREATE UNIQUE INDEX "EvidenceAsset_objectKey_key" ON "EvidenceAsset"("objectKey");
CREATE UNIQUE INDEX "EvidenceAsset_thumbnailKey_key" ON "EvidenceAsset"("thumbnailKey");
CREATE INDEX "EvidenceAsset_state_unreferencedAt_idx" ON "EvidenceAsset"("state", "unreferencedAt");
CREATE TABLE "EvidenceUploadSession" (
 "id" TEXT PRIMARY KEY, "tradeId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "clientKey" TEXT NOT NULL,
 "temporaryKey" TEXT NOT NULL, "expectedBytes" INTEGER NOT NULL, "verifiedSha256" TEXT, "state" TEXT NOT NULL DEFAULT 'pending', "assetId" TEXT,
 "leaseUntil" TIMESTAMP(3), "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EvidenceUploadSession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EvidenceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EvidenceUploadSession_temporaryKey_key" ON "EvidenceUploadSession"("temporaryKey");
CREATE UNIQUE INDEX "EvidenceUploadSession_ownerId_tradeId_clientKey_key" ON "EvidenceUploadSession"("ownerId", "tradeId", "clientKey");
CREATE INDEX "EvidenceUploadSession_state_expiresAt_idx" ON "EvidenceUploadSession"("state", "expiresAt");
CREATE TABLE "EvidenceAssetReference" (
 "assetId" TEXT NOT NULL, "kind" TEXT NOT NULL, "key" TEXT NOT NULL, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EvidenceAssetReference_pkey" PRIMARY KEY ("assetId", "kind", "key"),
 CONSTRAINT "EvidenceAssetReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EvidenceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EvidenceAssetReference_kind_key_idx" ON "EvidenceAssetReference"("kind", "key");
CREATE INDEX "EvidenceAssetReference_expiresAt_idx" ON "EvidenceAssetReference"("expiresAt");
CREATE TABLE "EvidenceMaintenanceState" ("key" TEXT PRIMARY KEY, "payload" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "EvidenceBackupSession" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "manifest" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "EvidenceBackupSession_expiresAt_idx" ON "EvidenceBackupSession"("expiresAt");
