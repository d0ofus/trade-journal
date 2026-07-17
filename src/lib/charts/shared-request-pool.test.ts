import { describe, expect, it, vi } from "vitest";
import { createSharedRequestPool } from "@/lib/charts/shared-request-pool";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createPool(loader: (key: string, signal: AbortSignal) => Promise<string>) {
  return createSharedRequestPool({
    load: loader,
    shouldCache: (value) => value.startsWith("usable:"),
    cacheTtlMs: 60_000,
    maxCacheEntries: 4,
    requestTimeoutMs: 30_000,
  });
}

describe("createSharedRequestPool", () => {
  it("shares an identical request until every owner releases it", async () => {
    const pending = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((_key: string, signal: AbortSignal) => {
      signals.push(signal);
      return pending.promise;
    });
    const pool = createPool(load);

    const first = pool.acquire("same");
    const second = pool.acquire("same");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    const abort = vi.fn();
    signals[0].addEventListener("abort", abort);

    first.release();
    first.release();
    expect(signals[0].aborted).toBe(false);

    second.release();
    expect(signals[0].aborted).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
    pending.reject(signals[0].reason);
    await expect(first.promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("starts a clean request when a new owner arrives after final release", async () => {
    const requests: Array<{ pending: ReturnType<typeof deferred<string>>; signal: AbortSignal }> = [];
    const pool = createPool((_key, signal) => {
      const pending = deferred<string>();
      requests.push({ pending, signal });
      return pending.promise;
    });

    const obsolete = pool.acquire("same");
    await Promise.resolve();
    obsolete.release();
    requests[0].pending.reject(requests[0].signal.reason);
    await expect(obsolete.promise).rejects.toMatchObject({ name: "AbortError" });

    const current = pool.acquire("same");
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    requests[1].pending.resolve("usable:new");
    await expect(current.promise).resolves.toBe("usable:new");
    current.release();
  });

  it("rejects and does not cache an abandoned response that resolves after abort", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const pool = createPool(load);

    const obsolete = pool.acquire("same");
    await Promise.resolve();
    obsolete.release();
    await expect(obsolete.promise).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve("usable:late");
    await Promise.resolve();

    const current = pool.acquire("same");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    await expect(current.promise).resolves.toBe("usable:late");
    current.release();
  });

  it("caches only reusable completed responses", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce("empty")
      .mockResolvedValueOnce("usable:bars");
    const pool = createPool(load);

    const empty = pool.acquire("same");
    await expect(empty.promise).resolves.toBe("empty");
    empty.release();
    const usable = pool.acquire("same");
    await expect(usable.promise).resolves.toBe("usable:bars");
    usable.release();
    const cached = pool.acquire("same");
    await expect(cached.promise).resolves.toBe("usable:bars");
    cached.release();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects at the deadline and quarantines an abort-insensitive late response", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<string>();
      const load = vi.fn(() => pending.promise);
      const pool = createSharedRequestPool({
        load,
        shouldCache: () => true,
        cacheTtlMs: 60_000,
        maxCacheEntries: 4,
        requestTimeoutMs: 100,
      });
      const lease = pool.acquire("hung");
      const rejection = expect(lease.promise).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
      lease.release();

      pending.resolve("usable:late");
      await Promise.resolve();
      const retry = pool.acquire("hung");
      await Promise.resolve();
      expect(load).toHaveBeenCalledTimes(2);
      await expect(retry.promise).resolves.toBe("usable:late");
      retry.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
