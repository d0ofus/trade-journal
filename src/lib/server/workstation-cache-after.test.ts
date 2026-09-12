import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ callback: null as null | (() => Promise<void>), registrationError: false, fail: true }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => { if (state.registrationError) throw new Error("No request scope"); state.callback = fn; } }));
vi.mock("./workstation-cache-jobs", () => ({ recoverCandlePreparation: async () => { if (state.fail) throw new Error("Cache unavailable"); } }));
import { prepareCandlesAfterResponse } from "./workstation-cache-after";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); state.callback = null; state.registrationError = false; });
it("does not start work before the response callback and contains registration and queue failures", async () => {
  vi.stubEnv("TRADES_CANDLE_CACHE_ENABLED", "1"); vi.stubEnv("TRADES_CANDLE_PREPARE_ENABLED", "1"); vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() => prepareCandlesAfterResponse()).not.toThrow(); expect(state.callback).not.toBeNull(); await expect(state.callback!()).resolves.toBeUndefined();
  state.registrationError = true; expect(() => prepareCandlesAfterResponse()).not.toThrow();
});
it("does not register any post-import work when background preparation is disabled", () => {
  vi.stubEnv("TRADES_CANDLE_PREPARE_ENABLED", "0"); prepareCandlesAfterResponse(); expect(state.callback).toBeNull();
});
