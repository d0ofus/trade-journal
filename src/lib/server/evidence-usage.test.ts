import { describe, expect, it } from "vitest";
import { parseR2AccountMetrics } from "./evidence-usage";

const standard = { published: { payloadSize: 9_000_000_000, metadataSize: 100 }, uploaded: { payloadSize: 50, metadataSize: 1 } };
describe("account-wide R2 usage counters", () => {
  it("counts originals, metadata and pending objects across an entire account", () => {
    expect(parseR2AccountMetrics({ standard, infrequentAccess: standard })).toEqual({ standardBytes: 9_000_000_151, otherClassBytes: 9_000_000_151 });
  });
  it("does not turn absent, partial, invalid or negative readings into zero", () => {
    for (const value of [null, {}, { standard: {} }, { standard: { published: standard.published } }, { standard: { ...standard, uploaded: { payloadSize: -1, metadataSize: 0 } } }, { standard: { ...standard, uploaded: { payloadSize: "50", metadataSize: 0 } } }]) expect(parseR2AccountMetrics(value)).toBeNull();
    expect(parseR2AccountMetrics({ standard })).toEqual({ standardBytes: 9_000_000_151, otherClassBytes: null });
  });
  it("accepts explicit zero readings", () => {
    expect(parseR2AccountMetrics({ standard: { published: { payloadSize: 0, metadataSize: 0 }, uploaded: { payloadSize: 0, metadataSize: 0 } } })?.standardBytes).toBe(0);
  });
});
