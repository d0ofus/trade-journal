import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { aggregateCandles, bucket, completedCandles, executionBar, percentageChange, riskReward, visibleDrawings } from "./math";
import { createDemoAdapter, demoCandles, demoTrades, initialDemoDocument } from "./demo";
import { csvCell, exportColumns, reviewArchive, reviewCsv } from "./export";
import { intervals, Drawing, seconds } from "./types";
import { workstationDocumentSchema } from "./schema";
import { paintChart } from "../../components/workstation/chart-paint";
import { dateTargetAnchor, dateTargetIsVisible, restoredDateLink } from "./date-link";
import { createApplicationAdapter } from "./application-adapter";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES } from "./payload";
import { emptyDocument } from "./types";

test("application saves measure UTF-8 bytes and reject oversized reviews before HTTP", async () => {
  assert.equal(jsonBytes("界"), 5);
  const adapter = createApplicationAdapter();
  await assert.rejects(adapter.save("oversized", { ...emptyDocument(), legacy: "界".repeat(Math.ceil(REVIEW_PACKAGE_MAX_BYTES / 3)) }, 0), /4 MB save limit/);
});

test("date linking leaves exact visible times and overlapping candle periods untouched", () => {
  const day = Date.UTC(2026, 8, 9) / 1000;
  const intraday = { from: day + 14 * 3600, to: day + 16 * 3600 };
  assert.equal(dateTargetIsVisible({ time: intraday.to + 17 }, intraday, "5m"), true);
  assert.equal(dateTargetIsVisible({ time: intraday.to + 300 }, intraday, "5m"), false);
  assert.equal(dateTargetIsVisible({ time: day, end: day + 86400 }, intraday, "5m"), true);
  assert.equal(dateTargetIsVisible({ time: day - 86400, end: day }, intraday, "5m"), false);
  assert.equal(dateTargetIsVisible({ time: day + 15 * 3600 }, { from: day, to: day }, "1d"), true);
  assert.equal(dateTargetIsVisible({ time: day }, null, "5m"), false);
});

test("coarse chart clicks anchor to an execution or actual session instead of midnight", () => {
  const trade = demoTrades[0], candles = demoCandles(trade);
  const day = Math.floor(trade.openTime / 86400) * 86400;
  const target = { time: day, end: day + 86400 };
  assert.equal(dateTargetAnchor(target, candles, trade.executions), trade.executions[0].time);
  const anchor = dateTargetAnchor(target, candles, []);
  assert.ok(anchor >= day + 13.5 * 3600 && anchor < day + 20 * 3600);
  assert.equal(dateTargetAnchor({ time: trade.openTime + 17 }, candles, []), trade.openTime + 17);
});

test("saved window locks migrate to click linking and explicit independent mode survives", () => {
  assert.equal(restoredDateLink("window"), "target");
  assert.equal(restoredDateLink("target"), "target");
  assert.equal(restoredDateLink(undefined), "target");
  assert.equal(restoredDateLink("independent"), "independent");
});

test("percentage measurements use the starting price and reject nonpositive denominators", () => { assert.equal(percentageChange(100, 105), 5); assert.ok(Math.abs(percentageChange(105, 100)! + 4.7619047619) < 1e-9); assert.equal(percentageChange(0, 5), null); assert.equal(percentageChange(-100, -95), null); });
test("every demo execution has a real containing candle in every supported interval", () => { for (const trade of demoTrades) for (const interval of intervals) { const candles = aggregateCandles(demoCandles(trade), interval); for (const fill of trade.executions) { const bar = executionBar(fill, candles, interval); assert.ok(bar, `${trade.symbol} ${interval} ${fill.id}`); assert.ok(fill.time >= bar.time && fill.time < bar.time + seconds[interval]); assert.ok(fill.price >= bar.low && fill.price <= bar.high); } } });
test("demo financial summaries reconcile to fills, including partial closure", () => { for (const trade of demoTrades) { const entrySide = trade.direction === "LONG" ? "BUY" : "SELL", entries = trade.executions.filter(e => e.side === entrySide), exits = trade.executions.filter(e => e.side !== entrySide); const entryQty = entries.reduce((s, e) => s + e.quantity, 0), exitQty = exits.reduce((s, e) => s + e.quantity, 0), entry = entries.reduce((s, e) => s + e.price * e.quantity, 0) / entryQty, exit = exits.reduce((s, e) => s + e.price * e.quantity, 0) / exitQty; assert.ok(Math.abs(entry - trade.entry) < 1e-8); assert.equal(entryQty - exitQty, trade.openQuantity); const result = (exit - entry) * exitQty * (trade.direction === "LONG" ? 1 : -1) - trade.fees; assert.ok(Math.abs(result - trade.pnl) < 1e-8); } });
test("missing candles are never replaced by a nearest execution marker", () => { const fill = demoTrades[0].executions[0], candles = demoCandles(demoTrades[0]).filter(b => !(fill.time >= b.time && fill.time < b.time + 300)); assert.equal(executionBar(fill, candles, "5m"), undefined); });
test("replay hides incomplete candles and future notes on coarse intervals", () => { const trade = demoTrades[0], daily = aggregateCandles(demoCandles(trade), "1d"), cursor = trade.openTime + 900; assert.ok(completedCandles(daily, "1d", cursor).every(b => b.time + 86400 <= cursor)); const drawings = initialDemoDocument(trade).drawings; assert.equal(visibleDrawings(drawings, "chart-1", trade.openTime).length, 1); assert.equal(visibleDrawings(drawings, "chart-2", null).length, 1); });
test("weekly buckets begin on Monday UTC", () => { for (const trade of demoTrades) assert.equal(new Date(bucket(trade.openTime, "1wk") * 1000).getUTCDay(), 1); });
test("risk/reward is directional and rejects invalid stop/target ordering", () => { const base = initialDemoDocument(demoTrades[0]).drawings[0]; const d: Drawing = { ...base, tool: "long", points: [{ time: 100, price: 100 }, { time: 200, price: 110 }, { time: 200, price: 95 }] }; assert.equal(riskReward(d)?.ratio, 2); assert.equal(riskReward({ ...d, tool: "short" })?.ratio, null); assert.equal(riskReward({ ...d, tool: "short", points: [{ time: 100, price: 100 }, { time: 200, price: 90 }, { time: 200, price: 105 }] })?.ratio, 2); });
test("single-anchor drawings and all executions paint without throwing and expose hit targets", () => { const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) }, { get: (target, property) => property in target ? target[property as keyof typeof target] : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D; const trade = demoTrades[0], data = demoCandles(trade); const hits = paintChart(ctx, { width: 1000, height: 600, plotWidth: 940, plotHeight: 575, x: t => (t - trade.openTime) / 12 + 100, y: p => 500 - (p - trade.entry) * 80, drawings: initialDemoDocument(trade).drawings, trade, candles: data, interval: "5m", labels: "labels", selected: null, selectedExecution: null, light: false, replay: null }); assert.equal(new Set(hits.filter(h => h.kind === "execution").map(h => h.id)).size, 4); assert.equal(hits.filter(h => h.kind === "execution" && h.h === 18).length, 4); assert.equal(new Set(hits.filter(h => h.kind === "drawing").map(h => h.id)).size, 2); assert.deepEqual(hits.filter(h => h.id === "demo-note").map(h => h.point), [1, 0]); });
test("CSV escapes multiline Unicode and formulas but retains numeric negatives", () => { assert.equal(csvCell('first,"second"\n雪'), '"first,""second""\n雪"'); assert.equal(csvCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"'); assert.equal(csvCell(-12.5), '"-12.5"'); const trade = demoTrades[0], doc = initialDemoDocument(trade); const csv = reviewCsv([{ trade, doc, url: "http://localhost:3000/preview/trades" }], ["Symbol", "Trade ID", "Trade date"], { Symbol: "Ticker" }); assert.ok(csv.startsWith('\ufeff"Ticker","Trade ID","Trade date"')); assert.ok(csv.includes('"09/09/2026"')); });

test("overlapping daily executions stay readable below the compact price readout", () => {
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) }, { get: (target, property) => property in target ? target[property as keyof typeof target] : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
  const trade = demoTrades[0], candles = aggregateCandles(demoCandles(trade), "1d");
  const executions = paintChart(ctx, { width: 420, height: 310, plotWidth: 360, plotHeight: 285, x: () => 190, y: price => price > trade.entry ? 12 : 200, drawings: [], trade, candles, interval: "1d", labels: "labels", selected: null, selectedExecution: null, light: false, replay: null }).filter(hit => hit.kind === "execution" && hit.h === 24);
  assert.equal(executions.length, 4);
  for (const hit of executions) { assert.ok(hit.y >= 24 && hit.y + hit.h <= 285); assert.ok(hit.x >= 0 && hit.x + hit.w <= 360); }
  for (let i = 0; i < executions.length; i++) for (let j = i + 1; j < executions.length; j++) {
    const a = executions[i], b = executions[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
});
test("portable archive preserves reviews and snapshot files with relative links", async () => { const trade = demoTrades[0], doc = initialDemoDocument(trade); doc.evidence.push({ id: "sample", name: "sample.png", image: "data:image/png;base64,iVBORw0KGgo=", time: trade.openTime, revision: 0, timeframe: "5m" }); const archive = await reviewArchive([{ trade, doc, url: "http://localhost:3000/preview/trades" }], exportColumns, {}); const files = unzipSync(new Uint8Array(await archive.arrayBuffer())); assert.ok(files["manifest.json"]); assert.ok(files["reviews.csv"]); const html = strFromU8(Object.entries(files).find(([name]) => name.endsWith("review.html"))![1]); assert.ok(html.includes('src="assets/sample.png"')); assert.ok(Object.keys(files).some(name => name.endsWith("assets/sample.png"))); });
test("document validation rejects invalid anchors, external image URLs, and unsupported versions", () => { const doc = initialDemoDocument(demoTrades[0]); assert.ok(workstationDocumentSchema.safeParse(doc).success); assert.equal(workstationDocumentSchema.safeParse({ ...doc, schema: 2 }).success, false); assert.equal(workstationDocumentSchema.safeParse({ ...doc, drawings: [{ ...doc.drawings[0], tool: "measure" }] }).success, false); });
test("demo saves detect stale revisions and keep data isolated from other storage", async () => { const storage = new Map<string, string>(); Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } }); const adapter = createDemoAdapter(), id = demoTrades[0].id, doc = await adapter.load(id); doc.review.takeaway = "Preserved edit"; const saved = await adapter.save(id, doc, 0); assert.equal(saved.revision, 1); await assert.rejects(adapter.save(id, doc, 0), /changed in another tab/); assert.equal((await adapter.load(id)).review.takeaway, "Preserved edit"); assert.equal(storage.size, 1); });
