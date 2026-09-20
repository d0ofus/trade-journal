import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { demoTrades } from "./demo";
import { emptyDocument, type Evidence } from "./types";
import { reviewSections } from "./notion-template";
import { assignSectionEvidence, attachEvidence, earlierTimestampBasis, removeEvidence, sameEvidenceAssignments, sectionEvidenceIds } from "./evidence";
import { workstationDocumentSchema } from "./schema";
import { notionPageArchive } from "./notion-import";
import { reviewArchive } from "./export";
import { newestTradesFirst } from "./trade-order";
import { peerCandleQuerySchema, peerEntryTime, peerMembers, peerSymbolIssue, peerVirtualWindow, peerWarmupRange, selectPeerGroup, type PeerCandleQuery, type PeerGroup, type PeerSeries } from "./peers";
import { PeerMemory, type PeerFetcher } from "./peer-memory";

const query: PeerCandleQuery = { symbols: ["AAA"], timeframe: "1d", session: "regular", adjustment: "split", from: 100, to: 110 };
const group = (id: string, priority = 1, isActive = true): PeerGroup => ({ id, name: id, priority, isActive, members: [] });
const rows: PeerFetcher = async q => ({ series: q.symbols.map(symbol => ({ symbol, source: "test", identity: "test", adjustment: q.adjustment, feed: "sip", status: "ready", range: q, candles: Array.from({ length: q.to - q.from }, (_, i) => ({ time: q.from + i, open: 1, close: 1, high: 1, low: 1, volume: 1 })) })) });
const signal = () => new AbortController().signal;
describe("peer selection and dates", () => {
  it("preserves active choices; otherwise selects priority then alphabetical, with explicit deletion", () => {
    const groups = [group("Zulu", 5), group("Alpha", 5), group("Inactive", 99, false), group("Low", 1)];
    expect(selectPeerGroup(groups).selected?.id).toBe("Alpha");
    expect(selectPeerGroup(groups, "Low").selected?.id).toBe("Low");
    expect(selectPeerGroup(groups, "Deleted")).toMatchObject({ changed: true, selected: { id: "Alpha" } });
    expect(selectPeerGroup([]).selected).toBeUndefined();
  });
  it("normalizes, deduplicates and sorts members, preserving exchange and excluding the primary", () => {
    const g = { ...group("group"), members: [{ ticker: "zzz", exchange: "NYSE" }, { ticker: "BRK.B", exchange: "NYSE" }, { ticker: " AAPL " }, { ticker: "ZZZ", exchange: "NYSE" }] };
    expect(peerMembers(g, "aapl").map(m => m.ticker)).toEqual(["BRK.B", "ZZZ"]);
    expect(peerMembers(g, "AAPL", "brk")[0].exchange).toBe("NYSE");
    expect(peerSymbolIssue({ ticker: "BRK.B", exchange: "NYSE" })).toBeNull();
    expect(peerSymbolIssue({ ticker: "VOD", exchange: "LSE" })).toContain("No substitute");
    expect(peerCandleQuerySchema.safeParse({ ...query, symbols: ["NASDAQ:AAPL"] }).success).toBe(false);
    expect(peerCandleQuerySchema.safeParse({ ...query, symbols: Array(9).fill("AAA") }).success).toBe(false);
  });
  it("bounds virtual mounts across 50 peers, including the final row and a single-column screen", () => {
    for (const top of [0, 340, 2500, 7500]) { const v = peerVirtualWindow(50, 2, top, 680); expect(v.end - v.start).toBeLessThanOrEqual(8); }
    expect(peerVirtualWindow(50, 1, 16000, 680).end).toBe(50);
  });
  it("uses verified execution time and adds warm-up without mutating the requested viewport", () => {
    expect(peerEntryTime(demoTrades[0])).not.toBeNull();
    expect(peerEntryTime({ ...demoTrades[0], executions: demoTrades[0].executions.map(e => ({ ...e, provenance: undefined })) })).toBeNull();
    const view = { interval: "1h" as const, session: "regular" as const, adjustment: "split" as const, beforeEntry: false, range: { from: 1700000000, to: 1700100000 } };
    expect(peerWarmupRange(view, 200).from).toBeLessThan(view.range.from - 30 * 86400);
    expect(view.range.from).toBe(1700000000);
  });
  it("orders interpreted opening instants, not closing dates, with stable ID ties and stale trades retained", () => {
    const trades = [ { ...demoTrades[0], id: "B", openTime: 20, closeTime: 999 }, { ...demoTrades[0], id: "A", openTime: 20, stale: true }, { ...demoTrades[0], id: "C", openTime: 30 } ];
    expect(newestTradesFirst(trades).map(t => t.id)).toEqual(["C", "A", "B"]);
    expect(trades[0].id).toBe("B");
  });
});
describe("transient peer memory", () => {
  it("batches at eight symbols and permits only two in-flight requests", async () => {
    let active = 0, peak = 0; const sizes: number[] = [];
    const memory = new PeerMemory(async (q, s) => { sizes.push(q.symbols.length); peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 4)); active--; return rows(q, s); });
    const result = await memory.load({ ...query, symbols: Array.from({ length: 50 }, (_, i) => `P${i}`) }, signal());
    expect(result).toHaveLength(50); expect(peak).toBe(2); expect(Math.max(...sizes)).toBe(8); expect(sizes).toHaveLength(7);
  });
  it("deduplicates concurrent overlapping requests and fetches only the uncovered gap", async () => {
    const calls: PeerCandleQuery[] = [];
    const memory = new PeerMemory(async (q, s) => { calls.push(q); await new Promise(r => setTimeout(r, 4)); return rows(q, s); });
    const [first, second] = await Promise.all([memory.load(query, signal()), memory.load({ ...query, from: 105, to: 115 }, signal())]);
    expect(first[0].candles).toHaveLength(10); expect(second[0].candles).toHaveLength(10);
    expect(calls.map(q => [q.from, q.to])).toEqual([[100, 110], [110, 115]]);
    await memory.load({ ...query, from: 102, to: 109 }, signal()); expect(calls).toHaveLength(2);
  });
  it("evicts LRU bars, separates sessions/bases and expires entries", async () => {
    let now = 0; const memory = new PeerMemory(rows, 20, () => now);
    await memory.load(query, signal()); await memory.load({ ...query, symbols: ["BBB"] }, signal()); memory.get(query, "AAA");
    await memory.load({ ...query, symbols: ["CCC"] }, signal());
    expect(memory.get(query, "BBB")).toBeUndefined(); expect(memory.get(query, "AAA")).toBeDefined();
    expect(memory.get({ ...query, adjustment: "raw" }, "AAA")).toBeUndefined();
    expect(memory.get({ ...query, session: "extended" }, "AAA")).toBeUndefined();
    now = 300001; expect(memory.get(query, "AAA")).toBeUndefined();
  });
  it("cancels obsolete batches without stranding later queued requests", async () => {
    const memory = new PeerMemory(async (q, s) => { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 10); s.addEventListener("abort", () => { clearTimeout(timer); reject(s.reason); }, { once: true }); }); s.throwIfAborted(); return rows(q, s); });
    const controller = new AbortController();
    const obsolete = memory.load({ ...query, symbols: Array.from({ length: 32 }, (_, i) => `P${i}`) }, controller.signal);
    const rejection = expect(obsolete).rejects.toBeDefined(); controller.abort(); await rejection;
    expect(await memory.load(query, signal())).toHaveLength(1);
  });
  it("does not cache errors or turn unavailable series into a feed fallback", async () => {
    const memory = new PeerMemory(async q => ({ series: [{ symbol: "AAA", candles: [], range: q, status: "error", error: "Rate limited", retryAfter: 60, source: "Alpaca SIP", identity: "sip", adjustment: "split", feed: "sip" } satisfies PeerSeries] }));
    expect((await memory.load(query, signal()))[0].retryAfter).toBe(60); expect(memory.get(query, "AAA")).toBeUndefined();
  });
  it("retains ready history when a subsequently fetched weekend gap is empty", async () => {
    const memory = new PeerMemory(async (q, s) => q.from < 110 ? rows(q, s) : ({ series: [{ symbol: "AAA", candles: [], status: "empty", range: q, identity: "test", source: "test", adjustment: "split", feed: "sip" }] }));
    await memory.load(query, signal());
    expect((await memory.load({ ...query, to: 115 }, signal()))[0]).toMatchObject({ status: "ready", candles: expect.arrayContaining([expect.objectContaining({ time: 109 })]) });
  });
});
describe("section attachments and stable exports", () => {
  const evidence: Evidence = { id: "image", name: "Peer comparison", image: "data:image/png;base64,aGVsbG8=", time: 1, revision: 0, timeframe: "1d", peerCapture: { source: "peer-comparison", symbols: ["AAPL", "MSFT"], groupId: "g", groupName: "Original group", interval: "1d", session: "regular", adjustment: "split", ranges: { AAPL: { from: 1, to: 2 }, MSFT: { from: 1, to: 2 } }, capturedAt: "2026-09-18T00:00:00.000Z", beforeEntry: false, entryTime: 1 } };
  it("keeps schema 1 and legacy text; supports every destination, reuse, detachment and complete deletion", () => {
    let doc = attachEvidence(emptyDocument(), evidence, "peers"); doc.review.setup = "Legacy text";
    for (const [key] of reviewSections) doc.review.notion = assignSectionEvidence(doc.review.notion!, key, evidence.id, true);
    const parsed = workstationDocumentSchema.parse(doc);
    expect(parsed.schema).toBe(1); expect(parsed.review.setup).toBe("Legacy text"); expect(parsed.evidence).toHaveLength(1);
    for (const [key] of reviewSections) expect(sectionEvidenceIds(parsed.review.notion, key)).toEqual(["image"]);
    doc.review.notion = assignSectionEvidence(doc.review.notion!, "takeaways", "image", false);
    expect(sectionEvidenceIds(doc.review.notion, "takeaways")).toEqual([]); expect(sectionEvidenceIds(doc.review.notion, "peers")).toEqual(["image"]);
    doc = removeEvidence(doc, "image"); for (const [key] of reviewSections) expect(sectionEvidenceIds(doc.review.notion, key)).toEqual([]);
    expect(workstationDocumentSchema.safeParse(emptyDocument()).success).toBe(true);
  });
  it("exports repeated headings by section ID while storing only one image asset", async () => {
    const doc = attachEvidence(emptyDocument(), evidence, "technicalPositive");
    for (const key of ["noteworthyPositive", "takeaways", "previousReview"] as const) doc.review.notion = assignSectionEvidence(doc.review.notion!, key, evidence.id, true);
    const notion = unzipSync(new Uint8Array(await notionPageArchive({ trade: demoTrades[0], doc, url: "" }).arrayBuffer()));
    expect(Object.keys(notion).filter(p => p.endsWith(".png"))).toHaveLength(1);
    expect(strFromU8(notion["review.html"]).match(/<img /g)).toHaveLength(4);
    const portable = unzipSync(new Uint8Array(await (await reviewArchive([{ trade: demoTrades[0], doc, url: "" }], [], {})).arrayBuffer()));
    expect(Object.keys(portable).filter(p => p.endsWith(".png"))).toHaveLength(1);
    const html = strFromU8(portable[Object.keys(portable).find(p => p.endsWith("review.html"))!]);
    expect(html.match(/<img /g)).toHaveLength(4);
    expect(html.slice(html.indexOf("− ve"), html.indexOf("Ideal Execution</h2>"))).not.toContain("<img");
    const json = JSON.parse(strFromU8(portable[Object.keys(portable).find(p => p.endsWith("review.json"))!]));
    expect(json.document.evidence[0].peerCapture.groupName).toBe("Original group"); expect(json.document.evidence[0].image).toBeUndefined();
  });
  it("enforces count and package limits before changing the document", () => {
    const doc = emptyDocument(); doc.evidence = Array(30).fill(evidence);
    expect(() => attachEvidence(doc, evidence, "peers")).toThrow("30 images");
    expect(() => attachEvidence(emptyDocument(), { ...evidence, image: `data:image/png;base64,${"A".repeat(4 * 1024 * 1024)}` }, "properties")).toThrow(/large|4 MB/i);
  });
  it("external image origins and multi-section assignments survive exports without invented chart metadata", async () => {
    for (const origin of ["upload", "clipboard"] as const) {
      const image = { ...evidence, peerCapture: undefined, origin, timeframe: "" };
      const doc = attachEvidence(emptyDocument(), image, "properties");
      const before = doc.review.notion;
      doc.review.notion = assignSectionEvidence(before!, "takeaways", image.id, true);
      expect(sameEvidenceAssignments(before, doc.review.notion)).toBe(false);
      expect(sameEvidenceAssignments(doc.review.notion, { ...doc.review.notion, analysis: { fundamentals: "Text only" } })).toBe(true);
      expect(earlierTimestampBasis(image, "changed-trade-time")).toBe(false);
      expect(workstationDocumentSchema.parse(doc).evidence[0].origin).toBe(origin);
      const args = { trade: demoTrades[0], doc, url: "" };
      const portable = unzipSync(new Uint8Array(await (await reviewArchive([args], [], {})).arrayBuffer()));
      const notion = unzipSync(new Uint8Array(await notionPageArchive(args).arrayBuffer()));
      for (const files of [portable, notion]) {
        expect(Object.keys(files).filter(p => p.endsWith(".png"))).toHaveLength(1);
        expect(strFromU8(files[Object.keys(files).find(p => p.endsWith("review.html"))!]).match(/<img /g)).toHaveLength(2);
      }
      const json = JSON.parse(strFromU8(portable[Object.keys(portable).find(p => p.endsWith("review.json"))!]));
      expect(json.document.evidence[0]).toMatchObject({ origin, timeframe: "", earlierTimestampBasis: false });
    }
  });
});
