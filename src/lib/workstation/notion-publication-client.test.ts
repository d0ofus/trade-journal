import { afterEach, describe, expect, it, vi } from "vitest";
import { continuePublication, openPublication, type PublicationResult } from "./notion-publication-client";
import { NOTION_PRESENTATION_VERSION, publicationContentChanged, templateCheckDelay, templateRetryAt, templateWaitExpired } from "./notion-publication-state";

function result(state = "preview", revision = 2, savedRevision = revision): PublicationResult {
  return { enabled: true, publication: { savedRevision, lastPublishedRevision: state === "succeeded" ? revision : 1, pageUrl: "https://notion.invalid/page", activeJobId: ["preview", "succeeded"].includes(state) ? null : "job" },
    job: { id: "job", groupKey: "trade", revision, state, error: null, retryAt: null, phase: state, missingSections: [], pageUrl: null, presentationVersion: NOTION_PRESENTATION_VERSION, templateVersion: "v1", properties: [], omitted: [], errors: [], sections: [], assets: undefined } };
}
function responses(...results: PublicationResult[]) {
  const fetcher = vi.fn(); results.forEach(value => fetcher.mockResolvedValueOnce(Response.json(value))); vi.stubGlobal("fetch", fetcher); return fetcher;
}
const actions = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.map(([, init]) => init.body ? JSON.parse(init.body) : "GET");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("publication continuation without implicit publishing", () => {
  it("refreshes an obsolete new-page preview without confirming writes", async () => {
    const completed = result("succeeded"); completed.job!.presentationVersion = 1;
    completed.publication.pageUrl = null; completed.publication.presentationVersion = 4;
    completed.job!.reviewCompletion = { outcome: "already-reviewed", sourceRevision: 2, revision: 2, noteUpdatedAt: null, journalUpdatedAt: null, previousNoteUpdatedAt: null, previousJournalUpdatedAt: null };
    completed.publication.savedNoteUpdatedAt = null; completed.publication.savedJournalUpdatedAt = null;
    expect(publicationContentChanged(completed.job, completed.publication)).toBe(false);
    const fetcher = responses(completed, result());
    expect((await openPublication("trade", new AbortController().signal, vi.fn())).job?.state).toBe("preview");
    expect(actions(fetcher)).toEqual(["GET", { action: "preview", groupKey: "trade", revision: 2 }]);
  });
  it.each([1, 2, 3])("does not offer a format upgrade for an existing version %s page", async version => {
    const completed = result("succeeded"); completed.job!.presentationVersion = version; completed.publication.presentationVersion = version;
    const fetcher = responses(completed);
    expect((await openPublication("trade", new AbortController().signal, vi.fn())).job?.state).toBe("succeeded");
    expect(actions(fetcher)).toEqual(["GET"]);
  });
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
    expect(loaded.job?.state).toBe("succeeded"); expect(actions(fetcher)).toEqual(["GET"]);
  });
  it("acknowledges the automatic status revision without preparing another preview", async () => {
    const completed = result("succeeded", 2, 3);
    completed.job!.reviewCompletion = { outcome: "updated", sourceRevision: 2, revision: 3, noteUpdatedAt: "2026-09-30T00:00:01Z", journalUpdatedAt: null, previousNoteUpdatedAt: null, previousJournalUpdatedAt: null };
    completed.publication.savedNoteUpdatedAt = "2026-09-30T00:00:01Z"; completed.publication.savedJournalUpdatedAt = null;
    const fetcher = responses(completed, completed);
    await continuePublication("trade", "publish", result(), new AbortController().signal, vi.fn());
    await openPublication("trade", new AbortController().signal, vi.fn());
    expect(actions(fetcher)).toEqual([{ action: "publish", groupKey: "trade", id: "job" }, "GET"]);
  });
  it("still refreshes the schema and preview when explicitly requested", async () => {
    const fetcher = responses(result("succeeded"), result());
    await openPublication("trade", new AbortController().signal, vi.fn(), true);
    expect(actions(fetcher)).toEqual(["GET", { action: "preview", groupKey: "trade", revision: 2 }]);
  });
  it.each(["during", "after"])("prepares linked-journal edits made %s publication even without a revision increment", async timing => {
    const completed = result("succeeded", 2, 2);
    completed.job!.reviewCompletion = timing === "during" ? { outcome: "superseded", sourceRevision: 2 } : { outcome: "already-reviewed", sourceRevision: 2, revision: 2, noteUpdatedAt: null, journalUpdatedAt: null, previousNoteUpdatedAt: null, previousJournalUpdatedAt: null };
    completed.publication.savedNoteUpdatedAt = null; completed.publication.savedJournalUpdatedAt = "2026-09-30T00:00:01Z";
    const fetcher = responses(completed, result());
    if (timing === "during") await continuePublication("trade", "resume", result("waiting"), new AbortController().signal, vi.fn());
    else await openPublication("trade", new AbortController().signal, vi.fn());
    expect(actions(fetcher).at(-1)).toEqual({ action: "preview", groupKey: "trade", revision: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
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
