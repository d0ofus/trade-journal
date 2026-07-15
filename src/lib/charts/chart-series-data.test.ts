import { prepareChartSeriesData, type ChartSeriesCandle } from "@/lib/charts/chart-series-data";

const baseTime = Math.floor(Date.parse("2026-06-17T14:30:00.000Z") / 1000);

function candle(index: number, close: number, volume = 100 + index): ChartSeriesCandle {
  return {
    time: baseTime + index * 300,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  };
}

describe("chart series data preparation", () => {
  it("filters invalid candles and prepares candle, volume, index, and price range data", () => {
    const prepared = prepareChartSeriesData(
      [
        candle(0, 100, 10),
        { ...candle(1, 101), high: Number.NaN },
        candle(2, 99, 12),
      ],
      [2],
    );

    expect(prepared.validCandles).toHaveLength(2);
    expect(prepared.candles).toEqual([
      { time: baseTime, open: 99.5, high: 101, low: 99, close: 100 },
      { time: baseTime + 600, open: 98.5, high: 100, low: 98, close: 99 },
    ]);
    expect(prepared.volume).toEqual([
      { time: baseTime, value: 10, color: "rgba(16, 185, 129, 0.42)" },
      { time: baseTime + 600, value: 12, color: "rgba(239, 68, 68, 0.38)" },
    ]);
    expect(prepared.candleTimeIndex.get(baseTime)).toBe(0);
    expect(prepared.candleTimeIndex.get(baseTime + 600)).toBe(1);
    expect(prepared.priceMin).toBe(98);
    expect(prepared.priceMax).toBe(101);
  });

  it("builds each SMA series in the same pass", () => {
    const prepared = prepareChartSeriesData([candle(0, 10), candle(1, 12), candle(2, 14), candle(3, 16)], [2, 3]);

    expect(prepared.sma).toEqual([
      {
        period: 2,
        points: [
          { time: baseTime + 300, value: 11 },
          { time: baseTime + 600, value: 13 },
          { time: baseTime + 900, value: 15 },
        ],
      },
      {
        period: 3,
        points: [
          { time: baseTime + 600, value: 12 },
          { time: baseTime + 900, value: 14 },
        ],
      },
    ]);
    expect(prepared.intervalSeconds).toBe(300);
  });
});
