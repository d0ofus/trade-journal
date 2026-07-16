type CandleRow = {
  time?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
};

type CandlePayload = {
  candles?: CandleRow[];
  compare?: { candles?: CandleRow[] } | null;
  error?: unknown;
  compareError?: unknown;
};

function hasReusableCandles(candles: CandleRow[] | undefined) {
  if (!Array.isArray(candles) || candles.length === 0) return false;
  return candles.every((candle) =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

export function isReusableCandleResponse(payload: CandlePayload, options: { requiresComparison?: boolean } = {}) {
  if (payload.error || payload.compareError) return false;
  if (!hasReusableCandles(payload.candles)) return false;
  return !options.requiresComparison || hasReusableCandles(payload.compare?.candles);
}
