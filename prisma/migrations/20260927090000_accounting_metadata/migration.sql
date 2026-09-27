-- Additive only: execution identity, quantities, prices and timestamps are immutable.
ALTER TABLE "Execution"
  ADD COLUMN "transactionTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "contractMultiplier" DOUBLE PRECISION,
  ADD COLUMN "multiplierSource" TEXT,
  ADD COLUMN "effectiveAssetType" TEXT,
  ADD COLUMN "brokerContractId" TEXT;
ALTER TABLE "Instrument" ADD COLUMN "brokerContractId" TEXT;
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_contractMultiplier_positive"
  CHECK ("contractMultiplier" IS NULL OR "contractMultiplier" > 0);
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_transactionTax_nonnegative"
  CHECK ("transactionTax" >= 0);
