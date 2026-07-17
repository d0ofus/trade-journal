type CandleRow = {
  time?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
};

type CandlePayload = {
  candles?: CandleRow[];
  metadata?: { coverage?: { status?: unknown; profile?: unknown } | null } | null;
  compare?: {
    candles?: CandleRow[];
    metadata?: { coverage?: { status?: unknown; profile?: unknown } | null } | null;
  } | null;
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

function coverageCanBeCached(metadata: CandlePayload["metadata"]) {
  const status = metadata?.coverage?.status;
  if (status === "partial") return false;
  if (status === "unverified") return Boolean(metadata?.coverage?.profile);
  return true;
}

export function isDisplayableCandleResponse(payload: CandlePayload, options: { requiresComparison?: boolean } = {}) {
  if (payload.error || payload.compareError) return false;
  if (!hasReusableCandles(payload.candles)) return false;
  return !options.requiresComparison || hasReusableCandles(payload.compare?.candles);
}

export function isReusableCandleResponse(payload: CandlePayload, options: { requiresComparison?: boolean } = {}) {
  if (!isDisplayableCandleResponse(payload, options)) return false;
  if (!coverageCanBeCached(payload.metadata)) return false;
  return !options.requiresComparison || coverageCanBeCached(payload.compare?.metadata);
}
