import { drawingTools, type Drawing, type DrawingStyle, type DrawingStyles } from "./types";

const builtInStyle = { color: "#a5b4fc", width: 1.5, dashed: false };
export const positivePercentColor = "#22c55e", negativePercentColor = "#ef4444";
export const defaultNoteWidth = 240;
export const validDrawingColor = (value: unknown): value is string => typeof value === "string" && /^#[a-f\d]{6}$/i.test(value);
export function extendedDrawingStyle(tool: Drawing["tool"], value?: Record<string, unknown>) {
  if (tool === "measure") return {
    positivePercentColor: validDrawingColor(value?.positivePercentColor) ? value.positivePercentColor : positivePercentColor,
    negativePercentColor: validDrawingColor(value?.negativePercentColor) ? value.negativePercentColor : negativePercentColor,
  };
  if (tool === "text" || tool === "price-note") return { noteWidth: typeof value?.noteWidth === "number" && Number.isFinite(value.noteWidth) && value.noteWidth >= 80 && value.noteWidth <= 800 ? value.noteWidth : defaultNoteWidth };
  return {};
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate and copy only appearance fields; never copy a drawing's content or anchors. */
export function drawingStyle(tool: Drawing["tool"], value?: unknown): DrawingStyle {
  const flags = tool === "ray" ? { showDefaultLabel: true }
    : tool === "measure" ? { extendLeft: false, extendRight: false, showValues: true, showPercent: true, showInterval: true, showBars: true }
    : tool === "entry" || tool === "exit" ? { showPrice: true } : {};
  const fallback = { ...builtInStyle, ...flags, ...extendedDrawingStyle(tool),
    ...(tool === "entry" ? { color: "#22c55e" } : tool === "exit" ? { color: "#ef4444" } : {}) };
  if (!record(value) || typeof value.color !== "string" || !/^#[a-f\d]{6}$/i.test(value.color)
    || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width < .5 || value.width > 4
    || typeof value.dashed !== "boolean"
    || Object.keys(flags).some(key => value[key] !== undefined && typeof value[key] !== "boolean")) return fallback;
  return { color: value.color, width: value.width, dashed: value.dashed, ...extendedDrawingStyle(tool, value),
    ...(tool === "ray" ? { showDefaultLabel: value.showDefaultLabel !== false } : {}),
    ...(tool === "measure" ? { extendLeft: value.extendLeft === true, extendRight: value.extendRight === true, showValues: value.showValues !== false, showPercent: value.showPercent !== false, showInterval: value.showInterval !== false, showBars: value.showBars !== false } : {}),
    ...(tool === "entry" || tool === "exit" ? { showPrice: value.showPrice !== false } : {}) };
}

export function drawingStyleFor(tool: Drawing["tool"], styles: DrawingStyles): DrawingStyle {
  return drawingStyle(tool, styles[tool]);
}

/** Only an absent map migrates the legacy shared style. A present map is authoritative. */
export function restoreDrawingStyles(value: unknown, legacyStyle?: unknown): DrawingStyles {
  const styles: DrawingStyles = {};
  for (const tool of drawingTools) {
    if (tool !== "cursor") styles[tool] = drawingStyle(tool,
      value === undefined ? legacyStyle : record(value) ? value[tool] : undefined);
  }
  return styles;
}
