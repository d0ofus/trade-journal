import {
  markImportBatchesMaterializationFailed,
  markImportBatchesMaterialized,
} from "@/lib/server/import-service";

export type ImportLifecycleDependencies = {
  markMaterialized: (batchIds: string[]) => Promise<void>;
  markMaterializationFailed: (batchIds: string[], message: string) => Promise<void>;
};

type FinalizeAppliedImportBatchesInput = {
  batchIds: string[];
  materialize: () => Promise<void>;
};

const DEFAULT_DEPENDENCIES: ImportLifecycleDependencies = {
  markMaterialized: markImportBatchesMaterialized,
  markMaterializationFailed: markImportBatchesMaterializationFailed,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class ImportLifecycleRecoveryError extends Error {
  readonly primaryError: unknown;
  readonly recoveryError: unknown;

  constructor(primaryError: unknown, recoveryError: unknown) {
    super(
      `Post-import processing failed (${errorMessage(primaryError)}), and lifecycle recovery also failed (${errorMessage(recoveryError)}).`,
      { cause: primaryError },
    );
    this.name = "ImportLifecycleRecoveryError";
    this.primaryError = primaryError;
    this.recoveryError = recoveryError;
  }
}

export async function finalizeAppliedImportBatches(
  input: FinalizeAppliedImportBatchesInput,
  dependencies: ImportLifecycleDependencies = DEFAULT_DEPENDENCIES,
) {
  if (input.batchIds.length === 0 || input.batchIds.some((batchId) => !batchId)) {
    throw new Error("Post-import processing requires at least one non-empty batch ID.");
  }
  const batchIds = [...new Set(input.batchIds)].filter(Boolean);

  let stage: "materialization" | "finalization" = "materialization";
  try {
    await input.materialize();
    stage = "finalization";
    await dependencies.markMaterialized(batchIds);
  } catch (primaryError) {
    const failureMessage =
      stage === "materialization"
        ? `Materialization refresh failed: ${errorMessage(primaryError)}`
        : `Final import status update failed: ${errorMessage(primaryError)}`;
    try {
      await dependencies.markMaterializationFailed(batchIds, failureMessage);
    } catch (recoveryError) {
      throw new ImportLifecycleRecoveryError(primaryError, recoveryError);
    }
    throw primaryError;
  }
}
