import type { Drawing, Tool } from "./types";
import { splitAdjustedDrawing, type SplitAdjustment } from "./split-adjustment";

export type BenchmarkDrawingContext = { symbol: "SPY" | "QQQ"; ready: boolean; adjustment?: SplitAdjustment };
export const supportsBenchmarkDrawing = (tool: Tool) => tool === "text" || tool === "ray" || tool === "horizontal";
export const drawingTargetLabel = (drawing: Drawing) => drawing.target ? `${drawing.target.symbol} · Index pane` : "";
export const matchesDrawingTarget = (drawing: Drawing, target?: Drawing["target"]) => target ? drawing.target?.symbol === target.symbol : !drawing.target;
export function projectDrawing(drawing: Drawing, stock?: SplitAdjustment, benchmark?: BenchmarkDrawingContext | null, inverse = false): Drawing {
  const adjustment = drawing.target ? benchmark?.ready && benchmark.symbol === drawing.target.symbol ? benchmark.adjustment : undefined : stock;
  return splitAdjustedDrawing(drawing, adjustment, inverse);
}
