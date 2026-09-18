import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { aggregateCandles, bucket, completedCandles, executionBar, percentageChange, riskReward, visibleDrawings } from "./math";
import { createDemoAdapter, demoCandles, demoTrades, initialDemoDocument } from "./demo";
import { csvCell, exportColumns, reviewArchive, reviewCsv } from "./export";
import { intervals, Drawing, drawingTools, defaultPreferences, seconds } from "./types";
import { workstationDocumentSchema } from "./schema";
import { hitAt, paintChart, type PaintOptions } from "../../components/workstation/chart-paint";
import { drawingStyle, drawingStyleFor, restoreDrawingStyles } from "./drawing-style";
import { wrapDrawingText } from "./drawing-label-text";
import { dateTargetAnchor, dateTargetIsVisible, restoredDateLink } from "./date-link";
import { createApplicationAdapter } from "./application-adapter";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES } from "./payload";
import { emptyDocument } from "./types";

test("tool defaults migrate once, validate saved entries, and copy only appearance", () => {
  const legacy = { color: "#123456", width: 3, dashed: true };
  const migrated = restoreDrawingStyles(undefined, legacy);
  for (const tool of drawingTools) {
    if (tool === "cursor") continue;
    assert.deepEqual(drawingStyleFor(tool, migrated), { ...legacy, ...(tool === "ray" ? { showDefaultLabel: true } : {}) });
  }
  assert.notEqual(migrated.ray, migrated.measure);
  const ray = { ...initialDemoDocument(demoTrades[0]).drawings[0], color: "#abcdef", showDefaultLabel: false };
  migrated.ray = drawingStyle("ray", ray);
  assert.deepEqual(Object.keys(migrated.ray).sort(), ["color", "dashed", "showDefaultLabel", "width"]);
  assert.deepEqual(migrated.measure, legacy);
  assert.deepEqual(drawingStyleFor("ray", JSON.parse(JSON.stringify(migrated))), migrated.ray);
  assert.equal(drawingStyle("measure", ray).showDefaultLabel, undefined);
  assert.equal(drawingStyleFor("ray", defaultPreferences().drawingStyles).showDefaultLabel, true);
  for (const invalid of [null, [], {}, { ...legacy, width: NaN }, { ...legacy, width: 5 }, { ...legacy, width: .1 }, { ...legacy, color: "red" }, { ...legacy, dashed: "true" }, { ...legacy, showDefaultLabel: "false" }]) {
    assert.deepEqual(restoreDrawingStyles({ ray: invalid }, legacy).ray, drawingStyle("ray"));
  }
  for (const map of [{}, null, [], { ray: migrated.ray, cursor: legacy, unknown: legacy }]) {
    const restored = restoreDrawingStyles(map, legacy);
    assert.deepEqual(restored.measure, drawingStyle("measure"));
    assert.equal("cursor" in restored, false);
    assert.equal("unknown" in restored, false);
  }
});

function drawingPaint(drawing: Drawing, overrides: Partial<PaintOptions> = {}) {
  const texts: { text: string; x: number; y: number; width: number }[] = [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const context = new Proxy({
    measureText: (text: string) => ({ width: Array.from(text).length * 6 }),
    fillText: (text: string, x: number, y: number, width: number) => { texts.push({ text, x, y, width }); },
    roundRect: (x: number, y: number, w: number, h: number) => { boxes.push({ x, y, w, h }); },
  }, { get: (target, property) => property in target ? target[property as keyof typeof target] : () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
  const trade = demoTrades[0];
  const hits = paintChart(context, { width: 500, height: 400, plotWidth: 450, plotHeight: 375,
    x: t => (t - trade.openTime) / 12 + 100, y: p => 250 - (p - trade.entry) * 20,
    drawings: [drawing], trade: { ...trade, executions: [] }, candles: demoCandles(trade), interval: "5m",
    labels: "labels", selected: drawing.id, selectedExecution: null, light: false, replay: null, ...overrides });
  return { texts, boxes, hits };
}

test("ray labels default on, toggle independently of notes, and leave selectable lines", () => {
  const ray = { ...initialDemoDocument(demoTrades[0]).drawings[0], text: "" };
  for (const light of [false, true]) for (const exporting of [false, true]) {
    for (const showDefaultLabel of [undefined, true, false]) {
      const { texts, hits } = drawingPaint({ ...ray, showDefaultLabel }, { light, export: exporting });
      assert.equal(texts.length, showDefaultLabel === false ? 0 : 1);
      if (texts.length) assert.equal(texts[0].text, `Ray · ${ray.points[0].price.toFixed(2)}`);
      const line = hits.find(h => h.kind === "drawing")!;
      assert.equal(hitAt(hits, { x: line.x + 30, y: line.y + 6 })?.id, ray.id);
      const note = drawingPaint({ ...ray, showDefaultLabel, text: "Keep my note" }, { light, export: exporting });
      assert.equal(note.texts[0].text, "Keep my note");
    }
  }
  assert.equal(drawingPaint({ ...ray, showDefaultLabel: false, locked: true }).hits.some(h => h.kind === "handle"), false);
  assert.equal(drawingPaint({ ...ray, tool: "horizontal", showDefaultLabel: false }).texts.length, 1);
});

test("measurement notes wrap above metrics and stay inside the plot in live charts and exports", () => {
  const trade = demoTrades[0];
  const drawing: Drawing = { ...initialDemoDocument(trade).drawings[0], tool: "measure", text: "A measured move",
    points: [{ time: trade.openTime, price: trade.entry }, { time: trade.openTime + 900, price: trade.entry + 2 }] };
  for (const light of [false, true]) for (const exporting of [false, true]) {
    const { texts, boxes, hits } = drawingPaint(drawing, { light, export: exporting });
    assert.equal(texts[0].text, drawing.text);
    assert.match(texts[1].text, /^\+2\.00 .*15m.*bars$/);
    assert.ok(texts[0].y < texts[1].y);
    const box = boxes[0];
    assert.equal(box.h, 40);
    assert.equal(hitAt(hits, { x: box.x + 5, y: box.y + 5 })?.id, drawing.id);
    for (const text of ["", " \n  "]) assert.equal(drawingPaint({ ...drawing, text }, { light, export: exporting }).boxes[0].h, 24);
    for (const y of [-20, 240]) {
      const long = drawingPaint({ ...drawing, text: "Long measurement explanation ".repeat(18) }, {
        light, export: exporting, plotWidth: 180, plotHeight: 170, x: () => 190, y: () => y,
      });
      const bounds = long.boxes[0];
      assert.ok(bounds.x >= 3 && bounds.x + bounds.w <= 177);
      assert.ok(bounds.y >= (exporting ? 3 : 24) && bounds.y + bounds.h <= 170);
      assert.ok(long.texts.length > 2);
      assert.ok(long.texts.at(-2)!.text.endsWith("…"));
      assert.match(long.texts.at(-1)!.text, /bars$/);
      for (const row of long.texts.slice(0, -1)) assert.ok(Array.from(row.text).length * 6 <= row.width);
    }
  }
  assert.deepEqual(wrapDrawingText("one two\n雪雪雪雪雪", 18, s => Array.from(s).length * 6), ["one", "two", "雪雪雪", "雪雪"]);
});

test("execution labels avoid the full multiline measurement label", () => {
  const trade = demoTrades[0];
  const drawing: Drawing = { ...initialDemoDocument(trade).drawings[0], tool: "measure",
    text: "An explanation of this measured move that wraps over several lines ".repeat(2),
    points: [{ time: trade.openTime, price: trade.entry }, { time: trade.openTime + 900, price: trade.entry + 2 }] };
  const { hits, boxes } = drawingPaint(drawing, { trade });
  const box = boxes[0];
  for (const hit of hits.filter(h => h.kind === "execution" && h.h === 24)) {
    assert.ok(hit.x + hit.w <= box.x || box.x + box.w <= hit.x || hit.y + hit.h <= box.y || box.y + box.h <= hit.y);
  }
});

test("schema and demo persistence preserve hidden automatic ray labels and measurement notes", async () => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  try {
    const adapter = createDemoAdapter(), trade = demoTrades[0], doc = await adapter.load(trade.id);
    doc.drawings[0].showDefaultLabel = false;
    doc.drawings.push({ ...doc.drawings[0], id: "measurement-note", tool: "measure", text: "Saved measurement note",
      points: [doc.drawings[0].points[0], { time: trade.openTime, price: trade.entry }] });
    const parsed = workstationDocumentSchema.parse(doc);
    assert.equal(parsed.drawings[0].showDefaultLabel, false);
    assert.equal(workstationDocumentSchema.safeParse({ ...doc, drawings: [{ ...doc.drawings[0], showDefaultLabel: "false" }] }).success, false);
    await adapter.save(trade.id, parsed, doc.revision);
    assert.deepEqual((await adapter.load(trade.id)).drawings, parsed.drawings);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("application saves measure UTF-8 bytes and reject oversized reviews before HTTP", async () => {
  assert.equal(jsonBytes("界"), 5);
  const adapter = createApplicationAdapter();
  const document = emptyDocument(); document.review.notes = "界".repeat(Math.ceil(REVIEW_PACKAGE_MAX_BYTES / 3));
  await assert.rejects(adapter.save("oversized", document, 0), /4 MB save limit/);
});

test("application saves serialize the outgoing package once and exclude server-owned archives", async context => {
  let serializations = 0;
  const stringify = JSON.stringify;
  context.mock.method(JSON, "stringify", (value: unknown) => {
    if (value && typeof value === "object" && "document" in value) serializations++;
    return stringify(value);
  });
  context.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(options.body as string);
    assert.equal(payload.document.legacy, undefined);
    assert.equal(payload.document.review.takeaway, "最新 review");
    return new Response(stringify({ ...payload.document, revision: 1 }), { status: 200 });
  });
  const doc = emptyDocument(); doc.review.takeaway = "最新 review"; doc.legacy = "archive".repeat(REVIEW_PACKAGE_MAX_BYTES);
  await createApplicationAdapter().save("review", doc, 0);
  assert.equal(serializations, 1);
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
