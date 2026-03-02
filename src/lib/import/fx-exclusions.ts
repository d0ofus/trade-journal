const EXCLUDED_FX_PAIRS = new Set<string>([
  "AUD.USD",
  "USD.HKD",
  "USD.SGD",
]);

export function isExcludedFxPairSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return false;
  if (EXCLUDED_FX_PAIRS.has(normalized)) return true;
  return /^[A-Z]{3}\.[A-Z]{3}$/.test(normalized);
}

