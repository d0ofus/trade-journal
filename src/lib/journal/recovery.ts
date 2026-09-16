const DATABASE = "execution-lab-journal-recovery";
type AssetRef = { __journalRecoveryAsset: string };
type Draft = { key: string; scope: string; tab: string; epoch: string; version: number; updatedAt: number; acknowledged?: boolean; payload: unknown; assets: string[] };
type Asset = { key: string; value: string };
let opening: Promise<IDBDatabase> | undefined;
const result = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const complete = (transaction: IDBTransaction) => {
  const pending = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Recovery transaction failed")); });
  // A request may fail before its caller reaches the transaction await.
  void pending.catch(() => undefined);
  return pending;
};
function dismissed(key: string): string[] {
  try { return JSON.parse(sessionStorage.getItem(`recovery-dismissed:${key}`) ?? "[]") as string[]; } catch { return []; }
}
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("drafts", { keyPath: "key" }).createIndex("scope", "scope");
      db.createObjectStore("assets", { keyPath: "key" });
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error("Recovery storage upgrade blocked by another tab")); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
  });
}
let volatileTab: string | undefined;
let claimedTab: Promise<string> | undefined;
export function recoveryTab() {
  try {
  const key = "execution-lab:recovery-tab";
  let tab = sessionStorage.getItem(key);
  if (!tab) { tab = crypto.randomUUID(); sessionStorage.setItem(key, tab); }
  return tab;
  } catch { return volatileTab ??= crypto.randomUUID(); }
}

// Duplicating a tab can clone sessionStorage. A live owner lock prevents both
// documents from treating that cloned recovery identity as their own.
function claimTab() {
  return claimedTab ??= new Promise<string>(resolve => {
    const candidate = recoveryTab();
    if (typeof navigator === "undefined" || !navigator.locks) { resolve(candidate); return; }
    const acquire = (tab: string) => {
      void navigator.locks.request(`journal-recovery-owner:${tab}`, { ifAvailable: true }, lock => {
        if (!lock) {
          const next = crypto.randomUUID();
          try { sessionStorage.setItem("execution-lab:recovery-tab", next); } catch { volatileTab = next; }
          acquire(next); return;
        }
        resolve(tab);
        return new Promise<void>(release => window.addEventListener("pagehide", () => release(), { once: true }));
      }).catch(() => resolve(candidate));
    };
    acquire(candidate);
  });
}

/** Image strings are stored once per owner; text checkpoints contain only references. */
export class RecoveryStore<T> {
  private epoch = crypto.randomUUID();
  private images = new Map<string, string>();
  private written = new Set<string>();
  private operations: Promise<unknown> = Promise.resolve();
  private clearedThrough = -1;
  private restored: Draft | null = null;
  private ownedEpoch: string | undefined;
  key: string;
  tab: string;
  private ready: Promise<void>;
  constructor(readonly scope: string, tab?: string) {
    this.tab = tab ?? recoveryTab(); this.key = `${scope}:${this.tab}`;
    this.ready = tab ? Promise.resolve() : claimTab().then(owner => { this.tab = owner; this.key = `${scope}:${owner}`; });
  }
  private serial<R>(operation: () => Promise<R>): Promise<R> {
    const pending = this.operations.then(() => this.ready).then(operation);
    this.operations = pending.catch(() => undefined);
    return pending;
  }
  load = () => this.serial(async (): Promise<T | null> => {
    const db = await database();
    const tx = db.transaction(["drafts", "assets"], "readonly"), done = complete(tx);
    const candidates = await result(tx.objectStore("drafts").index("scope").getAll(this.scope)) as Draft[];
    const ignored = new Set(dismissed(this.key));
    const available = candidates.filter(d => !d.acknowledged && !ignored.has(`${d.key}:${d.epoch}:${d.version}`));
    const draft = available.find(d => d.tab === this.tab) ?? available.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const owned = candidates.find(d => d.tab === this.tab);
    this.ownedEpoch = owned?.epoch;
    const retained = owned ? await Promise.all(owned.assets.map(key => result(tx.objectStore("assets").get(key)) as Promise<Asset | undefined>)) : [];
    for (const asset of retained) if (asset) { this.images.set(asset.value, asset.key); this.written.add(asset.key); }
    if (!draft) { await done; return null; }
    const assets = new Map((await Promise.all(draft.assets.map(key => result(tx.objectStore("assets").get(key)) as Promise<Asset | undefined>))).filter((a): a is Asset => !!a).map(a => [a.key, a.value]));
    await done;
    const decode = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(decode);
      if (value && typeof value === "object") {
        if ("__journalRecoveryAsset" in value && Object.keys(value).length === 1) {
          const image = assets.get((value as AssetRef).__journalRecoveryAsset);
          if (image === undefined) throw new Error("A recovery image is missing. The saved server review has not been changed.");
          return image;
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decode(child)]));
      }
      return value;
    };
    this.restored = draft;
    return decode(draft.payload) as T;
  });
  write = (value: T, version: number) => this.serial(async () => {
    if (version <= this.clearedThrough) return;
    const used = new Set<string>(), additions: Asset[] = [];
    const encode = (child: unknown): unknown => {
      if (typeof child === "string" && child.startsWith("data:image/")) {
        let key = this.images.get(child);
        if (!key) { key = `${this.key}:${crypto.randomUUID()}`; this.images.set(child, key); }
        used.add(key);
        if (!this.written.has(key)) additions.push({ key, value: child });
        return { __journalRecoveryAsset: key } satisfies AssetRef;
      }
      if (Array.isArray(child)) return child.map(encode);
      if (child && typeof child === "object") return Object.fromEntries(Object.entries(child).map(([key, item]) => [key, encode(item)]));
      return child;
    };
    const payload = encode(value), db = await database();
    const tx = db.transaction(["drafts", "assets"], "readwrite"), done = complete(tx);
    try {
    const old = await result(tx.objectStore("drafts").get(this.key)) as Draft | undefined;
    if (old && old.epoch !== this.epoch && old.epoch !== this.ownedEpoch) throw new Error("A newer editor session owns this recovery record.");
    for (const asset of additions) tx.objectStore("assets").put(asset);
    for (const key of old?.assets ?? []) if (!used.has(key)) tx.objectStore("assets").delete(key);
    tx.objectStore("drafts").put({ key: this.key, scope: this.scope, tab: this.tab, epoch: this.epoch, version, updatedAt: Date.now(), payload, assets: [...used] } satisfies Draft);
    await done;
    this.written = used;
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await done.catch(() => undefined);
      throw error;
    }
  });
  clear = (version: number) => {
    this.clearedThrough = Math.max(this.clearedThrough, version);
    return this.serial(async () => {
      const db = await database(), tx = db.transaction(["drafts", "assets"], "readwrite"), done = complete(tx);
      const old = await result(tx.objectStore("drafts").get(this.key)) as Draft | undefined;
      if (old && (old.epoch === this.epoch ? old.version <= version : old.epoch === this.ownedEpoch)) {
        if (version === Number.MAX_SAFE_INTEGER) {
          tx.objectStore("drafts").delete(this.key);
          old.assets.forEach(key => tx.objectStore("assets").delete(key));
        } else tx.objectStore("drafts").put({ ...old, acknowledged: true, payload: null });
      }
      await done; if (version === Number.MAX_SAFE_INTEGER) this.written.clear();
      if (this.restored && version !== Number.MAX_SAFE_INTEGER) {
        const key = `recovery-dismissed:${this.key}`;
        try { const ignored = JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]; sessionStorage.setItem(key, JSON.stringify([...ignored.slice(-49), `${this.restored.key}:${this.restored.epoch}:${this.restored.version}`])); } catch { /* acknowledgement remains durable in IndexedDB */ }
      }
    });
  };
  discard = async () => {
    if (this.restored) {
      const key = `recovery-dismissed:${this.key}`, ignored = dismissed(this.key);
      try { sessionStorage.setItem(key, JSON.stringify([...ignored.slice(-49), `${this.restored.key}:${this.restored.epoch}:${this.restored.version}`])); } catch { /* discard only this tab's record */ }
    }
    await this.clear(Number.MAX_SAFE_INTEGER);
  };
}
