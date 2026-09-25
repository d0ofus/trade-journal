import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { Candle, Drawing, Point, Tool, Trade, WorkspacePreferences } from "@/lib/workstation/types";
import type { PeerView } from "@/lib/workstation/peers";
import { peerChartData } from "@/lib/workstation/peers";
import { logicalTimeIndex, visibleDrawings } from "@/lib/workstation/math";
import { timeAtLogical, translateMeasurement } from "@/lib/workstation/measurement-drag";
import { beforeEntryDrawings } from "@/lib/workstation/before-entry";
import { splitAdjustedDrawing, type SplitAdjustment } from "@/lib/workstation/split-adjustment";
import { drawingStyleFor } from "@/lib/workstation/drawing-style";
import { hitAt, paintChart, type Hit, type PaintOptions } from "./chart-paint";

export type PeerDrawingControls = {
  active: boolean; tool: Tool; selected: string | null; drawings: Drawing[];
  hidden: ReadonlySet<string>; readOnly: boolean; adjustment?: SplitAdjustment;
  adjustmentReady: boolean; context: string;
  select: (id: string | null) => void; activate: () => void;
  commit: (drawing: Drawing) => void; edit: (id: string) => void; done: () => void;
};

/** Shared renderer, raw/display projection and logical-bar translation, with modal-local commands. */
export function createPeerDrawingLayer(node: HTMLElement, chart: IChartApi, price: ISeriesApi<"Candlestick">,
  get: () => { controls: PeerDrawingControls; candles: Candle[]; view: PeerView; trade: Trade; preferences: WorkspacePreferences }) {
  const canvas = document.createElement("canvas"), pins = document.createElement("div");
  canvas.className = "ws-peer-drawing-canvas"; pins.className = "ws-peer-pins";
  canvas.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3";
  pins.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4";
  node.append(canvas, pins);
  let hits: Hit[] = [], draft: Drawing | null = null, pending: Point | null = null, pinPreview: string | null = null, frame = 0, context = "", tool: Tool = "cursor";
  let drag: { drawing: Drawing; point?: number; resizeNote?: { width: number; direction: 1 | -1 }; start: { x: number; y: number }; offset?: { x: number; y: number }; candles: Candle[] } | null = null;
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const position = (event: PointerEvent | MouseEvent) => { const bounds = node.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }; };
  const adjusted = () => { const p = get(); return p.controls.drawings.map(d => splitAdjustedDrawing(d, p.view.adjustment === "split" ? p.controls.adjustment : undefined)); };
  const filtered = () => {
    const p = get();
    if (p.view.adjustment === "split" && !p.controls.adjustmentReady) return [];
    const drawings = [...adjusted().filter(d => d.id !== draft?.id), ...draft ? [draft] : []];
    const session = peerChartData([], p.trade, p.view).session;
    return visibleDrawings(p.view.beforeEntry ? beforeEntryDrawings(drawings, p.candles, p.view.interval, session) : drawings, "comparison", p.view.replayAt ?? null, p.controls.hidden);
  };
  const snapshot = (): PaintOptions => {
    const p = get();
    return { width: node.clientWidth, height: node.clientHeight, plotWidth: chart.timeScale().width(), plotHeight: node.clientHeight - chart.timeScale().height(), x: time => chart.timeScale().logicalToCoordinate(logicalTimeIndex(time, p.candles, p.view.interval) as never), y: value => price.priceToCoordinate(value),
      drawings: structuredClone(filtered()), trade: { ...p.trade, executions: [] }, candles: [...p.candles], interval: p.view.interval, session: peerChartData([], p.trade, p.view).session, labels: "hidden", selected: p.controls.active ? p.controls.selected : null, selectedExecution: null, light: p.preferences.theme === "light", replay: p.view.replayAt ?? null, beforeEntry: p.view.beforeEntry, pinPreview, capturePinNotes: p.preferences.capturePinNotes };
  };
  const draw = () => {
    frame = 0;
    const p = get();
    if (context !== p.controls.context || tool !== (p.controls.active ? p.controls.tool : "cursor")) { draft = null; drag = null; pending = null; context = p.controls.context; tool = p.controls.active ? p.controls.tool : "cursor"; }
    const ratio = devicePixelRatio || 1, width = node.clientWidth, height = node.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; }
    const ctx = canvas.getContext("2d")!; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    hits = paintChart(ctx, snapshot());
    const visiblePins = filtered().filter(d => d.tool === "pin");
    for (const button of Array.from(pins.children) as HTMLButtonElement[]) if (!visiblePins.some(d => d.id === button.dataset.id)) button.remove();
    for (const pin of visiblePins) {
      const hit = hits.find(h => h.id === pin.id && h.kind === "drawing" && h.point === undefined);
      let button = Array.from(pins.children).find(b => (b as HTMLElement).dataset.id === pin.id) as HTMLButtonElement | undefined;
      if (!button) {
        button = document.createElement("button"); button.type = "button"; button.dataset.id = pin.id; button.className = "ws-peer-pin-target";
        button.onfocus = () => { pinPreview = pin.id; schedule(); }; button.onblur = () => { pinPreview = null; schedule(); };
        button.onclick = () => { get().controls.activate(); get().controls.select(pin.id); pinPreview = pin.id; schedule(); };
        button.onkeydown = event => { if (event.key === "F2" && !get().controls.readOnly && !pin.locked) { stop(event); get().controls.edit(pin.id); } };
        // Pointer handling is owned by the chart layer; keyboard focus is provided here.
        button.style.pointerEvents = "none"; pins.append(button);
      }
      button.setAttribute("aria-label", `Pin: ${pin.text || "Empty note"}`); button.hidden = !hit;
      if (hit) Object.assign(button.style, { position: "absolute", left: `${hit.x}px`, top: `${hit.y}px`, width: `${hit.w}px`, height: `${hit.h}px`, opacity: "0" });
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const cancel = () => { drag = null; draft = null; pending = null; schedule(); };
  const pointAt = (pos: { x: number; y: number }, free = false): Point | null => {
    const p = get(), logical = chart.timeScale().coordinateToLogical(pos.x), value = price.coordinateToPrice(pos.y);
    if (logical == null || value == null || !p.candles.length) return null;
    const maximum = p.view.beforeEntry || p.view.replayAt !== undefined ? p.candles.length - 1 : Infinity;
    if (free && !p.preferences.magnet) return { time: Math.max(0, timeAtLogical(Math.min(logical, maximum), p.candles, p.view.interval)), price: value };
    const candle = p.candles[Math.max(0, Math.min(p.candles.length - 1, Math.round(logical)))];
    return { time: candle.time, price: p.preferences.magnet ? [candle.open, candle.high, candle.low, candle.close].sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0] : Math.round(value * 10000) / 10000 };
  };
  const commit = (drawing: Drawing) => { const p = get(); p.controls.commit(splitAdjustedDrawing(drawing, p.view.adjustment === "split" ? p.controls.adjustment : undefined, true)); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const p = get(), pos = position(event), hit = hitAt(hits, pos);
    node.focus({ preventScroll: true });
    p.controls.activate();
    if (pos.x > chart.timeScale().width() || pos.y > node.clientHeight - chart.timeScale().height()) return;
    if (tool === "cursor") {
      if (!hit) { p.controls.select(null); return; }
      stop(event); p.controls.select(hit.id);
      let drawing = adjusted().find(d => d.id === hit.id);
      if (drawing?.tool === "pin") { pinPreview = pinPreview === drawing.id ? null : drawing.id; schedule(); }
      if (!drawing || drawing.locked || p.controls.readOnly || !p.controls.adjustmentReady) return;
      if (hit.point === 1 && !drawing.points[1] && hit.anchor) { const point = pointAt(hit.anchor, true); if (point) drawing = { ...drawing, points: [...drawing.points, point] }; }
      drag = { drawing, point: hit.point, resizeNote: hit.resizeNote, start: pos, candles: [...p.candles], offset: hit.anchor ? { x: pos.x - hit.anchor.x, y: pos.y - hit.anchor.y } : undefined };
      node.setPointerCapture(event.pointerId); return;
    }
    if (p.controls.readOnly || !p.controls.adjustmentReady) return;
    stop(event); const point = pointAt(pos); if (!point) return;
    const two = ["trend", "arrow", "zone", "measure", "long", "short"].includes(tool);
    const drawing: Drawing = { id: crypto.randomUUID(), tool, points: pending ? [pending, point] : two ? [point, point] : [point], text: "", ...drawingStyleFor(tool, p.preferences.drawingStyles), panel: null, locked: false, hidden: false, createdAt: p.view.replayAt ?? Date.now() / 1000 };
    if (two && !pending) { pending = point; draft = drawing; schedule(); return; }
    if (["long", "short"].includes(tool)) drawing.points.push({ time: point.time, price: drawing.points[0].price - (tool === "long" ? 1 : -1) * Math.abs(point.price - drawing.points[0].price) / 2 });
    commit(drawing); p.controls.select(drawing.id); cancel(); if (!p.preferences.keepTool) p.controls.done();
    if (["text", "pin", "price-note"].includes(tool)) p.controls.edit(drawing.id);
  };
  const move = (event: PointerEvent) => {
    const p = get(), pos = position(event);
    if (!drag && !pending) { const hit = hitAt(hits, pos), pin = adjusted().find(d => d.id === hit?.id && d.tool === "pin"); if (event.pointerType !== "touch") pinPreview = pin?.id ?? null; schedule(); return; }
    stop(event);
    if (drag) {
      if (Math.hypot(pos.x - drag.start.x, pos.y - drag.start.y) < 3 && !draft) return;
      if (drag.resizeNote) {
        draft = { ...drag.drawing, noteWidth: Math.max(80, Math.min(800, Math.round(drag.resizeNote.width + (pos.x - drag.start.x) * drag.resizeNote.direction))) };
      } else if (drag.point !== undefined) {
        const point = pointAt(drag.offset ? { x: pos.x - drag.offset.x, y: pos.y - drag.offset.y } : pos, !!drag.offset);
        if (point) draft = { ...drag.drawing, points: drag.drawing.points.map((old, i) => i === drag!.point ? point : old) };
      } else {
        const logical = chart.timeScale().coordinateToLogical(pos.x), start = chart.timeScale().coordinateToLogical(drag.start.x), value = price.coordinateToPrice(pos.y), startPrice = price.coordinateToPrice(drag.start.y);
        if (logical == null || start == null || value == null || startPrice == null) return;
        let dx = logical - start, dy = value - startPrice;
        if (p.preferences.magnet) { const reference = drag.drawing.points[0], index = logicalTimeIndex(reference.time, drag.candles, p.view.interval), snapped = Math.max(0, Math.min(drag.candles.length - 1, Math.round(index + dx))), bar = drag.candles[snapped]; dx = snapped - index; dy = [bar.open, bar.high, bar.low, bar.close].sort((a, b) => Math.abs(a - reference.price - dy) - Math.abs(b - reference.price - dy))[0] - reference.price; }
        draft = { ...drag.drawing, points: translateMeasurement(drag.drawing.points, drag.candles, p.view.interval, dx, dy, p.view.beforeEntry || p.view.replayAt !== undefined ? drag.candles.at(-1)?.time : undefined) };
      }
    } else if (pending && draft) { const point = pointAt(pos); if (point) draft = { ...draft, points: [pending, point] }; }
    schedule();
  };
  const up = (event: PointerEvent) => { if (drag) { stop(event); if (draft) commit(draft); drag = null; draft = null; if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); schedule(); } };
  const double = (event: MouseEvent) => { const p = get(), hit = hitAt(hits, position(event)), drawing = adjusted().find(d => d.id === hit?.id); if (drawing && !drawing.locked && !p.controls.readOnly) { stop(event); p.controls.select(drawing.id); p.controls.edit(drawing.id); } };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && (draft || drag || pending)) { stop(event); cancel(); } };
  node.addEventListener("pointerdown", down, true); node.addEventListener("pointermove", move, true); node.addEventListener("pointerup", up, true); node.addEventListener("pointercancel", cancel); node.addEventListener("dblclick", double, true); node.addEventListener("keydown", key, true); node.addEventListener("wheel", schedule);
  chart.timeScale().subscribeVisibleLogicalRangeChange(schedule); chart.subscribeCrosshairMove(schedule);
  const resize = new ResizeObserver(schedule); resize.observe(node); draw();
  return { draw: schedule, snapshot, cancel, dispose() { cancelAnimationFrame(frame); resize.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); chart.unsubscribeCrosshairMove(schedule); node.removeEventListener("pointerdown", down, true); node.removeEventListener("pointermove", move, true); node.removeEventListener("pointerup", up, true); node.removeEventListener("pointercancel", cancel); node.removeEventListener("dblclick", double, true); node.removeEventListener("keydown", key, true); node.removeEventListener("wheel", schedule); canvas.remove(); pins.remove(); } };
}
