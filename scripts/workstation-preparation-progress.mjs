/** Successful partial fills are progress even when no complete job finishes. */
export function preparationContinuation(status, now = Date.now()) {
  const result = status.result ?? {};
  if (result.paused && !result.retryAfterMs) return { stop: true, waitMs: 0 };
  if (result.retryAfterMs) return { stop: false, waitMs: Math.min(60_000, Math.max(1000, result.retryAfterMs)) };
  if (result.processed || result.advanced) return { stop: false, waitMs: 0 };
  const next = Date.parse(result.nextAvailableAt ?? "");
  return { stop: false, waitMs: Math.min(60_000, Math.max(1000, Number.isFinite(next) ? next - now : 5000)) };
}
