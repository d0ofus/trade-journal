import type { UTCTimestamp } from "lightweight-charts";
import { inferBarIntervalSeconds } from "@/lib/charts/execution-marker-alignment";

export type ChartSeriesCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type PreparedChartSeriesData = {
  candles: Array<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  validCandles: ChartSeriesCandle[];
  volume: Array<{
    time: UTCTimestamp;
    value: number;
    color: string;
  }>;
  sma: Array<{
    period: number;
    points: Array<{ time: UTCTimestamp; value: number }>;
  }>;
  candleTimeIndex: Map<number, number>;
  intervalSeconds: number | null;
  priceMin: number | null;
  priceMax: number | null;
};

function isValidCandle(candle: ChartSeriesCandle) {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite);
}

export function prepareChartSeriesData(input: ChartSeriesCandle[], smaPeriods: readonly number[]): PreparedChartSeriesData {
  const validCandles = input.filter(isValidCandle);
  const candles: PreparedChartSeriesData["candles"] = [];
  const volume: PreparedChartSeriesData["volume"] = [];
  const sma = smaPeriods.map((period) => ({ period, points: [] as Array<{ time: UTCTimestamp; value: number }> }));
  const smaSums = smaPeriods.map(() => 0);
  const candleTimeIndex = new Map<number, number>();
  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < validCandles.length; index += 1) {
    const candle = validCandles[index];
    const timestamp = candle.time as UTCTimestamp;
    const previous = validCandles[index - 1];
    const positive = previous ? candle.close >= previous.close : candle.close >= candle.open;

    candles.push({
      time: timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
    volume.push({
      time: timestamp,
      value: candle.volume ?? 0,
      color: positive ? "rgba(16, 185, 129, 0.42)" : "rgba(239, 68, 68, 0.38)",
    });
    candleTimeIndex.set(candle.time, index);
    priceMin = Math.min(priceMin, candle.open, candle.high, candle.low, candle.close);
    priceMax = Math.max(priceMax, candle.open, candle.high, candle.low, candle.close);

    for (let periodIndex = 0; periodIndex < smaPeriods.length; periodIndex += 1) {
      const period = smaPeriods[periodIndex];
      smaSums[periodIndex] += candle.close;
      if (index >= period) smaSums[periodIndex] -= validCandles[index - period].close;
      if (index >= period - 1) {
        sma[periodIndex].points.push({
          time: timestamp,
          value: smaSums[periodIndex] / period,
        });
      }
    }
  }

  return {
    candles,
    validCandles,
    volume,
    sma,
    candleTimeIndex,
    intervalSeconds: validCandles.length > 1 ? inferBarIntervalSeconds(validCandles) : null,
    priceMin: Number.isFinite(priceMin) ? priceMin : null,
    priceMax: Number.isFinite(priceMax) ? priceMax : null,
  };
}
