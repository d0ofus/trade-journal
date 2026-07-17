import { describe, expect, it } from "vitest";
import { packExecutionLabelCenters } from "@/lib/charts/execution-label-layout";

describe("packExecutionLabelCenters", () => {
  it("keeps six dense compact-panel labels fully inside the plot", () => {
    const centers = packExecutionLabelCenters([4, 32, 70, 118, 180, 266], 26, 254, 48);

    expect(centers).toHaveLength(6);
    expect(Math.min(...centers)).toBeGreaterThanOrEqual(26);
    expect(Math.max(...centers)).toBeLessThanOrEqual(254);
    for (let index = 1; index < centers.length; index += 1) {
      expect(centers[index] - centers[index - 1]).toBeGreaterThanOrEqual(45.5);
    }
  });

  it("clamps a single label without shifting an in-range label", () => {
    expect(packExecutionLabelCenters([120], 26, 254, 48)).toEqual([120]);
    expect(packExecutionLabelCenters([300], 26, 254, 48)).toEqual([254]);
  });
});
