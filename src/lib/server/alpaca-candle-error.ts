/** Only controlled status information is safe to return to chart clients. */
export class AlpacaCandleError extends Error {
  constructor(readonly reason: "http" | "empty", readonly status?: number) {
    super(reason === "empty" ? "Alpaca returned no usable bars." : `Alpaca request failed (HTTP ${status}).`);
    this.name = "AlpacaCandleError";
  }
}

export function alpacaFailureSummary(error: unknown): string {
  if (!(error instanceof AlpacaCandleError)) return "connection or response failure";
  if (error.reason === "empty") return "no usable bars returned for this period";
  const status = error.status;
  const detail = status === 401 ? "credentials rejected"
    : status === 403 ? "access denied; check API key permissions and feed access"
    : status === 429 ? "request rate limit reached"
    : status === 400 || status === 422 ? "historical data request rejected"
    : status && status >= 500 ? "provider service error"
    : "provider request rejected";
  // Never forward provider bodies or arbitrary exception messages: they may contain credentials.
  return `HTTP ${status}: ${detail}`;
}
