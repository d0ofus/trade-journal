import { assertEvidenceCapacity, EVIDENCE_PROTOCOL, IMAGE_MAX_BYTES, type ImageAssetReference } from "./image-assets";
import type { Evidence, TradeDocument } from "./types";
import type { ReviewSectionKey } from "./notion-template";

type PendingImage = { key: string; tradeId: string; mode: "demo" | "application"; evidence: Evidence; blob: Blob; uploadId?: string; clientKey?: string; section?: ReviewSectionKey; createdAt: number };
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("execution-lab-private-images", 1);
  request.onupgradeneeded = () => { request.result.createObjectStore("originals"); request.result.createObjectStore("pending", { keyPath: "key" }); };
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Image recovery storage is unavailable. Enable IndexedDB before uploading."));
});
async function record<T>(store: "originals" | "pending", mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  try { return await new Promise<T>((resolve, reject) => { const tx = db.transaction(store, mode), request = operation(tx.objectStore(store)); tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Image recovery storage failed.")); }); }
  finally { db.close(); }
}
export async function pendingEvidence(tradeId: string, mode: "demo" | "application") { return (await record("pending", "readonly", s => s.getAll()) as PendingImage[]).filter(p => p.tradeId === tradeId && p.mode === mode); }
export async function forgetPendingEvidence(tradeId: string, mode: "demo" | "application", id: string) { await record("pending", "readwrite", s => s.delete(`${mode}:${tradeId}:${id}`)); }
export async function discardPendingEvidence(pending: PendingImage) {
  if (pending.mode === "application" && pending.uploadId) await request(`/api/closed-trades/${encodeURIComponent(pending.tradeId)}/evidence`, undefined, { action: "cancel", id: pending.uploadId });
  await forgetPendingEvidence(pending.tradeId, pending.mode, pending.evidence.id);
}
export async function clearDemoImages() {
  const pending = await record("pending", "readonly", s => s.getAll()) as PendingImage[];
  for (const item of pending) if (item.mode === "demo") await record("pending", "readwrite", s => s.delete(item.key));
  const keys = await record("originals", "readonly", s => s.getAllKeys());
  for (const key of keys) if (String(key).startsWith("demo-")) await record("originals", "readwrite", s => s.delete(key));
  clearEvidenceCache();
}
const sha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
export async function inlinePngBlob(image: string) {
  if (!image.startsWith("data:image/png;base64,")) throw new Error("The image is not a normalized PNG.");
  const blob = await (await fetch(image)).blob();
  if (!blob.size || blob.size > IMAGE_MAX_BYTES) throw new Error("This PNG exceeds 20,000,000 bytes. Choose a smaller image or Standard capture quality; quality has not been reduced.");
  return blob;
}
class ImageRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, signal?: AbortSignal, action?: object): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal, ...action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {} });
  if (response.status === 401) clearEvidenceCache();
  const result = await response.json();
  if (!response.ok || result.error) throw new ImageRequestError(result.error ?? "Image storage is unavailable.", response.status);
  return result;
}
let transfers = 0;
const waiters: (() => void)[] = [];
async function transferSlot(signal?: AbortSignal) {
  while (transfers >= 2) { await new Promise<void>(resolve => waiters.push(resolve)); signal?.throwIfAborted(); }
  transfers++;
  return () => { transfers--; waiters.splice(0).forEach(resolve => resolve()); };
}
export async function storeEvidence(tradeId: string, mode: "demo" | "application", evidence: Evidence, signal?: AbortSignal, section?: ReviewSectionKey): Promise<Evidence> {
  if (evidence.asset) return evidence;
  signal?.throwIfAborted();
  const blob = await inlinePngBlob(evidence.image), bytes = await blob.arrayBuffer(), hash = await sha256(bytes);
  const key = `${mode}:${tradeId}:${evidence.id}`;
  const previous = await record("pending", "readonly", s => s.get(key)) as PendingImage | undefined;
  // Pending bytes live in IndexedDB, never a JSON autosave or publication snapshot.
  const pending: PendingImage = { key, tradeId, mode, evidence: { ...evidence, image: "" }, blob, uploadId: previous?.uploadId, clientKey: previous?.clientKey ?? evidence.id, section: section ?? previous?.section, createdAt: previous?.createdAt ?? Date.now() };
  await record("pending", "readwrite", s => s.put(pending));
  signal?.throwIfAborted();
  let asset: ImageAssetReference;
  if (mode === "demo") {
    const bitmap = await createImageBitmap(blob);
    try { asset = { id: `demo-${hash}`, storage: "demo", sha256: hash, bytes: blob.size, width: bitmap.width, height: bitmap.height, mime: "image/png" }; }
    finally { bitmap.close(); }
    assertEvidenceCapacity([{ ...evidence, image: "", asset }]);
    await record("originals", "readwrite", s => s.put(blob, asset.id));
  } else {
    const release = await transferSlot(signal);
    try {
      const endpoint = `/api/closed-trades/${encodeURIComponent(tradeId)}/evidence`;
      type Upload = { id: string; url?: string; headers?: Record<string, string>; asset?: ImageAssetReference; uploaded?: boolean; expired?: boolean; state?: string };
      let upload: Upload | undefined;
      if (pending.uploadId) {
        try { upload = await request<Upload>(`${endpoint}?upload=${encodeURIComponent(pending.uploadId)}`, signal); }
        catch (error) { if (!(error instanceof ImageRequestError) || ![404, 410].includes(error.status)) throw error; }
        if (!upload || upload.expired || upload.state === "cancelled") {
          pending.uploadId = undefined; pending.clientKey = crypto.randomUUID(); upload = undefined;
          await record("pending", "readwrite", s => s.put(pending));
        }
      }
      if (!upload?.asset && !upload?.uploaded) {
        upload = await request<Upload>(endpoint, signal, { action: "create", clientKey: pending.clientKey, bytes: blob.size });
        pending.uploadId = upload.id; await record("pending", "readwrite", s => s.put(pending));
        if (!upload.asset && upload.url) {
          const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: blob, signal, credentials: "omit" });
          // 412 means a previous uncertain PUT already completed. Finalization verifies it.
          if (!response.ok && response.status !== 412) throw new Error("Image upload failed. Retry this image; your local original is preserved.");
        }
      }
      asset = upload?.asset ?? (await request<{ asset: ImageAssetReference }>(endpoint, signal, { action: "finalize", id: upload!.id })).asset;
      if (asset.sha256 !== hash || asset.bytes !== blob.size) throw new Error("Storage verification returned a different image. Nothing was attached.");
    } finally { release(); }
  }
  signal?.throwIfAborted();
  return { ...evidence, image: "", asset };
}

/** This returns a new document. It must be saved using the original revision/CAS token. */
export async function externalizeEvidence(tradeId: string, mode: "demo" | "application", doc: TradeDocument, signal?: AbortSignal) {
  const evidence = [];
  for (const image of doc.evidence) evidence.push(await storeEvidence(tradeId, mode, image, signal));
  return { ...doc, evidenceProtocol: EVIDENCE_PROTOCOL, evidence };
}
export async function resumePendingImage(pending: PendingImage, signal?: AbortSignal) {
  const image = await blobDataUrl(pending.blob);
  return storeEvidence(pending.tradeId, pending.mode, { ...pending.evidence, image }, signal, pending.section);
}
export async function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Image read failed.")); reader.readAsDataURL(blob); });
}

const cache = new Map<string, { blob: Blob; touched: number }>();
let cacheGeneration = 0;
export function clearEvidenceCache() { cache.clear(); cacheGeneration++; }
export async function evidenceBlob(tradeId: string, evidence: Evidence, variant: "thumbnail" | "original" = "original", signal?: AbortSignal) {
  if (!evidence.asset) return inlinePngBlob(evidence.image);
  const asset = evidence.asset, key = `${tradeId}:${asset.id}:${variant}`, cached = cache.get(key);
  if (cached) { cached.touched = Date.now(); return cached.blob; }
  const generation = cacheGeneration;
  let blob: Blob;
  if (asset.storage === "demo") {
    blob = await record("originals", "readonly", s => s.get(asset.id));
    if (!blob) throw new Error("The demo original is missing from this browser's image storage.");
  } else {
    const { url } = await request<{ url: string }>(`/api/closed-trades/${encodeURIComponent(tradeId)}/evidence?${new URLSearchParams({ asset: asset.id, variant })}`, signal);
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok) throw new Error("Could not retrieve this private image. Retry to renew its access link.");
    blob = await response.blob();
  }
  signal?.throwIfAborted();
  if (variant === "original" && (blob.size !== asset.bytes || await sha256(await blob.arrayBuffer()) !== asset.sha256)) throw new Error("The original image checksum does not match. Download stopped.");
  if (generation !== cacheGeneration) throw new Error("The image session changed. Sign in again.");
  cache.set(key, { blob, touched: Date.now() });
  let size = [...cache.values()].reduce((sum, c) => sum + c.blob.size, 0);
  for (const [id, item] of [...cache.entries()].sort((a, b) => a[1].touched - b[1].touched)) {
    if (size <= 100_000_000 && cache.size <= 64) break;
    cache.delete(id); size -= item.blob.size;
  }
  return blob;
}
/** Export-only copy: never hand downloaded bytes to the save coordinator. */
export async function hydrateEvidenceForExport(tradeId: string, doc: TradeDocument, signal?: AbortSignal) {
  const copy = structuredClone(doc);
  for (const e of copy.evidence) if (e.asset) e.image = await blobDataUrl(await evidenceBlob(tradeId, e, "original", signal));
  return copy;
}
