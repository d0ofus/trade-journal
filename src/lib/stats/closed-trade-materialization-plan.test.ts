import { describe, expect, it } from "vitest";
import { planClosedTradeRefresh } from "@/lib/stats/closed-trade-materialization-plan";

describe("planClosedTradeRefresh", () => {
  it("marks missing groups stale instead of scheduling parent deletion", () => {
    const plan = planClosedTradeRefresh(["kept-trade", "annotated-old-trade"], ["kept-trade", "new-trade"]);

    expect(plan.activeGroupKeys).toEqual(["kept-trade", "new-trade"]);
    expect(plan.executionGroupKeysToReplace).toEqual(["kept-trade", "new-trade"]);
    expect(plan.staleGroupKeys).toEqual(["annotated-old-trade"]);
  });
});
