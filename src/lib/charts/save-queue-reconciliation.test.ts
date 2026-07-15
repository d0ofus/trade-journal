import { describe, expect, it } from "vitest";
import { nextPendingSaveAfterSuccess, reconcileDesiredSave } from "./save-queue-reconciliation";

describe("reconcileDesiredSave", () => {
  it("queues a reversion to the saved state while a newer state is in flight", () => {
    expect(reconcileDesiredSave({
      desiredSignature: "S0",
      inFlight: true,
      queuedSignature: "S1",
      savedSignature: "S0",
    })).toBe("queue");
  });

  it("cancels a queued change that reverts before its request starts", () => {
    expect(reconcileDesiredSave({
      desiredSignature: "S0",
      inFlight: false,
      queuedSignature: "S1",
      savedSignature: "S0",
    })).toBe("cancel");
  });

  it("ignores an already represented desired state", () => {
    expect(reconcileDesiredSave({
      desiredSignature: "S2",
      inFlight: true,
      queuedSignature: "S2",
      savedSignature: "S0",
    })).toBe("ignore");
  });

  it("queues a latest desired state that differs from saved and queued state", () => {
    expect(reconcileDesiredSave({
      desiredSignature: "S2",
      inFlight: true,
      queuedSignature: "S1",
      savedSignature: "S0",
    })).toBe("queue");
  });
});

describe("nextPendingSaveAfterSuccess", () => {
  it("retains a trailing state that differs from the completed request", () => {
    const pending = { signature: "S0", value: "latest" };
    expect(nextPendingSaveAfterSuccess("S1", pending)).toBe(pending);
  });

  it("drops a trailing state already persisted by the completed request", () => {
    expect(nextPendingSaveAfterSuccess("S1", { signature: "S1", value: "duplicate" })).toBeNull();
  });
});
