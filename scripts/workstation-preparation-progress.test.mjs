import assert from "node:assert/strict";
import test from "node:test";
import { preparationContinuation } from "./workstation-preparation-progress.mjs";

test("continues partial fills immediately instead of stopping on zero completed jobs", () => {
  assert.deepEqual(preparationContinuation({ result: { processed: 0, advanced: 1 } }), { stop: false, waitMs: 0 });
});
test("backs off for an active worker and scheduled provider retries", () => {
  assert.deepEqual(preparationContinuation({ result: { paused: "Workers active", retryAfterMs: 5000 } }), { stop: false, waitMs: 5000 });
  assert.deepEqual(preparationContinuation({ result: { nextAvailableAt: new Date(120000).toISOString() } }, 0), { stop: false, waitMs: 60000 });
});
test("stops at a storage or disabled-preparation pause", () => {
  assert.deepEqual(preparationContinuation({ result: { paused: "Storage budget reached" } }), { stop: true, waitMs: 0 });
});
