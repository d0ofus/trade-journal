import { afterEach, describe, expect, it, vi } from "vitest";
import { continuePublication, openPublication, type PublicationResult } from "./notion-publication-client";
import { templateCheckDelay, templateRetryAt, templateWaitExpired } from "./notion-publication-state";

function result(state = "preview", revision = 2, savedRevision = revision): PublicationResult {
  return { enabled: true, publication: { savedRevision, lastPublishedRevision: state === "succeeded" ? revision : 1, pageUrl: "https://notion.invalid/page", activeJobId: ["preview", "succeeded"].includes(state) ? null : "job" },
    job: { id: "job", groupKey: "trade", revision, state, error: null, retryAt: null, phase: state, missingSections: [], pageUrl: null, templateVersion: "v1", properties: [], omitted: [], errors: [], sections: [], assets: undefined } };
}
function responses(...results: PublicationResult[]) {
  const fetcher = vi.fn(); results.forEach(value => fetcher.mockResolvedValueOnce(Response.json(value))); vi.stubGlobal("fetch", fetcher); return fetcher;
}
const actions = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map(([, init]) => init.body ? JSON.parse(init.body) : "GET");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("publication continuation without implicit publishing", () => {
  it("prepares the latest saved revision on opening, without confirming it", async () => {
    const fetcher = responses(result("succeeded", 1, 3), result("preview", 3));
    await openPublication("trade", new AbortController().signal, vi.fn());
    expect(actions(fetcher)).toEqual(["GET", { action: "preview", groupKey: "trade", revision: 3 }]);
  });
  it.each(["waiting", "running", "failed", "conflict"])("does not auto-resume or supersede a %s job", async state => {
    const fetcher = responses(result(state, 1, 4));
    const loaded = await openPublication("trade", new AbortController().signal, vi.fn());
    expect(loaded.job?.revision).toBe(1); expect(actions(fetcher)).toEqual(["GET"]);
  });
  it("does not republish an unchanged successful review", async () => {
    const fetcher = responses(result("succeeded"), result("succeeded"));
    const loaded = await openPublication("trade", new AbortController().signal, vi.fn());
    expect(loaded.job?.state).toBe("succeeded"); expect(actions(fetcher)).toHaveLength(2);
  });
  it("waits for readiness/cooldown before continuing and prepares newer edits after success", async () => {
    vi.useFakeTimers();
    const waiting = result("waiting", 1, 3); waiting.job!.retryAt = new Date(Date.now() + 4000); waiting.job!.phase = "template_wait";
    const fetcher = responses(waiting, result("succeeded", 1, 3), result("preview", 3));
    const pending = continuePublication("trade", "resume", result("waiting", 1, 3), new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(3999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); const last = await pending;
    expect(last.job?.revision).toBe(3); expect(last.job?.state).toBe("preview");
    expect(actions(fetcher)).toEqual([{ action: "resume", groupKey: "trade", id: "job" }, { action: "resume", groupKey: "trade", id: "job" }, { action: "preview", groupKey: "trade", revision: 3 }]);
  });
  it.each(["conflict", "failed"])("stops continuation on %s instead of retrying writes", async state => {
    const fetcher = responses(result(state));
    await continuePublication("trade", "publish", result(), new AbortController().signal, vi.fn());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels a pending wait on close/navigation", async () => {
    vi.useFakeTimers(); const controller = new AbortController(), waiting = result("waiting"); waiting.job!.retryAt = new Date(Date.now() + 10000);
    const fetcher = responses(waiting), observed = vi.fn();
    const pending = continuePublication("trade", "resume", waiting, controller.signal, observed);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected; await vi.advanceTimersByTimeAsync(20000);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(observed).toHaveBeenCalledTimes(1);
  });
  it("ignores an old request completing after navigation", async () => {
    const controller = new AbortController(), observed = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return Response.json(result()); }));
    await expect(openPublication("trade", controller.signal, observed)).rejects.toMatchObject({ name: "AbortError" });
    expect(observed).not.toHaveBeenCalled();
  });
  it("bounds template backoff and expires after two minutes", () => {
    expect([0, 1, 2, 3, 4, 100].map(templateCheckDelay)).toEqual([2000, 4000, 8000, 10000, 10000, 10000]);
    const wait = { startedAt: 1000, attempt: 5 };
    expect(templateWaitExpired(wait, 120999)).toBe(false); expect(templateWaitExpired(wait, 121000)).toBe(true);
    expect(templateRetryAt(wait, 120000).getTime()).toBe(121000);
  });
});
