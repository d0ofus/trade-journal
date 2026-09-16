import { describe, expect, it } from "vitest";
import { shareEligibility, metricIdentity, legacyShareDescription } from "./share-eligibility";
import { peakPositionCost } from "./peak-position-cost";
import { demoTrades } from "./demo";

describe("legacy share compatibility", () => {
  it.each([undefined, "OTHER", " other "])("admits legacy %s without rewriting it", assetType => {
    const trade = { ...demoTrades[0], symbol: "IE", assetType };
    expect(shareEligibility(trade)).toBe("legacy-shares");
    expect(peakPositionCost(trade)).toMatchObject({ value: 34840, basis: legacyShareDescription });
    expect(trade.assetType).toBe(assetType);
  });
  it.each(["OPTION", "FUTURE", "FOREX", "CRYPTO"])("rejects explicit %s", assetType => {
    expect(shareEligibility({ symbol: "IE", assetType })).toBeNull();
  });
  it("rejects legacy option symbols and distinguishes stock and ETF cache identities", () => {
    expect(shareEligibility({ symbol: "ZS    250516C00250000", assetType: "OTHER" })).toBeNull();
    expect(shareEligibility({ symbol: "BRK.B", assetType: "STOCK" })).toBe("stock");
    expect(metricIdentity({ ...demoTrades[0], assetType: "STOCK" })).not.toBe(metricIdentity({ ...demoTrades[0], assetType: "ETF" }));
  });
});
