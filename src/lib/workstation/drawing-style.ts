import { drawingTools, type Drawing, type DrawingStyle, type DrawingStyles } from "./types";

const builtInStyle = { color: "#a5b4fc", width: 1.5, dashed: false };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Validate and copy only appearance fields; never copy a drawing's content or anchors. */
export function drawingStyle(tool: Drawing["tool"], value?: unknown): DrawingStyle {
  const fallback = { ...builtInStyle, ...(tool === "ray" ? { showDefaultLabel: true } : {}) };
  if (!record(value) || typeof value.color !== "string" || !/^#[a-f\d]{6}$/i.test(value.color)
    || typeof value.width !== "number" || !Number.isFinite(value.width) || value.width < .5 || value.width > 4
    || typeof value.dashed !== "boolean"
    || (tool === "ray" && value.showDefaultLabel !== undefined && typeof value.showDefaultLabel !== "boolean")) return fallback;
  return { color: value.color, width: value.width, dashed: value.dashed,
    ...(tool === "ray" ? { showDefaultLabel: value.showDefaultLabel !== false } : {}) };
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
