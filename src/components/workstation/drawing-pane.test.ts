import { expect, it } from "vitest";
import type { IChartApi } from "lightweight-charts";
import { drawingPane, insideDrawingPane, panePoint, offsetPaneHits } from "./drawing-pane";
import { hitAt, type Hit } from "./chart-paint";

it("uses the actual native pane offset including separators", () => {
  const paneNode = { getBoundingClientRect: () => ({ top: 412.5 }) }, host = { getBoundingClientRect: () => ({ top: 100 }) };
  const api = { panes: () => [{}, { getHTMLElement: () => paneNode }], paneSize: () => ({ height: 140 }), timeScale: () => ({ width: () => 700 }) };
  const pane = drawingPane(api as unknown as IChartApi, 1, host as HTMLElement)!;
  expect(pane).toEqual({ top: 312.5, height: 140, width: 700 });
  expect(insideDrawingPane({ x: 10, y: 310 }, pane)).toBe(false);
  expect(insideDrawingPane({ x: 700, y: 350 }, pane)).toBe(false);
  expect(insideDrawingPane({ x: 10, y: 452.5 }, pane)).toBe(false);
  expect(panePoint({ x: 750, y: 200 }, pane)).toEqual({ x: 699, y: 0 });
  expect(panePoint({ x: 10, y: 600 }, pane)).toEqual({ x: 10, y: 139 });
});
it("translates line segments, note anchors and handles together for hit testing", () => {
  const hit: Hit = { id: "index-ray", kind: "drawing", x: 20, y: 35, w: 200, h: 10, anchor: { x: 20, y: 40 }, segment: [{ x: 20, y: 40 }, { x: 220, y: 40 }] };
  const [translated] = offsetPaneHits([hit], 300.5);
  expect(translated.anchor?.y).toBe(340.5);
  expect(hitAt([translated], { x: 100, y: 340.5 })?.id).toBe("index-ray");
  expect(hitAt([translated], { x: 100, y: 40 })).toBeUndefined();
  expect(hit.y).toBe(35);
});
