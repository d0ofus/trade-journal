import { Candle, CandleSession, Drawing, Interval, Trade, WorkspacePreferences } from "@/lib/workstation/types";
import { executionVisibility } from "@/lib/workstation/execution-visibility";
import type { CandleRange } from "@/lib/workstation/candle-ranges";
import { measureText, riskReward } from "@/lib/workstation/math";
import { defaultNoteEnd, noteLayout, type PixelPoint } from "@/lib/workstation/note-layout";
import { ellipsizeDrawingText, wrapDrawingText } from "@/lib/workstation/drawing-label-text";

export type Hit = { id: string; kind: "drawing" | "execution" | "handle"; point?: number; anchor?: PixelPoint; segment?: [PixelPoint, PixelPoint]; x: number; y: number; w: number; h: number };
export type PaintOptions = { pinPreview?: string | null; capturePinNotes?: boolean; beforeEntry?: boolean; executionColors?: { buy: string; sell: string }; covered?: CandleRange[]; visibleRange?: CandleRange | null; width: number; height: number; plotWidth: number; plotHeight: number; x: (time: number) => number | null; y: (price: number) => number | null; drawings: Drawing[]; trade: Trade; candles: Candle[]; interval: Interval; session?: CandleSession; labels: WorkspacePreferences["labels"]; selected: string | null; selectedExecution: string | null; light: boolean; export?: boolean; replay: number | null };

export function paintChart(ctx: CanvasRenderingContext2D, o: PaintOptions): Hit[] {
  const hits: Hit[] = [], occupied: { x: number; y: number; w: number; h: number }[] = [];
  const { x, y, plotHeight: h } = o;
  const last = o.candles.at(-1), prior = o.candles.at(-2);
  const lastX = last ? x(last.time) : null, priorX = prior ? x(prior.time) : null;
  const w = o.beforeEntry ? Math.max(0, Math.min(o.plotWidth, lastX === null ? 0 : lastX + (priorX === null ? 4 : (lastX - priorX) / 2))) : o.plotWidth;
  // Reserve the in-chart OHLC strip so labels never disappear beneath it.
  const topInset = o.export ? 3 : 24;
  if (w < 24 || h < topInset + 24) return hits;
  const label = (text: string, px: number, py: number, color: string, fill = o.light ? "#ffffff" : "#171d2a", maxWidth = 320, note = "") => {
    ctx.font = "11px system-ui, sans-serif";
    const measure = (value: string) => ctx.measureText(value).width;
    const width = Math.min(Math.max(measure(text), ...note.split(/\r?\n/).map(measure)) + 18, maxWidth, w - 6);
    let notes = note ? wrapDrawingText(note, width - 16, measure) : [];
    // Keep the calculated values visible even when a note exceeds the plot height.
    const maxNotes = Math.max(0, Math.floor((h - topInset - 1 - 24) / 16));
    if (notes.length > maxNotes) {
      notes = notes.slice(0, maxNotes);
      if (notes.length) notes[notes.length - 1] = ellipsizeDrawingText(notes[notes.length - 1], width - 16, measure);
    }
    const height = (text ? 24 : 8) + notes.length * 16;
    const left = Math.max(3, Math.min(w - width - 3, px)), top = Math.max(topInset, Math.min(h - height - 1, py - notes.length * 16));
    ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = .65; ctx.setLineDash([]);
    ctx.beginPath(); ctx.roundRect(left, top, width, height, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    [...notes, ...(text ? [text] : [])].forEach((value, index) => ctx.fillText(value, left + 8, top + 16 + index * 16, width - 16));
    const rect = { x: left, y: top, w: width, h: height };
    occupied.push(rect);
    return rect;
  };
  const line = (ax: number, ay: number, bx: number, by: number) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
  const lineHit = (id: string, a: PixelPoint, b: PixelPoint) => {
    const left = Math.max(0, Math.min(a.x, b.x) - 5), top = Math.max(0, Math.min(a.y, b.y) - 5);
    const right = Math.min(w, Math.max(a.x, b.x) + 5), bottom = Math.min(h, Math.max(a.y, b.y) + 5);
    if (right >= left && bottom >= top) hits.push({ id, kind: "drawing", segment: [a, b], x: left, y: top, w: right - left, h: bottom - top });
  };
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  for (const d of o.drawings) {
    const points = d.points.map(p => ({ x: x(p.time), y: y(p.price) }));
    if (!points[0] || points[0].x === null || points[0].y === null) continue;
    const a = points[0] as { x: number; y: number }, b = points[1] && points[1].x !== null && points[1].y !== null ? points[1] as { x: number; y: number } : a;
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = d.width; ctx.setLineDash(d.dashed ? [6, 5] : []);
    let bounds = { x: Math.min(a.x, b.x) - 5, y: Math.min(a.y, b.y) - 5, w: Math.abs(b.x - a.x) + 10, h: Math.abs(b.y - a.y) + 10 };
    if (d.tool === "pin") {
      if (a.x < 0 || a.x > w || a.y < 0 || a.y > h) continue;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - 5, a.y - 9); ctx.lineTo(a.x + 5, a.y - 9); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(a.x, a.y - 12, 6, 0, Math.PI * 2); ctx.fill();
      bounds = { x: a.x - 12, y: a.y - 24, w: 24, h: 28 };
      if (d.text.trim() && (o.export ? o.capturePinNotes : o.pinPreview === d.id)) {
        label("", a.x + 12, a.y - 24, d.color, undefined, 280, d.text.trim());
      }
    } else if (d.tool === "entry" || d.tool === "exit") {
      if (a.x < 0 || a.x > w || a.y < 0 || a.y > h) continue;
      const baseY = a.y + (d.tool === "entry" ? 10 : -10);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - 6, baseY); ctx.lineTo(a.x + 6, baseY); ctx.closePath(); ctx.fill(); ctx.stroke();
      bounds = { x: Math.max(0, a.x - 12), y: Math.max(0, a.y - 12), w: Math.min(w, a.x + 12) - Math.max(0, a.x - 12), h: Math.min(h, a.y + 12) - Math.max(0, a.y - 12) };
      const text = [d.text.trim(), d.showPrice !== false ? d.points[0].price.toFixed(2) : ""].filter(Boolean).join(" · ");
      if (text) hits.push({ ...label(text, a.x + 12, d.tool === "entry" ? a.y + 14 : a.y - 38, d.color), id: d.id, kind: "drawing" });
    } else if (["horizontal", "ray", "stop", "target"].includes(d.tool)) {
      if (a.y < 0 || a.y > h || (d.tool !== "horizontal" && a.x > w)) continue;
      const start = d.tool === "horizontal" ? 0 : a.x;
      line(start, a.y, w, a.y);
      const text = d.text || `${d.tool[0].toUpperCase() + d.tool.slice(1)} · ${d.points[0].price.toFixed(2)}`;
      if (d.text || d.tool !== "ray" || d.showDefaultLabel !== false) {
        const box = label(text, Math.max(start + 8, 12), a.y - 29, d.color);
        if (d.tool === "ray") hits.push({ ...box, id: d.id, kind: "drawing" });
      }
      bounds = { x: Math.max(0, start), y: a.y - 6, w: w - Math.max(0, start), h: 12 };
      if (d.tool === "ray") lineHit(d.id, { x: start, y: a.y }, { x: w, y: a.y });
    } else if (d.tool === "text" || d.tool === "price-note") {
      if (a.x < 0 || a.x > w || a.y < 0 || a.y > h) continue;
      const text = d.tool === "price-note" ? `${d.points[0].price.toFixed(2)} ${d.text}` : d.text || "Double-click to edit note";
      ctx.font = "11px system-ui, sans-serif";
      const layout = noteLayout(a, points[1] ? b : defaultNoteEnd(a), ctx.measureText(text).width, w, h, topInset);
      line(a.x, a.y, layout.join.x, layout.join.y);
      const angle = Math.atan2(layout.join.y - a.y, layout.join.x - a.x);
      line(a.x, a.y, a.x + 8 * Math.cos(angle - .4), a.y + 8 * Math.sin(angle - .4));
      line(a.x, a.y, a.x + 8 * Math.cos(angle + .4), a.y + 8 * Math.sin(angle + .4));
      bounds = label(text, layout.box.x, layout.box.y, d.color, undefined, layout.box.w);
      hits.push({ ...bounds, id: d.id, kind: "drawing", point: 1, anchor: layout.end });
      hits.push({ id: d.id, kind: "drawing", point: 0, anchor: a, x: a.x - 9, y: a.y - 9, w: 18, h: 18 });
      points[1] = layout.end;
    } else if (d.tool === "zone") {
      ctx.globalAlpha = .12; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      if (d.text) label(d.text, Math.min(a.x, b.x) + 5, Math.min(a.y, b.y) + 5, d.color);
    } else if (d.tool === "long" || d.tool === "short") {
      const rr = riskReward(d), stop = rr ? y(rr.stop) : null;
      if (rr && stop !== null) {
        ctx.globalAlpha = .16; ctx.fillStyle = "#34d399"; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.fillStyle = "#fb7185"; ctx.fillRect(a.x, a.y, b.x - a.x, stop - a.y); ctx.globalAlpha = 1;
        ctx.strokeStyle = "#34d399"; line(a.x, b.y, b.x, b.y); ctx.strokeStyle = "#fb7185"; line(a.x, stop, b.x, stop); ctx.strokeStyle = d.color; line(a.x, a.y, b.x, a.y);
        label(`${d.tool === "long" ? "Long" : "Short"} · ${rr.ratio === null ? "Invalid levels" : `${rr.ratio.toFixed(2)}R`} · Stop ${rr.stop.toFixed(2)}`, Math.min(a.x, b.x), Math.min(a.y, b.y, stop) - 28, d.color);
        bounds = { x: Math.min(a.x, b.x) - 5, y: Math.min(a.y, b.y, stop) - 5, w: Math.abs(b.x - a.x) + 10, h: Math.max(a.y, b.y, stop) - Math.min(a.y, b.y, stop) + 10 };
      }
    } else {
      line(a.x, a.y, b.x, b.y);
      if (d.tool === "arrow") { const angle = Math.atan2(b.y - a.y, b.x - a.x); line(b.x, b.y, b.x - 10 * Math.cos(angle - .4), b.y - 10 * Math.sin(angle - .4)); line(b.x, b.y, b.x - 10 * Math.cos(angle + .4), b.y - 10 * Math.sin(angle + .4)); }
      if (d.tool === "measure" && d.points[1]) {
        ctx.setLineDash([3, 4]); line(a.x, a.y, b.x, a.y); line(b.x, a.y, b.x, b.y);
        lineHit(d.id, a, b);
        lineHit(d.id, a, { x: b.x, y: a.y });
        lineHit(d.id, { x: b.x, y: a.y }, b);
        if (d.extendLeft || d.extendRight) {
          const left = Math.max(0, d.extendLeft ? 0 : Math.min(a.x, b.x));
          const right = Math.min(w, d.extendRight ? w : Math.max(a.x, b.x));
          if (right > left) for (const level of new Set([a.y, b.y])) {
            if (level < 0 || level > h) continue;
            line(left, level, right, level);
            // Only the boundary lines are selectable outside the measured rectangle.
            lineHit(d.id, { x: left, y: level }, { x: right, y: level });
          }
        }
        const bars = o.candles.filter(c => c.time >= Math.min(d.points[0].time, d.points[1].time) && c.time <= Math.max(d.points[0].time, d.points[1].time)).length;
        const metrics = measureText(d.points[0], d.points[1], bars, d);
        if (metrics || d.text.trim()) {
          const box = label(metrics, (a.x + b.x) / 2 - 110, Math.min(a.y, b.y) - 30, d.color, undefined, 320, d.text.trim());
          hits.push({ ...box, id: d.id, kind: "drawing" });
        }
      }
    }
    if (d.tool !== "text" && d.tool !== "price-note" && d.tool !== "measure" && d.tool !== "ray") hits.push({ ...bounds, id: d.id, kind: "drawing" });
    if (d.id === o.selected && !o.export) {
      for (let i = 0; i < points.length; i++) { const p = points[i]; if (p.x === null || p.y === null) continue; ctx.setLineDash([]); ctx.fillStyle = o.light ? "#fff" : "#121722"; ctx.strokeStyle = d.color; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); if (!d.locked) hits.push({ id: d.id, kind: "handle", point: i, x: p.x - 9, y: p.y - 9, w: 18, h: 18 }); }
    }
  }
  for (const row of executionVisibility({ ...o, executions: o.trade.executions })) {
    if (row.reason !== "visible" || row.x === null || row.y === null) continue;
    const { diagnostic, index: i, x: px, y: py } = row, e = diagnostic.execution;
    const color = e.side === "BUY" ? o.executionColors?.buy ?? "#34d399" : o.executionColors?.sell ?? "#fb7185", selected = o.selectedExecution === e.id;
    ctx.setLineDash([]); ctx.fillStyle = color; ctx.strokeStyle = o.light ? "#fff" : "#121722"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, selected ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (diagnostic.status === "price-outside") { ctx.strokeStyle = "#eab35f"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, selected ? 9 : 7, 0, Math.PI * 2); ctx.stroke(); }
    if (o.labels === "compact") { hits.push({ id: e.id, kind: "execution", x: px - 9, y: py - 9, w: 18, h: 18 }); continue; }
    const text = `${i + 1}  ${e.side === "BUY" ? "Buy" : "Sell"} ${e.quantity} @ ${e.price.toFixed(2)}`;
    ctx.font = "11px system-ui, sans-serif";
    const width = Math.min(ctx.measureText(text).width + 18, w - 8);
    let left = Math.max(4, Math.min(w - width - 4, px - width / 2));
    let top = Math.max(topInset, Math.min(h - 29, e.side === "BUY" ? py + 20 : py - 45));
    const candidates: { x: number; y: number; distance: number }[] = [];
    for (const lx of [...new Set([left, 4, Math.max(4, w - width - 4), Math.min(w - width - 4, px + 12), Math.max(4, px - width - 12)])]) {
      for (let ly = topInset; ly <= h - 28; ly += 28) candidates.push({ x: lx, y: ly, distance: Math.abs(lx - left) + Math.abs(ly - top) });
    }
    const placed = candidates.sort((a, b) => a.distance - b.distance).find(c => !occupied.some(r => c.x < r.x + r.w + 3 && c.x + width + 3 > r.x && c.y < r.y + r.h + 3 && c.y + 27 > r.y));
    if (placed) { left = placed.x; top = placed.y; }
    ctx.strokeStyle = color; ctx.lineWidth = .7; ctx.setLineDash([2, 3]); line(px, py, Math.max(left, Math.min(left + width, px)), top + (top > py ? 0 : 24));
    hits.push({ id: e.id, kind: "execution", x: px - 9, y: py - 9, w: 18, h: 18 });
    const rect = label(text, left, top, color, selected ? o.light ? "#e3e9f5" : "#283248" : undefined, width);
    hits.push({ id: e.id, kind: "execution", ...rect });
  }
  ctx.restore(); return hits;
}
export function hitAt(hits: Hit[], point: PixelPoint): Hit | undefined {
  const contains = (h: Hit) => {
    if (point.x < h.x || point.x > h.x + h.w || point.y < h.y || point.y > h.y + h.h) return false;
    if (!h.segment) return true;
    const [a, b] = h.segment, dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= 5;
  };
  const reversed = [...hits].reverse();
  return reversed.find(h => h.kind === "handle" && contains(h)) ?? reversed.find(contains);
}
