import type { IChartApi } from "lightweight-charts";
import type { Hit } from "./chart-paint";

export type DrawingPane = { top: number; height: number; width: number };
/** Native pane bounds include separator spacing; summed pane heights do not. */
export function drawingPane(api: IChartApi, index: number, host: HTMLElement): DrawingPane | null {
  const node = api.panes()[index]?.getHTMLElement();
  if (!node) return null;
  const top = node.getBoundingClientRect().top - host.getBoundingClientRect().top;
  const { height } = api.paneSize(index), width = api.timeScale().width();
  return height > 0 && width > 0 ? { top, height, width } : null;
}
export const insideDrawingPane = (point: { x: number; y: number }, pane: DrawingPane) => point.x >= 0 && point.x < pane.width && point.y >= pane.top && point.y < pane.top + pane.height;
export const panePoint = (point: { x: number; y: number }, pane: DrawingPane) => ({ x: Math.max(0, Math.min(pane.width - 1, point.x)), y: Math.max(0, Math.min(pane.height - 1, point.y - pane.top)) });
export function offsetPaneHits(hits: Hit[], top: number): Hit[] {
  return hits.map(hit => ({ ...hit, y: hit.y + top,
    ...(hit.anchor ? { anchor: { ...hit.anchor, y: hit.anchor.y + top } } : {}),
    ...(hit.segment ? { segment: hit.segment.map(point => ({ ...point, y: point.y + top })) as Hit["segment"] } : {}) }));
}
