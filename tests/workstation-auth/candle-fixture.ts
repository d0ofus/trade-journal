import { seconds, type Interval } from "../../src/lib/workstation/types";

/** Deterministic provider double; persistence tests exercise the real saved-view/review APIs. */
export function candleFixture(url: string) {
  const p = new URL(url).searchParams, session = p.get("session") ?? "regular";
  const step = seconds[p.get("timeframe") as Interval];
  const from = Number(p.get("from")), to = Number(p.get("to"));
  const start = Math.ceil(from / step) * step, price = session === "extended" ? 110 : 100;
  const candles = Array.from({ length: Math.min(20000, Math.max(0, Math.floor((to - start) / step) + 1)) }, (_, i) => ({
    time: start + i * step, open: price, high: price + 2, low: price - 1, close: price + 1, volume: 100 + i % 100,
  }));
  return { candles, source: "Isolated fixture", metadata: { warnings: [], session: { timezone: "America/New_York", calendar: "exchange", marketHours: session } } };
}
