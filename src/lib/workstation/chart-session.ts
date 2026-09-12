import type { Trade } from "./types";
import { usEquitiesTradingSession } from "../server/market-session-calendar";
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export function isRegularUsSession(time: number) {
  const p = Object.fromEntries(date.formatToParts(new Date(time * 1000)).map(p => [p.type, Number(p.value)]));
  const session = usEquitiesTradingSession({ year: p.year, month: p.month, day: p.day });
  return !!session && time >= session.open && time < session.close;
}
export function tradeChartSession(trade: Trade, preference: "auto" | "regular" | "extended" = "auto"): "regular" | "extended" {
  if (preference !== "auto") return preference;
  return trade.executions.some(e => e.provenance?.timezoneStatus === "verified" && !isRegularUsSession(e.time)) ? "extended" : "regular";
}
