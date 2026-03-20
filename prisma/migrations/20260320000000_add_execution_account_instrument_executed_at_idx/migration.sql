CREATE INDEX "Execution_accountId_instrumentId_executedAt_idx"
ON "Execution"("accountId", "instrumentId", "executedAt");
