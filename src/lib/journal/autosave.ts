export const SERVER_SAVE_DELAY = 1200;
export const DRAFT_SAVE_DELAY = 300;
export const DRAFT_MAX_WAIT = 2000;
export type SaveState<T> = { value: T; dirty: boolean; saving: boolean; error: string; backupError: string; version: number };
type Options<T> = {
  save(value: T): Promise<T>;
  merge(latest: T, saved: T): T;
  checkpoint?(value: T, version: number): Promise<void>;
  clearCheckpoint?(version: number): Promise<void>;
  saved?(snapshot: T, saved: T): void;
  automatic?: boolean;
  dirty?: boolean;
  error?: string;
};

/** One editor session. Its identity and callbacks never change underneath a request. */
export class Autosave<T> {
  private state: SaveState<T>;
  private listeners = new Set<() => void>();
  private acknowledged = 0;
  private lastEdit = 0;
  private firstUnbackedEdit: number | null = null;
  private serverTimer?: ReturnType<typeof setTimeout>;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private job: Promise<boolean> | null = null;
  private writes: Promise<unknown> = Promise.resolve();
  private automatic: boolean;
  private disposed = false;

  constructor(value: T, private options: Options<T>) {
    this.automatic = options.automatic !== false;
    this.state = { value, dirty: !!options.dirty, saving: false, error: options.error ?? "", backupError: "", version: options.dirty ? 1 : 0 };
    this.lastEdit = Date.now();
    if (options.dirty) { this.scheduleServer(); this.scheduleDraft(); }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<SaveState<T>>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.listeners.forEach(listener => listener());
  }
  change = (update: (value: T) => T) => {
    if (this.disposed) return;
    this.lastEdit = Date.now();
    this.publish({ value: update(this.state.value), version: this.state.version + 1, dirty: true });
    this.scheduleServer(); this.scheduleDraft();
  };
  metadata = (update: (value: T) => T) => { this.publish({ value: update(this.state.value) }); };
  setAutomatic(enabled: boolean) { this.automatic = enabled; this.scheduleServer(); }
  private scheduleServer() {
    clearTimeout(this.serverTimer);
    if (!this.automatic || this.disposed || !this.state.dirty || this.state.error || this.job) return;
    this.serverTimer = setTimeout(() => { void this.start(); }, Math.max(0, this.lastEdit + SERVER_SAVE_DELAY - Date.now()));
  }
  private scheduleDraft() {
    if (!this.options.checkpoint) return;
    this.firstUnbackedEdit ??= Date.now();
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => { void this.checkpoint(); }, Math.max(0, Math.min(DRAFT_SAVE_DELAY, this.firstUnbackedEdit + DRAFT_MAX_WAIT - Date.now())));
  }
  checkpoint = async () => {
    clearTimeout(this.draftTimer); this.firstUnbackedEdit = null;
    if (!this.state.dirty || !this.options.checkpoint) return;
    const { value, version } = this.state;
    try { await this.options.checkpoint(value, version); this.publish({ backupError: "" }); }
    catch { this.publish({ backupError: "Local recovery backup failed. Keep this tab open until saved, or export your draft." }); }
  };
  private serial<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => undefined);
    return result;
  }
  /** Use after flushing for attachment writes that share the entry revision token. */
  exclusive = <R,>(operation: () => Promise<R>) => this.serial(operation);
  private start(): Promise<boolean> {
    if (this.job) return this.job;
    if (this.state.error || this.disposed) return Promise.resolve(false);
    if (!this.state.dirty) return Promise.resolve(true);
    clearTimeout(this.serverTimer);
    this.job = this.serial(async () => {
      const { value: snapshot, version } = this.state;
      this.publish({ saving: true });
      try {
        const saved = await this.options.save(snapshot);
        this.acknowledged = version;
        const dirty = this.state.version > this.acknowledged;
        this.publish({ value: this.options.merge(this.state.value, saved), dirty, error: "" });
        if (!this.disposed) this.options.saved?.(snapshot, saved);
        try {
          if (dirty) await this.checkpoint();
          else { clearTimeout(this.draftTimer); this.firstUnbackedEdit = null; await this.options.clearCheckpoint?.(version); this.publish({ backupError: "" }); }
        } catch { this.publish({ backupError: "Saved to server, but local recovery cleanup failed." }); }
        return true;
      } catch (error) {
        this.publish({ error: error instanceof Error ? error.message : "Save failed", dirty: true });
        await this.checkpoint();
        return false;
      } finally { this.publish({ saving: false }); }
    }).finally(() => { this.job = null; this.scheduleServer(); });
    return this.job;
  }
  flush = async (): Promise<boolean> => {
    clearTimeout(this.serverTimer);
    do {
      while (this.job || this.state.dirty) {
        if (this.disposed || this.state.error) return false;
        if (!(await (this.job ?? this.start()))) return false;
      }
      await this.writes;
    } while (this.state.dirty);
    return !this.disposed && !this.state.error;
  };
  retry = () => { this.publish({ error: "" }); return this.flush(); };
  pause(message: string) { clearTimeout(this.serverTimer); this.publish({ error: message }); }
  dispose() {
    clearTimeout(this.serverTimer); clearTimeout(this.draftTimer);
    void this.checkpoint();
    this.disposed = true; this.listeners.clear();
  }
}
