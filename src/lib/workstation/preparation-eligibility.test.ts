import { expect, it } from "vitest";
import { isOptionTrade } from "./preparation-eligibility";
it("recognizes classified and legacy option contracts while retaining OTHER stocks", () => {
  expect(isOptionTrade({ symbol: "CUSTOM", assetType: "OPTION" })).toBe(true);
  expect(isOptionTrade({ symbol: "ZS    250516C00250000", assetType: "OTHER" })).toBe(true);
  expect(isOptionTrade({ symbol: "AAPL250919P00200000" })).toBe(true);
  expect(isOptionTrade({ symbol: "MU", assetType: "OTHER" })).toBe(false);
  expect(isOptionTrade({ symbol: "AAPL251332C00200000" })).toBe(false);
});
