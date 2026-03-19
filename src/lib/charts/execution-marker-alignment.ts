export type AlignmentCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ExecutionAlignmentInput = {
  executedAt: string;
  price: number;
};

const DEFAULT_BAR_INTERVAL_SECONDS = 24 * 60 * 60;
const OFFSET_STEP_SECONDS = 15 * 60;
const MAX_OFFSET_SECONDS = 18 * 60 * 60;

function toUnixSeconds(executedAt: string) {
  const timestamp = Date.parse(executedAt);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function barEndTime(candles: AlignmentCandle[], index: number, intervalSeconds: number) {
  const current = candles[index];
  const next = candles[index + 1];
  const fallbackEnd = current.time + intervalSeconds;

  if (!next || next.time <= current.time) {
    return fallbackEnd;
  }

  return Math.min(fallbackEnd, next.time);
}

function candleIndexForTimestamp(targetTs: number, candles: AlignmentCandle[]) {
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

function priceDistanceFromCandle(price: number, candle: AlignmentCandle) {
  const epsilon = Math.max(0.0001, Math.max(Math.abs(price), Math.abs(candle.high), Math.abs(candle.low), 1) * 1e-6);

  if (price < candle.low - epsilon) {
    return candle.low - price;
  }

  if (price > candle.high + epsilon) {
    return price - candle.high;
  }

  return 0;
}

export function inferBarIntervalSeconds(candles: AlignmentCandle[]) {
  let interval = Number.POSITIVE_INFINITY;

  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta > 0 && delta < interval) {
      interval = delta;
    }
  }

  return Number.isFinite(interval) ? interval : DEFAULT_BAR_INTERVAL_SECONDS;
}

export function alignExecutionToBarTime(
  executedAt: string,
  candles: AlignmentCandle[],
  offsetSeconds = 0,
) {
  const targetTs = toUnixSeconds(executedAt);
  if (targetTs === null) {
    return null;
  }

  const candleIndex = candleIndexForTimestamp(targetTs + offsetSeconds, candles);
  return candleIndex === null ? null : candles[candleIndex].time;
}

export function inferExecutionOffsetSeconds(
  executions: ExecutionAlignmentInput[],
  candles: AlignmentCandle[],
) {
  if (executions.length === 0 || candles.length === 0) {
    return 0;
  }

  let bestOffset = 0;
  let bestPriceMatches = -1;
  let bestMatchedBars = -1;
  let bestTotalPriceDistance = Number.POSITIVE_INFINITY;

  for (let candidate = -MAX_OFFSET_SECONDS; candidate <= MAX_OFFSET_SECONDS; candidate += OFFSET_STEP_SECONDS) {
    let matchedBars = 0;
    let priceMatches = 0;
    let totalPriceDistance = 0;

    for (const execution of executions) {
      const targetTs = toUnixSeconds(execution.executedAt);
      if (targetTs === null) {
        continue;
      }

      const candleIndex = candleIndexForTimestamp(targetTs + candidate, candles);
      if (candleIndex === null) {
        continue;
      }

      matchedBars += 1;
      const distance = priceDistanceFromCandle(execution.price, candles[candleIndex]);
      totalPriceDistance += distance;
      if (distance === 0) {
        priceMatches += 1;
      }
    }

    const isBetter =
      priceMatches > bestPriceMatches ||
      (priceMatches === bestPriceMatches && matchedBars > bestMatchedBars) ||
      (priceMatches === bestPriceMatches &&
        matchedBars === bestMatchedBars &&
        totalPriceDistance < bestTotalPriceDistance) ||
      (priceMatches === bestPriceMatches &&
        matchedBars === bestMatchedBars &&
        totalPriceDistance === bestTotalPriceDistance &&
        Math.abs(candidate) < Math.abs(bestOffset));

    if (isBetter) {
      bestOffset = candidate;
      bestPriceMatches = priceMatches;
      bestMatchedBars = matchedBars;
      bestTotalPriceDistance = totalPriceDistance;
    }
  }

  return bestOffset;
}
