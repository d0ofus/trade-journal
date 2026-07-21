import { describe, expect, it, vi } from "vitest";

import {
  finalizeAppliedImportBatches,
  ImportLifecycleRecoveryError,
  type ImportLifecycleDependencies,
} from "@/lib/server/import-lifecycle";

function dependencies(): ImportLifecycleDependencies {
  return {
    markMaterialized: vi.fn().mockResolvedValue(undefined),
    markMaterializationFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("finalizeAppliedImportBatches", () => {
  it("materializes before atomically finalizing the unique batch cohort", async () => {
    const events: string[] = [];
    const deps = dependencies();
    vi.mocked(deps.markMaterialized).mockImplementation(async (batchIds) => {
      events.push(`finalize:${batchIds.join(",")}`);
    });

    await finalizeAppliedImportBatches(
      {
        batchIds: ["batch-a", "batch-b", "batch-a"],
        materialize: async () => {
          events.push("materialize");
        },
      },
      deps,
    );

    expect(events).toEqual(["materialize", "finalize:batch-a,batch-b"]);
    expect(deps.markMaterializationFailed).not.toHaveBeenCalled();
  });

  it("marks the whole cohort failed when materialization fails and preserves the primary error", async () => {
    const failure = new Error("analytics unavailable");
    const deps = dependencies();

    await expect(
      finalizeAppliedImportBatches(
        {
          batchIds: ["batch-a", "batch-b"],
          materialize: async () => {
            throw failure;
          },
        },
        deps,
      ),
    ).rejects.toBe(failure);

    expect(deps.markMaterialized).not.toHaveBeenCalled();
    expect(deps.markMaterializationFailed).toHaveBeenCalledWith(
      ["batch-a", "batch-b"],
      "Materialization refresh failed: analytics unavailable",
    );
  });

  it("recovers final status-update failures instead of leaving rows applied", async () => {
    const failure = new Error("status write unavailable");
    const deps = dependencies();
    vi.mocked(deps.markMaterialized).mockRejectedValue(failure);

    await expect(
      finalizeAppliedImportBatches(
        { batchIds: ["batch-a", "batch-b"], materialize: async () => undefined },
        deps,
      ),
    ).rejects.toBe(failure);

    expect(deps.markMaterializationFailed).toHaveBeenCalledWith(
      ["batch-a", "batch-b"],
      "Final import status update failed: status write unavailable",
    );
  });

  it("reports both errors when lifecycle recovery itself fails", async () => {
    const primary = new Error("closed trades unavailable");
    const recovery = new Error("database recovery unavailable");
    const deps = dependencies();
    vi.mocked(deps.markMaterializationFailed).mockRejectedValue(recovery);

    const promise = finalizeAppliedImportBatches(
      {
        batchIds: ["batch-a"],
        materialize: async () => {
          throw primary;
        },
      },
      deps,
    );

    await expect(promise).rejects.toMatchObject({
      name: "ImportLifecycleRecoveryError",
      primaryError: primary,
      recoveryError: recovery,
    });
    await expect(promise).rejects.toBeInstanceOf(ImportLifecycleRecoveryError);
  });

  it("fails closed when row application produced no batch IDs", async () => {
    const deps = dependencies();
    const materialize = vi.fn();

    await expect(finalizeAppliedImportBatches({ batchIds: [], materialize }, deps)).rejects.toThrow(
      "requires at least one non-empty batch ID",
    );

    expect(materialize).not.toHaveBeenCalled();
    expect(deps.markMaterialized).not.toHaveBeenCalled();
    expect(deps.markMaterializationFailed).not.toHaveBeenCalled();
  });
});
