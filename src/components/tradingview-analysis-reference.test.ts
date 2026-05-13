import { describe, expect, it } from "vitest";
import { tradingViewWidgetConfig } from "@/components/tradingview-analysis-reference";

describe("TradingView analysis reference config", () => {
  it("maps journal symbols and timeframes to the public widget config", () => {
    const config = tradingViewWidgetConfig("nvda", "1H");

    expect(config.symbol).toBe("NASDAQ:NVDA");
    expect(config.interval).toBe("60");
    expect(config.hide_side_toolbar).toBe(false);
    expect(config.hide_top_toolbar).toBe(false);
    expect(config.save_image).toBe(true);
  });

  it("preserves explicit TradingView exchange prefixes", () => {
    const config = tradingViewWidgetConfig("NYSE:SPY", "1W");

    expect(config.symbol).toBe("NYSE:SPY");
    expect(config.interval).toBe("W");
  });
});
