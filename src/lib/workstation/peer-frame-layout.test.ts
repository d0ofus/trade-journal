import { describe, expect, it } from "vitest";
import { constrainPeerFrame, layoutPeerFrames, peerTimeAtLogical, visiblePeerFrames } from "./peer-frame-layout";
import { arrangePeers } from "./peer-arrangement";
import { workstationDocumentSchema } from "./schema";
import { emptyDocument, type Candle } from "./types";
import { peerHistoryResults } from "./peer-history-results";
import type { PeerSeries } from "./peers";

describe("resizable peer frames", () => {
  it("defaults to three, two or one equal columns and gives the primary an ordinary frame", () => {
    for (const [width, columns] of [[1800, 3], [1000, 2], [390, 1]]) {
      const layout = layoutPeerFrames(["PRIMARY", "A", "B", "C"], width);
      expect(layout.rows[0].end).toBe(columns);
      expect(layout.rects[0].height).toBe(328);
      expect(layout.rects[0].width).toBe(layout.rects[1].width);
      expect(layout.rects.at(-1)!.y + 328).toBe(layout.height);
    }
  });
  it("wraps unequal frames in order without overlap and virtualizes actual row heights", () => {
    const layout = layoutPeerFrames(["P", "A", "B", "C", "D"], 1200, { P: { width: 500, height: 700 }, A: { width: 500, height: 240 }, B: { width: 900, height: 400 } });
    expect(layout.rects.map(rect => [rect.symbol, rect.x, rect.y])).toEqual([["P", 0, 0], ["A", 512, 0], ["B", 0, 712], ["C", 0, 1124], ["D", 404, 1124]]);
    expect(visiblePeerFrames(layout, 750, 200, ["P"]).map(rect => rect.symbol)).toEqual(["P", "B", "C", "D"]);
    for (const a of layout.rects) for (const b of layout.rects) if (a !== b) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  });
  it("clamps display sizes without mutating saved desktop widths", () => {
    const sizes = { P: { width: 1000, height: 800 } };
    expect(layoutPeerFrames(["P"], 390, sizes).rects[0]).toMatchObject({ width: 390, height: 800 });
    expect(layoutPeerFrames(["P"], 1800, sizes).rects[0].width).toBe(1000);
    expect(sizes.P.width).toBe(1000);
    expect(constrainPeerFrame({ width: 1, height: 9000 }, 1000)).toEqual({ width: 320, height: 1200 });
    expect(constrainPeerFrame({ width: 9000, height: 1 }, 250)).toEqual({ width: 250, height: 240 });
  });
  it("keeps a 20,000-member group bounded to visible and overscan rows plus retained charts", () => {
    const symbols = Array.from({ length: 20000 }, (_, index) => String(index));
    const layout = layoutPeerFrames(symbols, 1800);
    const mounted = visiblePeerFrames(layout, 500000, 900, ["0", "19"]);
    expect(mounted.length).toBeLessThanOrEqual(17);
    expect(mounted.map(rect => rect.symbol)).toEqual(expect.arrayContaining(["0", "19"]));
    expect(layout.rects).toHaveLength(20000);
  });
  it("round-trips optional sizes in schema 1, with independent group layouts and legacy readers", () => {
    const comparison = { drawings: {}, arrangements: { first: { order: ["A"], hidden: [], sizes: { P: { width: 800, height: 500 }, A: { width: 500, height: 328 } } }, legacy: { order: ["A"], hidden: [] } } };
    const parsed = workstationDocumentSchema.parse({ ...emptyDocument(), comparison });
    expect(parsed.schema).toBe(1); expect(parsed.comparison).toEqual(comparison);
    expect(arrangePeers([{ ticker: "A" }, { ticker: "NEW" }], comparison.arrangements.first).map(member => member.ticker)).toEqual(["A", "NEW"]);
    for (const size of [{ width: 319, height: 328 }, { width: Infinity, height: 328 }, { width: 400, height: 1201 }, { width: 400.5, height: 328 }]) expect(workstationDocumentSchema.safeParse({ ...emptyDocument(), comparison: { ...comparison, arrangements: { invalid: { order: [], hidden: [], sizes: { P: size } } } } }).success).toBe(false);
  });
  it("interpolates actual trading timestamps and estimates request bounds across gaps without creating bars", () => {
    const candles = [100000, 186400, 445600].map(time => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 })) satisfies Candle[];
    expect(peerTimeAtLogical(1.5, candles, "1d")).toBe(316000);
    expect(peerTimeAtLogical(-.5, candles, "1d")).toBe(13600);
    expect(candles).toHaveLength(3);
  });
  it("retains completed candles on retrieval failure and clears the warning after successful retry", () => {
    const ready: PeerSeries = { symbol: "P", candles: [{ time: 100, open: 1, high: 2, low: 1, close: 2, volume: 10 }], status: "ready", source: "mock", identity: "same", range: { from: 100, to: 200 }, adjustment: "split", feed: "mock" };
    const failed = { ...ready, candles: [], status: "error" as const, error: "Provider cooldown" };
    expect(peerHistoryResults([failed], { P: ready })).toEqual({ values: { P: ready }, failures: { P: "Provider cooldown" } });
    const retried = { ...ready, range: { from: 50, to: 200 } };
    expect(peerHistoryResults([retried], { P: ready })).toEqual({ values: { P: retried }, failures: {} });
    expect(peerHistoryResults([{ ...failed, symbol: "NEW" }], { P: ready }).values.NEW.status).toBe("error");
    expect(peerHistoryResults([{ ...ready, status: "empty", candles: [] }], { P: ready }).values.P.status).toBe("empty");
  });
});
