import { expect, it } from "vitest";
import { drawingSchema, workstationDocumentSchema } from "./schema";
import { emptyDocument, type Drawing } from "./types";
import { matchesDrawingTarget, projectDrawing, supportsBenchmarkDrawing } from "./drawing-target";
import type { SplitAdjustment } from "./split-adjustment";
import { beforeEntryDrawings } from "./before-entry";
import { visibleDrawings } from "./math";

const drawing: Drawing = { id: "level", tool: "ray", points: [{ time: 100, price: 500 }], text: "Index support", color: "#123456", width: 1.5, dashed: false, locked: false, hidden: false, panel: "chart-1", createdAt: 100 };
it("preserves old drawings and index targets across document serialization and validation", () => {
  const doc = { ...emptyDocument(), drawings: [drawing, { ...drawing, id: "index", target: { kind: "benchmark", symbol: "SPY" } }] };
  expect(workstationDocumentSchema.parse(JSON.parse(JSON.stringify(doc))).drawings).toEqual(doc.drawings);
  expect(drawingSchema.parse(drawing)).not.toHaveProperty("target");
});
it("only accepts the three supported index tools and known index identities", () => {
  for (const tool of ["text", "ray", "horizontal"] as const) expect(drawingSchema.safeParse({ ...drawing, tool, target: { kind: "benchmark", symbol: "QQQ" } }).success).toBe(true);
  for (const tool of ["trend", "measure", "pin"] as const) expect(drawingSchema.safeParse({ ...drawing, tool, points: [...drawing.points, ...drawing.points], target: { kind: "benchmark", symbol: "SPY" } }).success).toBe(false);
  expect(drawingSchema.safeParse({ ...drawing, target: { kind: "benchmark", symbol: "NVDA" } }).success).toBe(false);
  expect(supportsBenchmarkDrawing("price-note")).toBe(false);
});
it("isolates stock and index split projection and round-trips an edited index anchor", () => {
  const stock: SplitAdjustment = { version: 1, asOf: "2025-01-01", splits: [{ time: 200, ratio: 10 }] };
  const index: SplitAdjustment = { ...stock, splits: [{ time: 200, ratio: 2 }] };
  const target = { kind: "benchmark" as const, symbol: "SPY" as const };
  expect(projectDrawing(drawing, stock).points[0].price).toBe(50);
  const displayed = projectDrawing({ ...drawing, target }, stock, { symbol: "SPY", ready: true, adjustment: index });
  expect(displayed.points[0].price).toBe(250);
  expect(projectDrawing(displayed, stock, { symbol: "SPY", ready: true, adjustment: index }, true).points).toEqual(drawing.points);
  expect(projectDrawing({ ...drawing, target }, stock, { symbol: "QQQ", ready: true, adjustment: stock }).points[0].price).toBe(500);
  expect(projectDrawing({ ...drawing, target }, stock, { symbol: "SPY", ready: false, adjustment: index }).points[0].price).toBe(500);
  expect(matchesDrawingTarget(drawing, target)).toBe(false);
  expect(matchesDrawingTarget({ ...drawing, target })).toBe(false);
  expect(matchesDrawingTarget({ ...drawing, target }, { ...target, symbol: "QQQ" })).toBe(false);
});
it("retains panel, replay and before-entry boundaries for targeted notes", () => {
  const index: Drawing = { ...drawing, target: { kind: "benchmark", symbol: "SPY" } };
  expect(visibleDrawings([index], "chart-2", null)).toEqual([]);
  expect(visibleDrawings([index], "chart-1", 99)).toEqual([]);
  expect(visibleDrawings([index], "chart-1", 100)).toEqual([index]);
  const candles = [{ time: 100, open: 500, high: 501, low: 499, close: 500, volume: 1 }];
  const future = { ...index, id: "future", points: [{ time: 10000, price: 500 }] };
  expect(beforeEntryDrawings([index, future], candles, "5m")).toEqual([index]);
});
