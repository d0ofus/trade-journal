"use client";
import { useState } from "react";
import type { PeerFrameSize } from "@/lib/workstation/peer-arrangement";

export function PeerFrameSizeEditor({ symbol, size, maximumWidth, narrow, disabled, onCommit }: { symbol: string; size: PeerFrameSize; maximumWidth: number; narrow: boolean; disabled: boolean; onCommit: (size: PeerFrameSize) => void }) {
  const [draft, setDraft] = useState({ width: String(size.width), height: String(size.height) });
  const reset = () => setDraft({ width: String(size.width), height: String(size.height) });
  const commit = () => {
    const width = Number(draft.width), height = Number(draft.height);
    if (!draft.width || !draft.height || !Number.isFinite(width) || !Number.isFinite(height)) { reset(); return; }
    if (width !== size.width || height !== size.height) onCommit({ width, height });
  };
  return <fieldset className="ws-peer-frame-editor" disabled={disabled}><legend>{symbol} · Frame size</legend>
    {(["width", "height"] as const).map(field => <label key={field}>{field === "width" ? "Width" : "Height"} (px)<input aria-label={`${symbol} frame ${field}`} type="number" min={field === "width" ? Math.min(320, maximumWidth) : 240} max={field === "width" ? maximumWidth : 1200} step={1} disabled={field === "width" && narrow} value={draft[field]} onChange={event => setDraft(value => ({ ...value, [field]: event.target.value }))} onBlur={commit} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); reset(); }
      if (event.key === "Enter") { event.preventDefault(); commit(); }
    }} /></label>)}
    <p>Drag the frame corner or use its arrow keys. Shift makes larger steps.</p>
  </fieldset>;
}
