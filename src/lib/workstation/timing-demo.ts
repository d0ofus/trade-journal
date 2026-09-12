import type { Trade } from "./types";
import { interpretBrokerTimestamp } from "./timestamp-interpretation";
// Sanitized MU executions; demo.ts supplies a separate frozen public Yahoo snapshot.
export const timingFills = [
  ["20260904;082827", "BUY", 4, 978.5],
  ["20260904;093247", "BUY", 4, 984.7],
  ["20260904;093248", "BUY", 4, 984.535],
  ["20260908;102421", "BUY", 6, 1016.5],
  ["20260908;150925", "SELL", 6, 1008.71],
  ["20260909;093112", "SELL", 6, 992.8],
  ["20260910;093306", "SELL", 2, 982.55],
  ["20260910;093307", "SELL", 4, 982.59],
] as const;
export function timingDemoTrade(confirmed: boolean): Trade {
  const executions = timingFills.map(([raw, side, quantity, price], index) => {
    const stamp = interpretBrokerTimestamp(raw);
    return { id: `timing-fill-${index + 1}`, time: confirmed ? stamp.utc! : stamp.stored!, side, quantity, price, commission: 0, fees: 0, provenance: { timezoneStatus: confirmed ? "verified" as const : "unverified" as const, timezone: confirmed ? "America/New_York" : null, source: "Sanitized broker timing example · demo", ...(confirmed ? { storedTime: stamp.stored!, brokerWallTime: raw, confirmationBasis: "user-confirmed", interpretationStatus: "applied" as const, interpretationVersion: "1" } : {}) } };
  });
  const buy = executions.filter(e => e.side === "BUY"), sell = executions.filter(e => e.side === "SELL");
  const cost = buy.reduce((n, e) => n + e.quantity * e.price, 0), proceeds = sell.reduce((n, e) => n + e.quantity * e.price, 0);
  return { id: "demo-mu-timing", symbol: "MU", name: confirmed ? "Eastern → UTC · interpreted" : "Original stored timestamps", account: "Timing review · Demo", currency: "USD", direction: "LONG", openTime: executions[0].time, closeTime: executions.at(-1)!.time, brokerTradeDate: "2026-09-10", timeInterpretationVersion: confirmed ? "eastern-v1" : "original", entry: cost / 18, exit: proceeds / 18, pnl: proceeds - cost, fees: 0, quantity: 18, openQuantity: 0, executions };
}
