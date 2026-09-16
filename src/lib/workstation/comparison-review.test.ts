import { describe, expect, it } from "vitest";
import { beforeEntryBoundary, beforeEntryCandles, beforeEntryDrawings } from "./before-entry";
import { alignComparison, executionColors } from "./comparison";
import { calculateMarketMetrics, previousSession } from "./market-metrics";
import { chartSections, emptyNotionReview, notionProperties, notionReviewSchema, stopLossPercent } from "./notion-template";
import { notionClipboard } from "./notion-export";
import { richHtml, richPlain } from "./rich-text";
import { emptyDocument, type Candle, type CandleSession, type Trade } from "./types";
import { tradeViewSchema, viewPreferences } from "./trade-view";
import { reviewArchive, reviewCsv, exportColumns } from "./export";
import { unzipSync, strFromU8 } from "fflate";
const at = (iso: string) => Date.parse(iso) / 1000;
const session: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "regular" };
const candle = (time: number, close = 100): Candle => ({ time, open: close, high: close + 2, low: close - 2, close, volume: 1000 });
const trade = (time = at("2026-06-04T14:35:17Z")): Trade => ({ id: "trade", symbol: "OSCR", name: "OSCR", currency: "USD", account: "Test", direction: "LONG", entry: 100, exit: 110, openTime: time, closeTime: time + 1000, quantity: 10, openQuantity: 0, pnl: 100, fees: 0, executions: [{ id: "first", time, side: "BUY", quantity: 10, price: 100, commission: 0, fees: 0, provenance: { timezoneStatus: "verified", timezone: "UTC", source: "fixture" } }] });

describe("before-entry boundaries", () => {
  it("excludes the entry candle and later values even when the entry bar is missing", () => {
    const rows = [candle(at("2026-06-04T14:30Z")), candle(at("2026-06-04T14:35Z")), candle(at("2026-06-04T14:40Z"))];
    expect(beforeEntryCandles(rows, trade(), "5m", session)).toEqual(rows.slice(0, 1));
    expect(beforeEntryCandles([rows[0], rows[2]], trade(), "5m", session)).toEqual(rows.slice(0, 1));
    expect(beforeEntryCandles(rows, trade(at("2026-06-04T14:35Z")), "5m", session)).toEqual(rows.slice(0, 1));
  });
  it("uses exchange-aligned hourly buckets and early closes", () => {
    const rows = [candle(at("2026-06-04T13:30Z")), candle(at("2026-06-04T14:30Z"))];
    expect(beforeEntryCandles(rows, trade(), "1h", session)).toEqual(rows.slice(0, 1));
    const shortened = candle(at("2026-11-27T17:30Z"));
    expect(beforeEntryCandles([shortened], trade(at("2026-11-27T18:05Z")), "1h", session)).toEqual([shortened]);
  });
  it("removes the full entry day/week and resolves daylight saving", () => {
    expect(beforeEntryBoundary(trade(), "1d", session)).toBe(at("2026-06-04T04:00Z"));
    expect(beforeEntryBoundary(trade(), "1wk", session)).toBe(at("2026-06-01T04:00Z"));
    expect(beforeEntryBoundary(trade(at("2026-01-07T14:30:01Z")), "1d", session)).toBe(at("2026-01-07T05:00Z"));
  });
  it("rejects pending and unresolved interpretation", () => {
    const t = trade(); t.executions[0].provenance!.interpretationStatus = "stale";
    expect(beforeEntryBoundary(t, "5m", session)).toBeNull();
    expect(beforeEntryBoundary(trade(), "1d", { ...session, calendar: "unknown" })).toBeNull();
  });
  it("suppresses drawings anchored in the excluded period", () => {
    const rows = [candle(at("2026-06-04T14:30Z"))];
    const base = { id: "d", tool: "trend" as const, text: "", color: "#123456", width: 1, dashed: false, locked: false, hidden: false, panel: null, createdAt: 1 };
    expect(beforeEntryDrawings([{ ...base, points: [{ time: rows[0].time, price: 100 }, { time: rows[0].time + 300, price: 101 }] }], rows, "5m", session)).toEqual([]);
  });
});
describe("candlestick comparison", () => {
  it("keeps original benchmark prices without inserting benchmark timestamps", () => {
    const stock = [candle(1, 20), candle(3, 22)], benchmark = [candle(1, 500), candle(2, 505), candle(3, 550)];
    const result = alignComparison(stock, benchmark, { from: 1, to: 3 });
    expect(result.candles.map(c => c.time)).toEqual([1, 3]);
    expect(result.candles.map(c => c.close)).toEqual([500, 550]);
    expect(result.originals.get(3)?.close).toBe(550);
    expect(alignComparison(stock, benchmark, { from: 3, to: 3 }).anchor).toBe(3);
  });
  it("does not invent an anchor with missing or invalid prices", () => {
    expect(alignComparison([candle(1)], [candle(2)], null).candles).toEqual([]);
    expect(alignComparison([candle(1, 0)], [candle(1)], null).anchor).toBeNull();
  });
  it("restores legacy views and validates marker colours", () => {
    const view = tradeViewSchema.parse({ version: 1, arrangement: "left", panels: [{ id: "chart-1", interval: "5m", session: "regular", range: null }] });
    expect(viewPreferences(view).panels?.[0]).toMatchObject({ benchmark: "off", beforeEntry: false });
    expect(executionColors({ buy: "url(evil)", sell: "#123abc" })).toEqual({ buy: "#34d399", sell: "#123abc" });
  });
});
describe("pre-trade metrics", () => {
  const history = () => { const rows: Candle[] = []; let day = previousSession("2026-06-05")!; for (let i = 0; i < 250; i++) { rows.unshift(candle(day.open)); day = previousSession(day.date)!; } return rows; };
  it("uses 14-period ranges and average of daily dollar volumes", () => {
    const rows = history(); rows[rows.length - 1].volume = 2000;
    const result = calculateMarketMetrics("OSCR", "USD", "2026-06-04", rows, "fixture");
    expect(result.adr.value).toBeCloseTo(4); expect(result.atr.value).toBeCloseTo(4); expect(result.atrSessions).toBe(250);
    expect(result.dollarVolume.value).toBe(105000);
  });
  it("includes a price gap in ATR and excludes future data", () => {
    const rows = history(); rows[rows.length - 1] = candle(rows.at(-1)!.time, 120);
    const result = calculateMarketMetrics("OSCR", "USD", "2026-06-04", [...rows, candle(at("2026-06-05T13:30Z"), 900)], "fixture");
    expect(result.adr.value).toBeCloseTo(4 / 120 * 100);
    expect(result.atr.value).toBeCloseTo(((4 * 13 + 22) / 14) / 120 * 100);
  });
  it("does not silently shorten windows or fill missing sessions", () => {
    const rows = history(); const short = calculateMarketMetrics("OSCR", "USD", "2026-06-04", rows.slice(-13), "fixture");
    expect(short.adr.value).toBeNull(); expect(short.atr.value).toBeNull(); expect(short.dollarVolume.value).toBeNull();
    const missing = calculateMarketMetrics("OSCR", "USD", "2026-06-04", rows.filter((_, i) => i !== 248), "fixture");
    expect(missing.adr.value).toBeNull(); expect(missing.atr.value).toBeNull();
    expect(previousSession("2026-05-26")?.date).toBe("2026-05-22");
  });
});
describe("Notion template and export", () => {
  it("archives each image once while keeping section references and separate CSV execution fields", async () => {
    const doc = emptyDocument(), n = doc.review.notion = emptyNotionReview();
    n.properties.idealExecutionOptions = ["Property choice"];
    n.analysis.idealExecution = "<p><u>Narrative plan</u></p>";
    n.sections.entry = { html: "<p>Entry comment</p>", evidenceIds: ["one"] };
    n.sections.index = { html: "", evidenceIds: ["one"] };
    doc.evidence = [{ id: "one", name: "Captured chart", image: "data:image/png;base64,AQID", time: 1, timeframe: "5m", revision: 0 }];
    const rows = [{ trade: trade(), doc, url: "https://example.test/trades" }];
    const zip = unzipSync(new Uint8Array(await (await reviewArchive(rows, exportColumns, {})).arrayBuffer()));
    expect(Object.keys(zip).filter(name => name.endsWith(".png"))).toHaveLength(1);
    const html = strFromU8(Object.entries(zip).find(([name]) => name.endsWith(".html"))![1]);
    expect(html.match(/src="assets\/one.png"/g)).toHaveLength(2);
    expect(html).toContain("<u>Narrative plan</u>");
    expect(reviewCsv(rows, ["Ideal Execution", "Setup Analysis / Ideal Execution"])).toContain('"Property choice","Narrative plan"');
  });
  it("contains all 29 properties and six chart sections", () => { expect(notionProperties).toHaveLength(29); expect(chartSections).toHaveLength(6); });
  it("calculates stop distance only when both inputs exist", () => {
    const n = emptyNotionReview(); expect(stopLossPercent(n)).toBeNull(); n.properties.plannedEntry = 100; n.properties.plannedStop = 95; expect(stopLossPercent(n)).toBe(5);
    n.properties.plannedStop = 105; expect(stopLossPercent(n)).toBe(5);
  });
  it("retains new suggestions, separate ideal execution fields and evidence IDs", () => {
    const n = emptyNotionReview(); n.properties.marketRegime = "Rotation"; n.properties.idealExecutionOptions = ["Custom choice"]; n.analysis.idealExecution = "Wait for confirmation"; n.sections.entry = { html: "<p><u>Context</u></p>", evidenceIds: ["image"] };
    expect(notionReviewSchema.parse(n)).toEqual({ ...n, analysis: { idealExecution: "<p>Wait for confirmation</p>" } });
  });
  it("sanitizes active markup and preserves plain-text comparisons", () => {
    expect(richHtml('<p onclick="bad()">Safe<script>alert(1)</script><img src=x onerror=bad()><u style="color:red">underlined</u></p>')).toBe("<p>Safe<u>underlined</u></p>");
    expect(richPlain("Price < 10 & risk > 2")).toBe("Price < 10 & risk > 2");
  });
  it("copies one shared takeaway into the property and body with formatting", () => {
    const doc = emptyDocument(); doc.review.notion = emptyNotionReview(); doc.review.takeaway = "<ul><li><strong>Wait</strong> for <u>confirmation</u></li></ul>"; doc.review.setup = "Existing legacy setup";
    const result = notionClipboard(trade(), doc, "https://example.test/trades");
    expect(result.html).toContain("<strong>Takeaways:</strong> Wait for confirmation");
    expect(result.html).toContain("<u>confirmation</u>"); expect(result.text).toContain("- **Wait** for <u>confirmation</u>"); expect(result.text).toContain("Existing legacy setup");
    expect(result.html).not.toContain("data:image");
  });
});
