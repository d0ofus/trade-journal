import type { Drawing, DrawingStyle } from "@/lib/workstation/types";
import { defaultNoteWidth, positivePercentColor, negativePercentColor } from "@/lib/workstation/drawing-style";

export function DrawingTextControls({ tool, value, onChange, disabled = false, defaults = false }: {
  tool: Drawing["tool"]; value: DrawingStyle; onChange: (patch: Partial<DrawingStyle>) => void; disabled?: boolean; defaults?: boolean;
}) {
  const prefix = defaults ? "Default " : "";
  if (tool === "measure") return <>
    <label><span>{prefix}Positive percentage colour</span><input type="color" aria-label={`${prefix}Positive percentage colour`} disabled={disabled} value={value.positivePercentColor ?? positivePercentColor} onChange={e => onChange({ positivePercentColor: e.target.value })} /></label>
    <label><span>{prefix}Negative percentage colour</span><input type="color" aria-label={`${prefix}Negative percentage colour`} disabled={disabled} value={value.negativePercentColor ?? negativePercentColor} onChange={e => onChange({ negativePercentColor: e.target.value })} /></label>
  </>;
  if (tool === "text" || tool === "price-note") return <label><span>{prefix}Note width</span><input type="number" aria-label={`${prefix}Note width`} title="Text wraps within this width. Drag the box’s outer edge to resize." min={80} max={800} step={10} value={value.noteWidth ?? defaultNoteWidth} disabled={disabled} onChange={e => { const width = Number(e.target.value); if (width >= 80 && width <= 800) onChange({ noteWidth: width }); }} /></label>;
  return null;
}
