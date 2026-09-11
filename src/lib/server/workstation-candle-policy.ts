import type { AlpacaCandleCredentials } from "./market-candles";

export type WorkstationCandlePolicy = {
  provider: "legacy" | "alpaca" | "yahoo";
  credentials: AlpacaCandleCredentials | null;
  delaySeconds: number;
  fallback: boolean;
  cacheSource: string;
};
/** Chart-only settings. Never read global ALPACA_* credentials or change process.env. */
export function workstationCandlePolicy(env: NodeJS.ProcessEnv = process.env): WorkstationCandlePolicy {
  const provider = env.TRADES_CHART_PROVIDER ?? "legacy";
  if (!["legacy", "alpaca", "yahoo"].includes(provider)) throw new Error("TRADES_CHART_PROVIDER must be legacy, alpaca or yahoo.");
  if (provider !== "alpaca") return { provider: provider as "legacy" | "yahoo", credentials: null, delaySeconds: 0, fallback: false, cacheSource: "" };
  const feed = env.TRADES_ALPACA_DATA_FEED ?? "sip";
  if (feed !== "sip" && feed !== "iex") throw new Error("Workstation Alpaca feed must be sip or iex.");
  const adjustment = env.TRADES_ALPACA_ADJUSTMENT ?? "raw";
  if (adjustment !== "raw") throw new Error("Workstation execution charts currently require raw prices. Adjusted execution and annotation coordinates are not enabled.");
  const delaySeconds = Number(env.TRADES_ALPACA_DELAY_SECONDS ?? (feed === "sip" ? "900" : "0"));
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400) throw new Error("Workstation Alpaca delay must be an integer from 0 to 86400 seconds.");
  const baseUrl = (env.TRADES_ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets").replace(/\/+$/, "");
  // Prevent misconfiguration from sending credentials to a different host.
  if (baseUrl !== "https://data.alpaca.markets") throw new Error("Workstation market data must use https://data.alpaca.markets.");
  const keyId = env.TRADES_ALPACA_API_KEY_ID, secretKey = env.TRADES_ALPACA_API_SECRET_KEY;
  if (!keyId || !secretKey) throw new Error("Workstation Alpaca credentials are missing. Set TRADES_ALPACA_API_KEY_ID and TRADES_ALPACA_API_SECRET_KEY.");
  return { provider: "alpaca", credentials: { keyId, secretKey, baseUrl, feed, adjustment }, delaySeconds, fallback: env.TRADES_CHART_YAHOO_FALLBACK !== "0", cacheSource: `workstation:v1:alpaca:${feed}:${adjustment}` };
}
