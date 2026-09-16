import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecoveryStore } from "./recovery";
type Value = { text: string; images: string[] };
const sample = (text = "draft"): Value => ({ text, images: ["data:image/png;base64,one", "data:image/png;base64,two"] });
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const scope = () => `test:${crypto.randomUUID()}`;

it("checkpoints text separately and rewrites images only when they change", async () => {
  const owner = new RecoveryStore<Value>(scope(), "one");
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  await owner.write(sample(), 1); await owner.write(sample("second"), 2);
  const assets = () => put.mock.calls.filter(([value]) => value.value?.startsWith("data:image/"));
  expect(assets()).toHaveLength(2);
  const reload = new RecoveryStore<Value>(owner.scope, "one");
  expect(await reload.load()).toEqual(sample("second"));
  await reload.write(sample("third"), 1); expect(assets()).toHaveLength(2);
  await reload.clear(1);
  const acknowledged = new RecoveryStore<Value>(owner.scope, "one");
  expect(await acknowledged.load()).toBeNull();
  await acknowledged.write(sample("fourth"), 1); expect(assets()).toHaveLength(2);
  await acknowledged.write({ text: "new image", images: ["data:image/png;base64,three"] }, 2);
  expect(assets()).toHaveLength(3);
  expect(await new RecoveryStore<Value>(owner.scope, "one").load()).toEqual({ text: "new image", images: ["data:image/png;base64,three"] });
});

it("prefers this tab, then the latest other tab, and never deletes another tab's work", async () => {
  const entity = scope(), a = new RecoveryStore<Value>(entity, "a"), b = new RecoveryStore<Value>(entity, "b");
  const time = vi.spyOn(Date, "now").mockReturnValue(100);
  await a.write(sample("a"), 1); time.mockReturnValue(200); await b.write(sample("b"), 1);
  expect(await new RecoveryStore<Value>(entity, "a").load()).toEqual(sample("a"));
  const c = new RecoveryStore<Value>(entity, "c");
  expect(await c.load()).toEqual(sample("b"));
  await c.write(sample("adopted"), 1); await c.clear(1);
  expect(await new RecoveryStore<Value>(entity, "b").load()).toEqual(sample("b"));
  await b.discard();
  expect(await new RecoveryStore<Value>(entity, "a").load()).toEqual(sample("a"));
});

it("keeps edits newer than a server acknowledgement and ignores an old session's cleanup", async () => {
  const entity = scope(), first = new RecoveryStore<Value>(entity, "one");
  await first.write(sample("first"), 1); await first.write(sample("newer"), 2); await first.clear(1);
  const next = new RecoveryStore<Value>(entity, "one");
  expect(await next.load()).toEqual(sample("newer"));
  await next.write(sample("new session"), 1); await first.clear(2);
  await expect(first.write(sample("late old session"), 3)).rejects.toThrow("newer editor session");
  expect(await new RecoveryStore<Value>(entity, "one").load()).toEqual(sample("new session"));
});

it("rolls back failed transactions, preserving the old draft and its images", async () => {
  const store = new RecoveryStore<Value>(scope(), "one"); await store.write(sample(), 1);
  const original = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === "drafts") throw new DOMException("quota", "QuotaExceededError");
    return original.call(this, value, key);
  });
  await expect(store.write({ text: "failed", images: [] }, 2)).rejects.toThrow("quota");
  put.mockRestore();
  expect(await new RecoveryStore<Value>(store.scope, "one").load()).toEqual(sample());
  await store.write({ text: "retry", images: [] }, 3);
  expect(await new RecoveryStore<Value>(store.scope, "one").load()).toEqual({ text: "retry", images: [] });
});
