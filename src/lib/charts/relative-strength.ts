import { inferBarIntervalSeconds, type AlignmentCandle } from "@/lib/charts/execution-marker-alignment";

export type RelativeStrengthCandle = AlignmentCandle;
export type TradeDirection = "LONG" | "SHORT";

export type RelativeStrengthMetrics = {
  tickerMovePct: number | null;
  benchmarkMovePct: number | null;
  relativeSpreadPct: number | null;
  directionAdjustedSpreadPct: number | null;
  benchmarkStartTime: number | null;
  benchmarkEndTime: number | null;
};

export function percentageChange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) {
    return null;
  }

  return ((end - start) / start) * 100;
}

function toUnixSeconds(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function barEndTime(candles: RelativeStrengthCandle[], index: number, intervalSeconds: number) {
  const current = candles[index];
  const next = candles[index + 1];
  const fallbackEnd = current.time + intervalSeconds;

  if (!next || next.time <= current.time) {
    return fallbackEnd;
  }

  return Math.min(fallbackEnd, next.time);
}

function candleIndexForTimestamp(targetTs: number, candles: RelativeStrengthCandle[]) {
  if (candles.length === 0) return null;

  const intervalSeconds = inferBarIntervalSeconds(candles);
  const firstStart = candles[0].time;
  const lastEnd = barEndTime(candles, candles.length - 1, intervalSeconds);

  if (targetTs < firstStart || targetTs >= lastEnd) {
    return null;
  }

  let left = 0;
  let right = candles.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const barTime = candles[mid].time;

    if (barTime === targetTs) {
      return mid;
    }

    if (barTime < targetTs) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (right < 0) {
    return null;
  }

  return targetTs < barEndTime(candles, right, intervalSeconds) ? right : null;
}

export function matchCandlesByTime(
  tickerCandles: RelativeStrengthCandle[],
  benchmarkCandles: RelativeStrengthCandle[],
) {
  const benchmarkByTime = new Map(benchmarkCandles.map((candle) => [candle.time, candle]));

  return tickerCandles.flatMap((ticker) => {
    const benchmark = benchmarkByTime.get(ticker.time);
    return benchmark ? [{ time: ticker.time, ticker, benchmark }] : [];
  });
}

export function candleMoveForWindow(input: {
  candles: RelativeStrengthCandle[];
  openTime: string;
  closeTime: string;
}) {
  const openTs = toUnixSeconds(input.openTime);
  const closeTs = toUnixSeconds(input.closeTime);
  if (openTs === null || closeTs === null || input.candles.length === 0) {
    return { movePct: null, startTime: null, endTime: null };
  }

  const sortedCandles = [...input.candles].sort((a, b) => a.time - b.time);
  const startIndex = candleIndexForTimestamp(Math.min(openTs, closeTs), sortedCandles);
  const endIndex = candleIndexForTimestamp(Math.max(openTs, closeTs), sortedCandles);
  if (startIndex === null || endIndex === null) {
    return { movePct: null, startTime: null, endTime: null };
  }

  const startCandle = sortedCandles[startIndex];
  const endCandle = sortedCandles[endIndex];
  const startPrice = startIndex === endIndex ? startCandle.open : startCandle.close;
  const movePct = percentageChange(startPrice, endCandle.close);

  return {
    movePct,
    startTime: startCandle.time,
    endTime: endCandle.time,
  };
}

export function computeRelativeStrengthMetrics(input: {
  avgEntryPrice: number;
  avgExitPrice: number;
  direction: TradeDirection;
  openTime: string;
  closeTime: string;
  benchmarkCandles: RelativeStrengthCandle[];
}): RelativeStrengthMetrics {
  const tickerMovePct = percentageChange(input.avgEntryPrice, input.avgExitPrice);
  const benchmarkWindow = candleMoveForWindow({
    candles: input.benchmarkCandles,
    openTime: input.openTime,
    closeTime: input.closeTime,
  });
  const benchmarkMovePct = benchmarkWindow.movePct;
  const relativeSpreadPct =
    tickerMovePct === null || benchmarkMovePct === null ? null : tickerMovePct - benchmarkMovePct;
  const directionAdjustedSpreadPct =
    relativeSpreadPct === null ? null : input.direction === "SHORT" ? -relativeSpreadPct : relativeSpreadPct;

  return {
    tickerMovePct,
    benchmarkMovePct,
    relativeSpreadPct,
    directionAdjustedSpreadPct,
    benchmarkStartTime: benchmarkWindow.startTime,
    benchmarkEndTime: benchmarkWindow.endTime,
  };
}
