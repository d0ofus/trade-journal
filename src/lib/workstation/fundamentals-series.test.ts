import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FundamentalsProfile } from "@/components/workstation/fundamentals-profile";
import { emptyFundamentals, type FundamentalQuarter } from "./fundamentals";
import { allFundamentalsSeries, fundamentalsSeries, fundamentalsSeriesDomain, hasVisibleFundamentals, type FundamentalsSeriesVisibility } from "./fundamentals-series";

const quarter: FundamentalQuarter = { fiscalYear: 2026, fiscalQuarter: 1, periodEnd: "2026-03-31", revenue: { value: 1000, sources: [], derived: false }, netIncome: { value: -10, sources: [], derived: false }, revenueYoY: 200, revenueQoQ: 5, netIncomeYoY: -30, netIncomeQoQ: 10 };
const hidden = Object.fromEntries(fundamentalsSeries.map(s => [s, false])) as FundamentalsSeriesVisibility;

describe("fundamentals series visibility", () => {
  it("rescales visible bars and retains zero for positive and negative values", () => {
    expect(fundamentalsSeriesDomain([quarter], ["revenue", "netIncome"])).toEqual({ min: -131.2, max: 1121.2 });
    expect(fundamentalsSeriesDomain([quarter], ["revenue"])).toEqual({ min: 0, max: 1120 });
    expect(fundamentalsSeriesDomain([quarter], ["netIncome"])).toEqual({ min: -11.2, max: 1.2 });
  });
  it("scales growth axes independently and ignores hidden lines", () => {
    expect(fundamentalsSeriesDomain([quarter], ["revenueYoY", "revenueQoQ"])).toEqual({ min: 0, max: 224 });
    expect(fundamentalsSeriesDomain([quarter], ["revenueQoQ"])).toEqual({ min: 0, max: 5.6 });
    expect(fundamentalsSeriesDomain([quarter], ["netIncomeYoY", "netIncomeQoQ"])).toEqual({ min: -34.8, max: 14.8 });
  });
  it("distinguishes zero from missing/nonfinite values and hidden series", () => {
    const missing = { ...quarter, revenue: null, revenueYoY: null, revenueQoQ: NaN };
    expect(fundamentalsSeriesDomain([missing], ["revenue", "revenueYoY", "revenueQoQ"])).toBeNull();
    expect(fundamentalsSeriesDomain([quarter], [])).toBeNull();
    expect(hasVisibleFundamentals([quarter], hidden)).toBe(false);
    expect(hasVisibleFundamentals([missing], { ...hidden, revenue: true, revenueYoY: true, revenueQoQ: true })).toBe(false);
    const zero = { ...quarter, revenueYoY: 0 };
    expect(hasVisibleFundamentals([zero], { ...hidden, revenueYoY: true })).toBe(true);
    expect(fundamentalsSeriesDomain([zero], ["revenueYoY"])).toEqual({ min: 0, max: .12 });
  });
  it("renders distinct all-hidden and unavailable messages without misleading axes", () => {
    const data = { ...emptyFundamentals("TEST", "latest", null), quarters: [{ ...quarter, revenue: null }] };
    const markup = renderToStaticMarkup(createElement(FundamentalsProfile, { data, seriesVisibility: { ...hidden, revenue: true } }));
    expect(markup).toContain("No available data for selected metrics");
    expect(markup).toContain("Select a legend item to display data");
    expect(markup).not.toContain("data-fundamentals-axis");
    expect(markup).not.toMatch(/tabindex|role="button"|legend-hit/);
    expect(markup).toContain('text-decoration="line-through"');
  });
  it("legacy/default profiles retain all series and snapshots exclude interactive overlays", () => {
    const data = { ...emptyFundamentals("TEST", "latest", null), quarters: [quarter] };
    const markup = renderToStaticMarkup(createElement(FundamentalsProfile, { data }));
    for (const key of fundamentalsSeries) expect(markup).toContain(`data-fundamentals-series="${key}"`);
    expect(markup).not.toMatch(/legend-hit|hit-area|tabindex|fundamentals-highlight|role="tooltip"/);
    expect(hasVisibleFundamentals([quarter], allFundamentalsSeries)).toBe(true);
  });
});
