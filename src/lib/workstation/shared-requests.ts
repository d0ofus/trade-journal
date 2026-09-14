/** Share transport work without letting one departing chart cancel another chart. */
export class SharedRequests<T> {
  private entries = new Map<string, { controller: AbortController; consumers: Set<symbol>; promise: Promise<T>; settled: boolean }>();

  run(key: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, consumers: new Set(), promise: Promise.resolve().then(() => work(controller.signal)), settled: false };
      this.entries.set(key, entry);
      const owned = entry;
      const finish = () => {
        owned.settled = true;
        if (this.entries.get(key) === owned) this.entries.delete(key);
      };
      void entry.promise.then(finish, finish);
    }
    const shared = entry, consumer = Symbol(key);
    shared.consumers.add(consumer);
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener("abort", aborted);
        shared.consumers.delete(consumer);
        if (!shared.settled && !shared.consumers.size) {
          if (this.entries.get(key) === shared) this.entries.delete(key);
          shared.controller.abort();
        }
      };
      const aborted = () => { cleanup(); reject(signal!.reason); };
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) { aborted(); return; }
      void shared.promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
}

export function waitForHistory(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
