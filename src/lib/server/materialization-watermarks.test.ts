import { describe, expect, it, vi } from "vitest";

import { buildMaterializationSourceSignature, getExecutionAnalyticsSourceSnapshot } from "@/lib/server/materialization-watermarks";

describe("buildMaterializationSourceSignature", () => {
  it("changes when position snapshots change even if executions do not", () => {
    const base = buildMaterializationSourceSignature({
      executionCount: 10,
      executionMaxUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
      positionSnapshotCount: 3,
      positionSnapshotMaxUpdatedAt: new Date("2026-06-25T02:00:00.000Z"),
    });

    const changedSnapshots = buildMaterializationSourceSignature({
      executionCount: 10,
      executionMaxUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
      positionSnapshotCount: 3,
      positionSnapshotMaxUpdatedAt: new Date("2026-06-25T03:00:00.000Z"),
    });

    expect(changedSnapshots).not.toEqual(base);
  });

  it("normalizes missing position snapshot inputs for execution-only materializations", () => {
    expect(
      buildMaterializationSourceSignature({
        executionCount: 4,
        executionMaxUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
      }),
    ).toEqual(
      JSON.stringify({
        executionCount: 4,
        executionMaxUpdatedAt: "2026-06-25T01:00:00.000Z",
        positionSnapshotCount: 0,
        positionSnapshotMaxUpdatedAt: null,
      }),
    );
  });

  it("includes position snapshots in execution analytics source freshness", async () => {
    const db = {
      execution: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 4 },
          _max: { updatedAt: new Date("2026-06-25T01:00:00.000Z") },
        }),
      },
      positionSnapshot: {
        aggregate: vi.fn().mockResolvedValue({
          _count: { _all: 2 },
          _max: { updatedAt: new Date("2026-06-25T02:00:00.000Z") },
        }),
      },
    } as unknown as Parameters<typeof getExecutionAnalyticsSourceSnapshot>[0];

    await expect(getExecutionAnalyticsSourceSnapshot(db)).resolves.toEqual({
      executionCount: 4,
      executionMaxUpdatedAt: new Date("2026-06-25T01:00:00.000Z"),
      positionSnapshotCount: 2,
      positionSnapshotMaxUpdatedAt: new Date("2026-06-25T02:00:00.000Z"),
    });
  });
});
