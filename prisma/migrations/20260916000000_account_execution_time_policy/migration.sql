-- CreateTable
CREATE TABLE "AccountExecutionTimePolicy" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IBKR_EXECUTIONS',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "basis" TEXT NOT NULL DEFAULT 'user-confirmed',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "normalizerVersion" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountExecutionTimePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionTimePolicyApplication" (
    "key" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "policyRevision" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "parserVersion" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "rowsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionTimePolicyApplication_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountExecutionTimePolicy_accountId_source_key" ON "AccountExecutionTimePolicy"("accountId", "source");

-- CreateIndex
CREATE INDEX "ExecutionTimePolicyApplication_policyId_policyRevision_impo_idx" ON "ExecutionTimePolicyApplication"("policyId", "policyRevision", "importBatchId");

-- AddForeignKey
ALTER TABLE "AccountExecutionTimePolicy" ADD CONSTRAINT "AccountExecutionTimePolicy_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTimePolicyApplication" ADD CONSTRAINT "ExecutionTimePolicyApplication_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AccountExecutionTimePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTimePolicyApplication" ADD CONSTRAINT "ExecutionTimePolicyApplication_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

