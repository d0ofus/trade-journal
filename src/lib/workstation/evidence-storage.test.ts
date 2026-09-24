import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { clearDemoImages, clearEvidenceCache, discardPendingEvidence, evidenceBlob, externalizeEvidence, pendingEvidence, resumePendingImage, storeEvidence } from "./evidence-storage";
import { emptyDocument, type Evidence } from "./types";

const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4RYAAAAASUVORK5CYII=", "base64");
const image = (id: string): Evidence => ({ id, name: `${id}.png`, image: `data:image/png;base64,${original.toString("base64")}`, time: 1, timeframe: "1d", revision: 0 });
const asset = { id: "private-asset", storage: "r2" as const, sha256: createHash("sha256").update(original).digest("hex"), bytes: original.length, width: 1, height: 1, mime: "image/png" as const };
const realFetch = globalThis.fetch;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  clearEvidenceCache(); vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close() {} })));
  vi.stubGlobal("FileReader", class {
    result = ""; onload?: () => void; onerror?: () => void;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }).catch(() => this.onerror?.()); }
  });
});
afterEach(() => { clearEvidenceCache(); vi.unstubAllGlobals(); });
describe("private image client storage", () => {
  it("moves demo originals into IndexedDB without changing bytes or the source document", async () => {
    const doc = { ...emptyDocument(), evidence: [image("one"), image("two")] };
    const saved = await externalizeEvidence("demo-trade", "demo", doc);
    expect(saved.evidenceProtocol).toBe(2); expect(saved.evidence.map(e => e.image)).toEqual(["", ""]);
    expect(saved.evidence[0].asset?.id).toBe(saved.evidence[1].asset?.id);
    expect(Buffer.from(await (await evidenceBlob("demo-trade", saved.evidence[0])).arrayBuffer())).toEqual(original);
    expect(doc.evidence[0].image).toContain("data:image/png");
  });
  it("retains section context in pending recovery and keeps bytes out of metadata", async () => {
    const stored = await storeEvidence("demo-trade", "demo", image("recover"), undefined, "takeaways");
    const [pending] = await pendingEvidence("demo-trade", "demo");
    expect(pending.section).toBe("takeaways"); expect(pending.evidence.image).toBe("");
    expect((await resumePendingImage(pending)).asset).toEqual(stored.asset);
    expect((await pendingEvidence("another-trade", "demo"))).toEqual([]);
    await discardPendingEvidence(pending); expect(await pendingEvidence("demo-trade", "demo")).toEqual([]);
  });
  it("clears demo images without deleting application recovery records", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("data:") ? realFetch(url) : Promise.resolve(json({ error: "offline" }, 503))));
    await storeEvidence("demo-trade", "demo", image("demo"));
    await expect(storeEvidence("real-trade", "application", image("private"))).rejects.toThrow("offline");
    await clearDemoImages();
    expect(await pendingEvidence("demo-trade", "demo")).toEqual([]);
    expect(await pendingEvidence("real-trade", "application")).toHaveLength(1);
  });
  it("reconciles a lost PUT response instead of transferring the original twice", async () => {
    let uploaded = false, puts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("data:")) return realFetch(url);
      if (url === "https://objects.invalid/pending") { puts++; uploaded = true; return new Response("lost response", { status: 503 }); }
      if (url.includes("?upload=")) return json({ id: "upload", uploaded });
      const action = JSON.parse(String(init?.body));
      if (action.action === "create") return json({ id: "upload", url: "https://objects.invalid/pending" });
      return json({ asset });
    }));
    await expect(storeEvidence("trade", "application", image("one"))).rejects.toThrow(/local original is preserved/);
    expect((await storeEvidence("trade", "application", image("one"))).asset).toEqual(asset); expect(puts).toBe(1);
  });
  it("does not attach mismatching finalized bytes or silently save inline when storage fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("data:") ? realFetch(url) : json({ id: "upload", asset: { ...asset, sha256: "0".repeat(64) } })));
    await expect(storeEvidence("trade", "application", image("one"))).rejects.toThrow(/different image/);
    const pending = await pendingEvidence("trade", "application"); expect(pending).toHaveLength(1); expect(pending[0].evidence.image).toBe(""); expect(pending[0].blob.size).toBe(original.length);
  });
  it("limits uploads to two concurrent transfers and keeps signed URLs out of evidence", async () => {
    let active = 0, maximum = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("data:")) return realFetch(url);
      if (url === "https://objects.invalid/pending") { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 20)); active--; return new Response(null, { status: 200 }); }
      const action = JSON.parse(String(init?.body));
      return json(action.action === "create" ? { id: action.clientKey, url: "https://objects.invalid/pending" } : { asset });
    }));
    const saved = await Promise.all(["one", "two", "three", "four"].map(id => storeEvidence("trade", "application", image(id))));
    expect(maximum).toBe(2); expect(saved.every(e => e.image === "" && e.asset?.id === asset.id)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("objects.invalid");
  });
  it("renews expired recovery sessions without reusing a cancelled upload identifier", async () => {
    let expired = false; const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("data:")) return realFetch(url);
      if (url.includes("?upload=")) return json({ id: "old", expired: true });
      if (url === "https://objects.invalid/pending") return new Response(null, { status: expired ? 200 : 503 });
      const action = JSON.parse(String(init?.body));
      if (action.action === "create") { keys.push(action.clientKey); return json({ id: "old", url: "https://objects.invalid/pending" }); }
      return json({ asset });
    }));
    await expect(storeEvidence("trade", "application", image("one"))).rejects.toThrow(); expired = true;
    await storeEvidence("trade", "application", image("one")); expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1]);
  });
  it("verifies original retrieval and evicts private cache on sign-out", async () => {
    const fetcher = vi.fn(async (url: string) => url.startsWith("/api/") ? json({ url: "https://objects.invalid/original" }) : new Response(original)); vi.stubGlobal("fetch", fetcher);
    const evidence = { ...image("one"), image: "", asset };
    await evidenceBlob("trade", evidence); await evidenceBlob("trade", evidence); expect(fetcher).toHaveBeenCalledTimes(2);
    clearEvidenceCache(); await evidenceBlob("trade", evidence); expect(fetcher).toHaveBeenCalledTimes(4);
    clearEvidenceCache(); fetcher.mockImplementation(async url => url.startsWith("/api/") ? json({ url: "https://objects.invalid/original" }) : new Response("corrupt"));
    await expect(evidenceBlob("trade", evidence)).rejects.toThrow(/checksum/);
  });
  it("aborts before upload on trade navigation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(storeEvidence("old-trade", "application", image("one"), controller.signal)).rejects.toThrow();
    expect(await pendingEvidence("new-trade", "application")).toEqual([]);
  });
});
