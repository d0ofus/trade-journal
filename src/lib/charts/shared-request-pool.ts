export type SharedRequestLease<T> = {
  key: string;
  promise: Promise<T>;
  release: () => void;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type RequestEntry<T> = {
  controller: AbortController;
  owners: number;
  abandoned: boolean;
  settled: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  promise: Promise<T>;
};

type SharedRequestPoolOptions<T> = {
  load: (key: string, signal: AbortSignal) => Promise<T>;
  shouldCache: (value: T, key: string) => boolean;
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  now?: () => number;
};

function abortError(message: string) {
  return new DOMException(message, "AbortError");
}

export function createSharedRequestPool<T>(options: SharedRequestPoolOptions<T>) {
  const inflight = new Map<string, RequestEntry<T>>();
  const cache = new Map<string, CacheEntry<T>>();
  const now = options.now ?? Date.now;

  function cachedValue(key: string) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }

  function remember(key: string, value: T) {
    cache.set(key, { expiresAt: now() + options.cacheTtlMs, value });
    while (cache.size > options.maxCacheEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }

  function startRequest(key: string) {
    const controller = new AbortController();
    const entry = {} as RequestEntry<T>;
    entry.controller = controller;
    entry.owners = 0;
    entry.abandoned = false;
    entry.settled = false;
    entry.timeoutId = null;
    const loadPromise = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return options.load(key, controller.signal);
      })
      .then((value) => {
        if (
          !entry.abandoned
          && !controller.signal.aborted
          && inflight.get(key) === entry
          && options.shouldCache(value, key)
        ) {
          remember(key, value);
        }
        return value;
      });
    let handleAbort!: () => void;
    const abortPromise = new Promise<T>((_resolve, reject) => {
      handleAbort = () => reject(controller.signal.reason ?? abortError("Candle request aborted."));
      controller.signal.addEventListener("abort", handleAbort, { once: true });
    });
    entry.promise = Promise.race([loadPromise, abortPromise])
      .finally(() => {
        controller.signal.removeEventListener("abort", handleAbort);
        entry.settled = true;
        if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
        if (inflight.get(key) === entry) inflight.delete(key);
      });

    entry.timeoutId = setTimeout(() => {
      if (entry.settled || inflight.get(key) !== entry) return;
      inflight.delete(key);
      entry.abandoned = true;
      controller.abort(abortError("Candle request timed out."));
    }, options.requestTimeoutMs);
    inflight.set(key, entry);
    return entry;
  }

  return {
    acquire(key: string): SharedRequestLease<T> {
      const cached = cachedValue(key);
      if (cached !== null) {
        return { key, promise: Promise.resolve(cached), release: () => undefined };
      }

      const entry = inflight.get(key) ?? startRequest(key);
      entry.owners += 1;
      let released = false;

      return {
        key,
        promise: entry.promise,
        release() {
          if (released) return;
          released = true;
          entry.owners = Math.max(0, entry.owners - 1);
          if (entry.owners > 0 || entry.settled || entry.abandoned) return;
          if (inflight.get(key) === entry) inflight.delete(key);
          entry.abandoned = true;
          if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
          entry.controller.abort(abortError("Candle request released."));
        },
      };
    },
  };
}
