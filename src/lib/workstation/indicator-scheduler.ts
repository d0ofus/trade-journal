/** Workspace-owned supplementary queue. Foreground history preempts indicator transport. */
export class IndicatorScheduler {
  private foregrounds = new Set<string>();
  private generation = 0;
  private active: AbortController | null = null;
  private listeners = new Set<() => void>();
  foreground(id: string, busy: boolean) {
    if (busy !== this.foregrounds.has(id)) this.generation++;
    if (busy) { this.foregrounds.add(id); this.active?.abort(); }
    else this.foregrounds.delete(id);
    this.listeners.forEach(listener => listener());
  }
  private wait(signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const finish = () => { this.listeners.delete(ready); signal.removeEventListener("abort", abort); };
      const ready = () => { finish(); resolve(); }, abort = () => { finish(); reject(signal.reason); };
      this.listeners.add(ready); signal.addEventListener("abort", abort, { once: true });
    });
  }
  /** Network completion precedes the native canvas paint. Give every mounted
   * price chart two animation frames before indicators allocate panes or run. */
  async settled(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      if (this.foregrounds.size) { await this.wait(signal); continue; }
      const generation = this.generation;
      await new Promise<void>((resolve, reject) => {
        let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => { signal.removeEventListener("abort", abort); resolve(); };
        const abort = () => { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame); clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
        else timer = setTimeout(done, 0);
      });
      signal.throwIfAborted();
      if (!this.foregrounds.size && generation === this.generation) return;
    }
  }
  async run<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (;;) {
      signal.throwIfAborted();
      if (this.active || this.foregrounds.size) { await this.wait(signal); continue; }
      const controller = new AbortController(); this.active = controller;
      try { return await work(AbortSignal.any([signal, controller.signal])); }
      catch (error) { if (signal.aborted || !controller.signal.aborted) throw error; }
      finally { if (this.active === controller) this.active = null; this.listeners.forEach(listener => listener()); }
    }
  }
}
