CREATE TABLE "NotionTemplateDefinition" (
  "id" TEXT NOT NULL PRIMARY KEY, "templateId" TEXT NOT NULL, "dataSourceId" TEXT NOT NULL,
  "layout" JSONB NOT NULL, "source" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NotionTemplateDefinition_templateId_checkedAt_idx" ON "NotionTemplateDefinition"("templateId", "checkedAt");
CREATE TABLE "NotionPublication" (
  "groupKey" TEXT NOT NULL PRIMARY KEY, "dataSourceId" TEXT NOT NULL, "pageId" TEXT,
  "activeJobId" TEXT, "lastRevision" INTEGER, "templateId" TEXT, "bindings" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "NotionPublication_pageId_key" ON "NotionPublication"("pageId");
CREATE TABLE "NotionPublishJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "groupKey" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "templateId" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "plan" JSONB NOT NULL,
  "progress" JSONB NOT NULL DEFAULT '{}', "state" TEXT NOT NULL DEFAULT 'preview', "error" TEXT,
  "retryAt" TIMESTAMP(3), "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotionPublishJob_groupKey_fkey" FOREIGN KEY ("groupKey") REFERENCES "NotionPublication"("groupKey") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotionPublishJob_requestKey_key" ON "NotionPublishJob"("requestKey");
CREATE INDEX "NotionPublishJob_groupKey_createdAt_idx" ON "NotionPublishJob"("groupKey", "createdAt");
CREATE TABLE "NotionUpload" (
  "id" TEXT NOT NULL PRIMARY KEY, "dataSourceId" TEXT NOT NULL, "contentHash" TEXT NOT NULL,
  "uploadId" TEXT, "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "NotionUpload_dataSourceId_contentHash_key" ON "NotionUpload"("dataSourceId", "contentHash");
CREATE TABLE "NotionRequestGate" (
  "key" TEXT NOT NULL PRIMARY KEY, "nextAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
