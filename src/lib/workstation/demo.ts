import timingSnapshot from "./timing-candles.json";
import { isRegularUsSession } from "./chart-session";
import { aggregateCandles } from "./math";
import { initialHistoryRange } from "./history";
import { Candle, RevisionConflict, Trade, TradeDocument, WorkstationAdapter, emptyDocument } from "./types";
import { diagnosticComparisonCandles, diagnosticDemoTrade } from "./diagnostic-demo";

const day = Date.UTC(2026, 8, 9) / 1000;
const configurations = [
  { symbol: "NVDA", name: "NVIDIA Corporation", entry: 174.2, exit: 177.82, direction: "LONG" as const, qty: 200, delta: 0, pnl: 716.4 },
  { symbol: "TSLA", name: "Tesla, Inc.", entry: 349.8, exit: 344.25, direction: "SHORT" as const, qty: 80, delta: -86400, pnl: 438.1 },
  { symbol: "AAPL", name: "Apple Inc.", entry: 231.6, exit: 229.75, direction: "LONG" as const, qty: 100, delta: -86400, pnl: -190.2 },
  { symbol: "AMD", name: "Advanced Micro Devices", entry: 163.4, exit: 166.1, direction: "LONG" as const, qty: 150, delta: -172800, pnl: 397.8 },
  { symbol: "META", name: "Meta Platforms, Inc.", entry: 731.2, exit: 735.9, direction: "SHORT" as const, qty: 30, delta: -172800, pnl: -145.8 },
  { symbol: "MSFT", name: "Microsoft Corporation", entry: 508.1, exit: 512.3, direction: "LONG" as const, qty: 60, delta: 0, pnl: 121.4, partial: true },
];
export const demoTrades: Trade[] = configurations.map((c, index) => {
  const start = day + c.delta + 14 * 3600 + 5 * 60, end = start + 7200;
  const opening = c.direction === "LONG" ? "BUY" : "SELL", closing = opening === "BUY" ? "SELL" : "BUY";
  const executions = [
    { id: `demo-${index}-1`, time: start + 17, side: opening, quantity: c.qty * .6, price: c.entry - .12, commission: 1, fees: .1 },
    { id: `demo-${index}-2`, time: start + 12 * 60 + 32, side: opening, quantity: c.qty * .4, price: c.entry + .18, commission: 1, fees: .1 },
    { id: `demo-${index}-3`, time: end - 35 * 60 + 4, side: closing, quantity: c.qty * .5, price: c.exit - .3, commission: 1, fees: .2 },
    ...(!c.partial ? [{ id: `demo-${index}-4`, time: end + 11, side: closing, quantity: c.qty * .5, price: c.exit + .3, commission: 1, fees: .2 }] : []),
  ].map(e => ({ ...e, provenance: { timezoneStatus: "verified", timezone: "UTC", source: "Synthetic demo" } })) as Trade["executions"];
  const gross = executions.reduce((sum, e) => sum + (e.side === "SELL" ? 1 : -1) * e.price * e.quantity, 0);
  const fees = executions.reduce((sum, e) => sum + e.commission + e.fees, 0);
  return { id: `demo-${c.symbol.toLowerCase()}`, symbol: c.symbol, name: c.name, account: index === 4 ? "Swing · Demo" : "Momentum · Demo", currency: "USD", direction: c.direction, openTime: start, closeTime: end + 11, entry: c.entry, exit: c.exit, pnl: c.partial ? (c.exit - .3 - c.entry) * c.qty * .5 - fees : gross - fees, fees, quantity: c.qty, openQuantity: c.partial ? c.qty * .5 : 0, executions };
});
const candlesByTrade = new Map<string, Candle[]>();
export function demoCandles(trade: Trade): Candle[] {
  const cached = candlesByTrade.get(trade.id); if (cached) return cached;
  let seed = [...trade.symbol].reduce((n, c) => n * 31 + c.charCodeAt(0), 17) >>> 0;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const start = Math.floor(trade.openTime / 86400) * 86400 - 800 * 86400;
  const end = Math.max(Math.floor(trade.openTime / 86400) * 86400 + 3 * 86400, trade.closeTime + 86400);
  const result: Candle[] = [];
  let last = trade.entry * .89;
  for (let time = start; time < end; time += 300) {
    const date = new Date(time * 1000), weekday = date.getUTCDay(), minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    if (weekday === 0 || weekday === 6 || minutes < (trade.id === "demo-mu-timing" ? 8 * 60 : 13 * 60 + 30) || minutes >= (trade.id === "demo-mu-timing" ? 24 * 60 : 20 * 60)) continue;
    const distance = (time - trade.openTime) / 86400;
    const baseline = trade.entry * (1 + distance * .0008) + Math.sin(distance * .8) * trade.entry * .004;
    let target = baseline;
    if (Math.abs(distance) < .7) {
      const progress = Math.max(0, Math.min(1, (time - trade.openTime) / 7200));
      target = trade.entry + progress * (trade.exit - trade.entry) + Math.sin((time - trade.openTime) / 800) * .38;
    }
    const open = last, close = last + (target - last) * .32 + (random() - .49) * trade.entry * .0017;
    const span = trade.entry * (.0003 + random() * .0009);
    const bar = { time, open, high: Math.max(open, close) + span, low: Math.min(open, close) - span, close, volume: Math.round(30000 + random() * 240000) };
    for (const fill of trade.executions.filter(e => e.time >= time && e.time < time + 300)) { bar.high = Math.max(bar.high, fill.price + .06); bar.low = Math.min(bar.low, fill.price - .06); }
    result.push(bar); last = close;
  }
  candlesByTrade.set(trade.id, result); return result;
}
export function initialDemoDocument(trade: Trade): TradeDocument {
  const doc = emptyDocument();
  if (trade.symbol !== "NVDA") return doc;
  doc.review = { ...doc.review, setup: "Opening range breakout", execution: "Waited for the reclaim, then added on the first higher low. Took half into resistance and let the second piece work.", takeaway: "Patience at the entry gave this trade room to breathe. Keep the second exit tied to structure.", thesis: "Relative strength held while the index consolidated. Volume expanded through the opening range high.", notes: "<p>A clean continuation after the opening drive. The best decision was <strong>waiting for the retest</strong>.</p>", tags: ["Breakout", "Relative strength", "Scale out"], status: "In progress" };
  doc.drawings = [
    { id: "demo-level", tool: "ray", points: [{ time: trade.openTime - 1500, price: trade.entry - .8 }], text: "Opening range high", color: "#a5b4fc", width: 1.5, dashed: true, locked: false, hidden: false, panel: null, createdAt: trade.openTime - 1500 },
    { id: "demo-note", tool: "text", points: [{ time: trade.openTime + 2700, price: trade.entry + 3.4 }], text: "Reclaim + volume confirmation", color: "#c4b5fd", width: 1.5, dashed: false, locked: false, hidden: false, panel: "chart-1", createdAt: trade.openTime + 2700 },
  ];
  return doc;
}
export const DEMO_PREFIX = "execution-lab:workstation:demo:v1:";
export function createDemoAdapter(trades = demoTrades): WorkstationAdapter {
  return {
    mode: "demo",
    async load(id) { const trade = trades.find(t => t.id === id); if (!trade) throw new Error("Demo trade not found"); const raw = localStorage.getItem(DEMO_PREFIX + id); if (!raw) return initialDemoDocument(trade); const doc = JSON.parse(raw) as TradeDocument; if (doc.schema !== 1) throw new Error("Unsupported saved demo format. Export your local data before resetting."); return doc; },
    async save(id, doc, revision) { const raw = localStorage.getItem(DEMO_PREFIX + id); const current = raw ? JSON.parse(raw) as TradeDocument : null; if ((current?.revision ?? 0) !== revision) throw new RevisionConflict(); const next = { ...doc, revision: revision + 1, updatedAt: new Date().toISOString() }; localStorage.setItem(DEMO_PREFIX + id, JSON.stringify(next)); return next; },
    async candles(trade, interval, signal, range = initialHistoryRange(trade, interval)) {
      signal?.throwIfAborted();
      // Aggregate before slicing so page boundaries never create partial daily/weekly candles.
      if (trade.id === "demo-mu-timing") {
        const source = timingSnapshot.candles.filter(c => trade.chartSession === "regular" ? isRegularUsSession(c.time) : true);
        return { candles: aggregateCandles(source, interval).filter(c => c.time >= range.from && c.time <= range.to), warning: "Frozen Yahoo snapshot (4-10 Sep 2026). Higher intervals aggregate these bars; outside history unavailable.", source: "Yahoo snapshot / demo", session: { timezone: "America/New_York", calendar: "exchange", marketHours: trade.chartSession ?? "extended" } };
      }
      const diagnostic = trade.id === diagnosticDemoTrade.id;
      const source = diagnostic ? demoCandles(trade).map(c => diagnosticComparisonCandles.find(d => d.time === c.time) ?? c) : demoCandles(trade);
      const candles = aggregateCandles(source, interval).filter(c => c.time >= range.from && c.time <= range.to);
      if (diagnostic) return { candles, warning: "Synthetic context with two audited comparison bars · source timezone unverified", source: "Diagnostic fixture", session: { timezone: "UTC", calendar: "utc", marketHours: "unknown" } };
      return { candles, warning: "Synthetic candles · UTC · regular session", source: "Demo", session: { timezone: "UTC", calendar: "utc", marketHours: "unknown" } };
    },
    reset() { for (const key of Object.keys(localStorage)) if (key.startsWith(DEMO_PREFIX) || key.startsWith("execution-lab:workstation:draft:demo:")) localStorage.removeItem(key); },
  };
}
