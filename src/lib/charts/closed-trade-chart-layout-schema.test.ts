import { closedTradeChartLayoutPayloadSchema } from "@/lib/charts/closed-trade-chart-layout-schema";

const validLayout = {
  layoutMode: "three-horizontal",
  version: 1,
  panels: [
    {
      id: "panel-1",
      symbol: "demoa",
      timeframe: "5m",
      compareSymbol: "demob",
      rangePreset: "trade",
      visibleFrom: 1,
      visibleTo: 2,
    },
    {
      id: "panel-2",
      symbol: "DEMOA",
      timeframe: "1h",
      compareSymbol: null,
      rangePreset: "post",
    },
    {
      id: "panel-3",
      symbol: "DEMOA",
      timeframe: "1d",
      compareSymbol: null,
      rangePreset: "trade",
    },
  ],
};

describe("closedTradeChartLayoutPayloadSchema", () => {
  it("normalizes symbols and self-comparison while preserving client-supported values", () => {
    const parsed = closedTradeChartLayoutPayloadSchema.parse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], compareSymbol: "demoa" }, validLayout.panels[1], validLayout.panels[2]],
    });

    expect(parsed.panels[0]).toMatchObject({
      symbol: "DEMOA",
      timeframe: "5m",
      compareSymbol: null,
      rangePreset: "trade",
    });
  });

  it("rejects unsupported timeframes and range presets", () => {
    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], timeframe: "2h" }, validLayout.panels[1], validLayout.panels[2]],
    }).success).toBe(false);

    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], rangePreset: "forever" }, validLayout.panels[1], validLayout.panels[2]],
    }).success).toBe(false);
  });

  it("rejects invalid compare symbols and reversed visible ranges", () => {
    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], compareSymbol: "BAD SYMBOL" }, validLayout.panels[1], validLayout.panels[2]],
    }).success).toBe(false);

    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], visibleFrom: 10, visibleTo: 5 }, validLayout.panels[1], validLayout.panels[2]],
    }).success).toBe(false);
  });

  it("rejects layout panel-count mismatches, duplicate ids, and half-saved ranges", () => {
    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      layoutMode: "single",
    }).success).toBe(false);

    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0] }, { ...validLayout.panels[1], id: "panel-1" }, validLayout.panels[2]],
    }).success).toBe(false);

    expect(closedTradeChartLayoutPayloadSchema.safeParse({
      ...validLayout,
      panels: [{ ...validLayout.panels[0], visibleFrom: 10, visibleTo: null }, validLayout.panels[1], validLayout.panels[2]],
    }).success).toBe(false);
  });
});
