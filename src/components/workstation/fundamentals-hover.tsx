"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { fundamentalPercent, fundamentalPeriod, type FundamentalQuarter } from "@/lib/workstation/fundamentals";

type Metric = "revenue" | "netIncome";
type Selection = {
  quarters: FundamentalQuarter[];
  index: number;
  x: number;
  y: number;
  target: SVGRectElement;
};
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const percent = (value: number | null) => value == null ? "Unavailable" : fundamentalPercent(value);

function QuarterTooltip({ selection, metric, id }: { selection: Selection; metric?: Metric; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const host = selection.target.closest("dialog") ?? document.body;
  useLayoutEffect(() => {
    const tip = ref.current!;
    const dialog = selection.target.closest("dialog")?.getBoundingClientRect();
    const left = Math.max(8, (dialog?.left ?? 0) + 8);
    const right = Math.min(window.innerWidth - 8, (dialog?.right ?? window.innerWidth) - 8);
    const top = Math.max(8, (dialog?.top ?? 0) + 8);
    const bottom = Math.min(window.innerHeight - 8, (dialog?.bottom ?? window.innerHeight) - 8);
    tip.style.maxWidth = `${Math.max(0, right - left)}px`;
    tip.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const box = tip.getBoundingClientRect();
    setPosition({
      left: Math.max(left, Math.min(selection.x + 14, right - box.width)),
      top: Math.max(top, Math.min(selection.y + 16 + box.height <= bottom ? selection.y + 16 : selection.y - box.height - 16, bottom - box.height)),
    });
  }, [selection]);
  const quarter = selection.quarters[selection.index];
  const metrics: Metric[] = metric ? [metric] : ["revenue", "netIncome"];
  return createPortal(<div ref={ref} id={id} role="tooltip" aria-live="polite" className="ws-fundamentals-tooltip" style={{ ...position, visibility: position ? "visible" : "hidden" }}>
    <strong>{fundamentalPeriod(quarter)}</strong>
    <div className="ws-fundamentals-tooltip-date">Period ended {quarter.periodEnd}</div>
    {metrics.map(name => <div className="ws-fundamentals-tooltip-metric" key={name}>
      <div className="ws-fundamentals-tooltip-value"><span className={`ws-fundamentals-tooltip-${name}`}>{name === "revenue" ? "Revenue" : "Net income"}</span><b>{quarter[name] == null ? "Unavailable" : dollars.format(quarter[name].value)}</b></div>
      {quarter[name]?.derived && <small>Derived Q4</small>}
      <dl><div><dt>YoY</dt><dd>{percent(quarter[name === "revenue" ? "revenueYoY" : "netIncomeYoY"])}</dd></div><div><dt>QoQ</dt><dd>{percent(quarter[name === "revenue" ? "revenueQoQ" : "netIncomeQoQ"])}</dd></div></dl>
    </div>)}
  </div>, host);
}

/** UI-only selection. Keeping the source array on the selection immediately invalidates old data. */
export function useFundamentalsHover(quarters: FundamentalQuarter[], metric?: Metric) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const id = useId();
  const active = selection?.quarters === quarters ? selection : null;
  useEffect(() => {
    if (!active) return;
    const dismiss = () => setSelection(null);
    const outside = (event: globalThis.PointerEvent) => { if (event.target !== active.target) dismiss(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
    };
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [active]);
  const fromPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(quarters.length - 1, Math.floor((event.clientX - box.left) / box.width * quarters.length)));
    setSelection({ quarters, index, x: event.clientX, y: event.clientY, target: event.currentTarget });
  };
  const fromKeyboard = (target: SVGRectElement, index: number) => {
    const box = target.getBoundingClientRect();
    setSelection({ quarters, index, x: box.left + box.width * (index + .5) / quarters.length, y: box.top + box.height / 2, target });
  };
  return {
    index: active?.index ?? null,
    tooltip: active && <QuarterTooltip selection={active} metric={metric} id={id} />,
    hitArea: (label: string, bounds: { x: number; y: number; width: number; height: number }) => quarters.length ? <rect
      {...bounds} className="ws-fundamentals-hit-area" fill="transparent" tabIndex={0} role="group"
      aria-label={`${label}. Use Left and Right arrow keys to inspect quarters.`}
      aria-describedby={active ? id : undefined}
      onPointerMove={event => { if (event.pointerType !== "touch") fromPointer(event); }}
      onPointerDown={event => { event.currentTarget.focus({ preventScroll: true }); fromPointer(event); }}
      onPointerLeave={event => { if (event.pointerType !== "touch") setSelection(null); }}
      onPointerCancel={() => setSelection(null)}
      onFocus={event => fromKeyboard(event.currentTarget, active?.index ?? 0)}
      onBlur={() => setSelection(null)}
      onKeyDown={event => {
        const index = active?.index ?? 0;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          fromKeyboard(event.currentTarget, event.key === "Home" ? 0 : event.key === "End" ? quarters.length - 1 : Math.max(0, Math.min(quarters.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }}
    /> : null,
  };
}
