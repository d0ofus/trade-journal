import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { workstationEvidenceManifest } from "./workstation-backup";
describe("workstation attachment backups", () => {
  it("checks inline images in review JSON without duplicating image data", () => {
    const image = "data:image/png;base64,AQIDBA==";
    const result = workstationEvidenceManifest([{ groupKey: "trade", workstationJson: JSON.stringify({ evidence: [{ id: "image", image }] }) }]);
    expect(result.invalid).toEqual([]);
    expect(result.entries).toEqual([{ groupKey: "trade", index: 0, id: "image", bytes: 4, sha256: createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex") }]);
    expect(JSON.stringify(result)).not.toContain(image);
  });
  it("identifies damaged images and JSON while preserving legacy journal-only content", () => {
    expect(workstationEvidenceManifest([{ groupKey: "broken", workstationJson: "{" }]).invalid).toEqual(["broken"]);
    expect(workstationEvidenceManifest([{ groupKey: "image", workstationJson: JSON.stringify({ evidence: [{ image: "data:image/png;base64,!broken" }] }) }]).invalid).toEqual(["image:0"]);
    expect(workstationEvidenceManifest([{ groupKey: "legacy", workstationJson: JSON.stringify({ review: { setup: "Historical review" } }) }])).toEqual({ entries: [], invalid: [] });
  });
});
