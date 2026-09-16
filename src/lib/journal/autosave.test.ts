import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Autosave } from "./autosave";
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
type Draft = { text: string; revision: number };
const merge = (latest: Draft, saved: Draft) => ({ ...latest, revision: saved.revision });

it("waits 1200 ms after the final edit, preserving immediate draft access", async () => {
  const save = vi.fn(async (d: Draft) => ({ ...d, revision: d.revision + 1 }));
  const session = new Autosave({ text: "", revision: 0 }, { save, merge });
  session.change(d => ({ ...d, text: "a" })); await vi.advanceTimersByTimeAsync(1000);
  session.change(d => ({ ...d, text: "ab" })); expect(session.getSnapshot().value.text).toBe("ab");
  await vi.advanceTimersByTimeAsync(1199); expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledOnce(); expect(session.getSnapshot().dirty).toBe(false);
  session.dispose();
});

it("serializes slow saves and waits for a new quiet period without replacing newer typing", async () => {
  const first = deferred<Draft>();
  const save = vi.fn<(d: Draft) => Promise<Draft>>().mockReturnValueOnce(first.promise).mockImplementation(async d => ({ ...d, revision: d.revision + 1 }));
  const session = new Autosave({ text: "", revision: 0 }, { save, merge });
  session.change(d => ({ ...d, text: "first" })); await vi.advanceTimersByTimeAsync(1200);
  session.change(d => ({ ...d, text: "newer" })); await vi.advanceTimersByTimeAsync(500);
  first.resolve({ text: "first", revision: 1 }); await vi.advanceTimersByTimeAsync(0);
  expect(session.getSnapshot().value).toEqual({ text: "newer", revision: 1 }); expect(session.getSnapshot().dirty).toBe(true);
  await vi.advanceTimersByTimeAsync(699); expect(save).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledTimes(2); expect(save.mock.lastCall![0].revision).toBe(1);
  session.dispose();
});

it("explicit flush drains edits made during a pending write immediately", async () => {
  const first = deferred<Draft>();
  const save = vi.fn<(d: Draft) => Promise<Draft>>().mockReturnValueOnce(first.promise).mockImplementation(async d => ({ ...d, revision: d.revision + 1 }));
  const session = new Autosave({ text: "a", revision: 0 }, { save, merge, dirty: true });
  const flush = session.flush(); await vi.advanceTimersByTimeAsync(0);
  session.change(d => ({ ...d, text: "b" })); first.resolve({ text: "a", revision: 1 });
  expect(await flush).toBe(true); expect(save).toHaveBeenCalledTimes(2); expect(session.getSnapshot().value.text).toBe("b");
  session.dispose();
});

it("bounds recovery checkpoints during continuous typing and separates storage errors", async () => {
  const checkpoint = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
  const session = new Autosave({ text: "", revision: 0 }, { save: async d => d, merge, checkpoint });
  for (let i = 0; i < 10; i++) { session.change(d => ({ ...d, text: d.text + "a" })); await vi.advanceTimersByTimeAsync(200); }
  expect(checkpoint).toHaveBeenCalledOnce(); expect(session.getSnapshot().backupError).toContain("Local recovery"); expect(session.getSnapshot().error).toBe("");
  session.change(d => ({ ...d, text: "last" })); await vi.advanceTimersByTimeAsync(300);
  expect(checkpoint).toHaveBeenCalledTimes(2); expect(session.getSnapshot().backupError).toBe(""); session.dispose();
});

it("pauses after server failure, preserves edits and explicitly retries", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("revision conflict")).mockImplementation(async (d: Draft) => ({ ...d, revision: 1 }));
  const session = new Autosave({ text: "", revision: 0 }, { save, merge });
  session.change(d => ({ ...d, text: "draft" })); expect(await session.flush()).toBe(false);
  session.change(d => ({ ...d, text: "continued" })); await vi.advanceTimersByTimeAsync(10000);
  expect(save).toHaveBeenCalledOnce(); expect(session.getSnapshot().dirty).toBe(true);
  expect(await session.retry()).toBe(true); expect(session.getSnapshot().value.text).toBe("continued"); session.dispose();
});

it("does not publish a late save into a disposed editor", async () => {
  const pending = deferred<Draft>(), saved = vi.fn();
  const session = new Autosave({ text: "old", revision: 0 }, { save: () => pending.promise, merge, saved, dirty: true });
  const flush = session.flush(); await vi.advanceTimersByTimeAsync(0); session.dispose();
  pending.resolve({ text: "old", revision: 1 }); await flush; expect(saved).not.toHaveBeenCalled();
});

it("coordinates auxiliary writes and takes the latest revision after they finish", async () => {
  const pending = deferred<void>(), order: string[] = [];
  const save = vi.fn(async (value: Draft) => { order.push("text"); return { ...value, revision: value.revision + 1 }; });
  const session = new Autosave({ text: "", revision: 0 }, { save, merge });
  const attachment = session.exclusive(async () => {
    order.push("attachment"); await pending.promise;
    session.metadata(value => ({ ...value, revision: 1 }));
  });
  session.change(value => ({ ...value, text: "while uploading" }));
  await vi.advanceTimersByTimeAsync(1200); expect(save).not.toHaveBeenCalled();
  const flush = session.flush(); pending.resolve(); await attachment;
  expect(await flush).toBe(true); expect(order).toEqual(["attachment", "text"]);
  expect(save.mock.calls[0][0].revision).toBe(1); expect(session.getSnapshot().value.revision).toBe(2); session.dispose();
});
