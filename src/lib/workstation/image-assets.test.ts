import { describe, expect, it } from "vitest";
import { assertEvidenceCapacity, evidenceUsage, IMAGE_MAX_BYTES, REVIEW_IMAGE_MAX_BYTES, type ImageAssetReference } from "./image-assets";
import { workstationDocumentSchema } from "./schema";
import { emptyDocument, type Evidence } from "./types";
import { arrangePeers, movePeer } from "./peer-arrangement";

const asset = (id = "asset-a", bytes = 10_000_000): ImageAssetReference => ({ id, storage: "r2", sha256: id === "asset-a" ? "a".repeat(64) : id === "asset-b" ? "b".repeat(64) : "c".repeat(64), bytes, width: 1920, height: 1080, mime: "image/png" });
const image = (id: string, reference = asset()): Evidence => ({ id, image: "", asset: reference, name: id, time: 1, timeframe: "1d", revision: 1 });
describe("private evidence metadata and quotas", () => {
  it("accepts image references in schema 1 without inline bytes", () => {
    const document = { ...emptyDocument(), evidenceProtocol: 2, evidence: [image("one")], comparison: { drawings: {}, arrangements: { group: { order: ["A", "B"], hidden: ["B"] } } } };
    expect(workstationDocumentSchema.parse(document)).toEqual(document);
    expect(JSON.stringify(document).length).toBeLessThan(2000);
  });
  it("rejects mixed inline/reference payloads and untrusted image metadata", () => {
    for (const invalid of [{ ...image("one"), image: "data:image/png;base64,AAAA" }, image("one", { ...asset(), sha256: "invalid" }), image("one", { ...asset(), width: 4001, height: 4000 }), image("one", { ...asset(), bytes: IMAGE_MAX_BYTES + 1 })]) expect(workstationDocumentSchema.safeParse({ ...emptyDocument(), evidence: [invalid] }).success).toBe(false);
  });
  it("retains legacy inline readers", () => expect(workstationDocumentSchema.safeParse({ ...emptyDocument(), evidence: [{ ...image("old"), asset: undefined, image: "data:image/png;base64,aGVsbG8=" }] }).success).toBe(true));
  it("counts unique original bytes rather than evidence assignments/metadata", () => {
    const repeated = [image("one"), image("two"), image("three", asset("asset-b"))];
    expect(evidenceUsage(repeated)).toMatchObject({ count: 3, bytes: 20_000_000, remainingBytes: 30_000_000 });
    expect(() => assertEvidenceCapacity(repeated)).not.toThrow();
  });
  it("allows exactly 50 MB and rejects one additional original byte", () => {
    const list = [image("one", asset("asset-a", 20_000_000)), image("two", asset("asset-b", 20_000_000)), image("three", asset("asset-c", 10_000_000))];
    expect(evidenceUsage(list).bytes).toBe(REVIEW_IMAGE_MAX_BYTES); assertEvidenceCapacity(list);
    list[2].asset!.bytes++; expect(() => assertEvidenceCapacity(list)).toThrow(/50,000,000/);
  });
  it("allows 20 MB individual images and 30 reused evidence records", () => {
    assertEvidenceCapacity([image("one", asset("asset-a", IMAGE_MAX_BYTES))]);
    const repeated = Array.from({ length: 30 }, (_, i) => image(String(i))); assertEvidenceCapacity(repeated);
    expect(() => assertEvidenceCapacity([...repeated, image("31")])).toThrow(/30 images/);
    expect(() => assertEvidenceCapacity([image("same"), image("same")])).toThrow(/unique/);
  });
  it("warns at eighty percent without stopping uploads", () => expect(evidenceUsage([image("one", asset("asset-a", 20_000_000)), image("two", asset("asset-b", 20_000_000))]).warning).toBe(true));
});
describe("saved peer arrangements", () => {
  const members = ["AAA", "BBB", "CCC", "DDD"].map(ticker => ({ ticker }));
  it("retains order, compacts hidden slots and appends new memberships alphabetically", () => expect(arrangePeers(members, { order: ["CCC", "REMOVED", "AAA"], hidden: ["AAA"] }).map(m => m.ticker)).toEqual(["CCC", "BBB", "DDD"]));
  it("searches without rewriting the saved arrangement", () => { const arrangement = { order: ["CCC", "AAA"], hidden: ["BBB"] }; expect(arrangePeers(members, arrangement, "AAA").map(m => m.ticker)).toEqual(["AAA"]); expect(arrangement.order).toEqual(["CCC", "AAA"]); });
  it("moves up/down without losing or duplicating memberships", () => { expect(movePeer(["A", "B", "C"], "A", "C")).toEqual(["B", "C", "A"]); expect(movePeer(["A", "B", "C"], "C", "A")).toEqual(["C", "A", "B"]); expect(movePeer(["A", "B"], "X", "B")).toEqual(["A", "B"]); });
});
