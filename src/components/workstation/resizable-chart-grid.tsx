"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { chartGeometry, defaultChartSizing, restoreChartSizing, sizingKey, type ChartSizing, type Divider } from "@/lib/workstation/chart-sizing";

export function ResizableChartGrid({ count, arrangement, sizing, onChange, children }: { count: number; arrangement: "left" | "top"; sizing?: ChartSizing; onChange(value: ChartSizing): void; children(styles: CSSProperties[]): ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });
  const [draft, setDraft] = useState<ChartSizing | null>(null);
  const value = draft ?? restoreChartSizing(sizing), latest = useRef(value);
  useLayoutEffect(() => { latest.current = value; }, [value]);
  const drag = useRef<{ id: number; coordinate: number; divider: Divider; before: ChartSizing } | null>(null);
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); if (host.current) observer.observe(host.current); return () => observer.disconnect(); }, []);
  const geometry = chartGeometry(size.width, size.height, count, arrangement, value);
  function update(divider: Divider, next: number, commit = false) {
    const changed = restoreChartSizing(latest.current), clamped = Math.max(divider.min, Math.min(divider.max, next));
    if (typeof divider.field === "number") changed.mobile[divider.field] = clamped;
    else changed.layouts[sizingKey(count, arrangement)][divider.field] = clamped;
    latest.current = changed;
    if (commit) { setDraft(null); onChange(changed); } else setDraft(changed);
  }
  function reset(divider: Divider) { const defaults = defaultChartSizing(); update(divider, typeof divider.field === "number" ? defaults.mobile[divider.field] : defaults.layouts[sizingKey(count, arrangement)][divider.field], true); }
  return <div ref={host} className={`ws-chart-grid ws-resizable-grid ws-charts-${count} ws-arrangement-${arrangement}`} data-stacked={geometry.stacked || undefined}>
    <div className="ws-chart-geometry" style={{ height: geometry.height }}>
      {children(geometry.rects.map(r => ({ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height })))}
      {geometry.dividers.map(divider => <div key={divider.id} className={`ws-chart-divider ws-divider-${divider.axis}`} role="separator" tabIndex={0} aria-label={divider.label} aria-orientation={divider.axis === "x" ? "vertical" : "horizontal"} aria-valuemin={Math.round(divider.min * (geometry.stacked ? 1 : 100))} aria-valuemax={Math.round(divider.max * (geometry.stacked ? 1 : 100))} aria-valuenow={Math.round(divider.value * (geometry.stacked ? 1 : 100))} aria-valuetext={geometry.stacked ? `${Math.round(divider.value)} pixels` : `${Math.round(divider.value * 100)} percent`} title={`${divider.label} · Drag or use arrow keys · Double-click to reset`} style={{ left: divider.x, top: divider.y, width: divider.width, height: divider.height }}
        onDoubleClick={() => reset(divider)} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, coordinate: divider.axis === "x" ? event.clientX : event.clientY, divider, before: restoreChartSizing(latest.current) }; }}
        onPointerMove={event => { const active = drag.current; if (!active || active.id !== event.pointerId) return; update(active.divider, active.divider.value + ((active.divider.axis === "x" ? event.clientX : event.clientY) - active.coordinate) / active.divider.extent); }}
        onPointerUp={event => { if (drag.current?.id !== event.pointerId) return; drag.current = null; setDraft(null); onChange(latest.current); event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { if (drag.current) latest.current = drag.current.before; drag.current = null; setDraft(null); }}
        onKeyDown={event => { if (event.key === "Escape" && drag.current) { latest.current = drag.current.before; drag.current = null; setDraft(null); event.preventDefault(); event.stopPropagation(); return; } if (event.key === "Enter") { event.preventDefault(); reset(divider); return; } const keys = divider.axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]; if (!keys.includes(event.key) && !["Home", "End"].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const step = geometry.stacked ? event.shiftKey ? 100 : 20 : event.shiftKey ? .1 : .02; update(divider, event.key === "Home" ? divider.min : event.key === "End" ? divider.max : divider.value + (event.key === keys[0] ? -step : step), true); }}
      ><span /></div>)}
    </div>
  </div>;
}
