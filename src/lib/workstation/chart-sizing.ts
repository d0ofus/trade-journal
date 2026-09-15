export type ChartSizing = {
  version: 1;
  layouts: Record<"two" | "threeLeft" | "threeTop" | "four", { main: number; first: number; second: number }>;
  mobile: number[];
};
export type ChartRect = { x: number; y: number; width: number; height: number };
export type Divider = ChartRect & { id: string; axis: "x" | "y"; field: "main" | "first" | "second" | number; extent: number; min: number; max: number; value: number; label: string };
export const defaultChartSizing = (): ChartSizing => ({ version: 1, layouts: { two: { main: .5, first: .5, second: .5 }, threeLeft: { main: 1.45 / 2.45, first: .5, second: .5 }, threeTop: { main: 1.12 / 2.12, first: .5, second: .5 }, four: { main: .5, first: .5, second: .5 } }, mobile: [340, 320, 320, 320] });
export function restoreChartSizing(raw: unknown): ChartSizing {
  const result = defaultChartSizing();
  if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1) return result;
  const input = raw as Partial<ChartSizing>;
  for (const key of Object.keys(result.layouts) as (keyof ChartSizing["layouts"])[]) for (const field of ["main", "first", "second"] as const) {
    const value = input.layouts?.[key]?.[field];
    if (typeof value === "number" && Number.isFinite(value)) result.layouts[key][field] = Math.max(.1, Math.min(.9, value));
  }
  result.mobile = result.mobile.map((fallback, i) => typeof input.mobile?.[i] === "number" && Number.isFinite(input.mobile[i]) ? Math.max(240, Math.min(1200, input.mobile[i])) : fallback);
  return result;
}
export const sizingKey = (count: number, arrangement: "left" | "top"): keyof ChartSizing["layouts"] => count === 2 ? "two" : count === 4 ? "four" : arrangement === "left" ? "threeLeft" : "threeTop";
export function chartGeometry(width: number, height: number, count: number, arrangement: "left" | "top", sizing: ChartSizing) {
  const gap = 6, rects: ChartRect[] = [], dividers: Divider[] = [];
  const stacked = count > 1 && (width < 600 || height < 366);
  const rect = (x: number, y: number, w: number, h: number): ChartRect => ({ x, y, width: Math.max(0, w), height: Math.max(0, h) });
  if (count === 1) rects.push(rect(0, 0, width, height));
  else if (stacked) {
    let y = 0;
    for (let i = 0; i < count; i++) {
      rects.push(rect(0, y, width, sizing.mobile[i])); y += sizing.mobile[i];
      dividers.push({ ...rect(0, y, width, gap), id: `height-${i}`, axis: "y", field: i, extent: 1, min: 240, max: 1200, value: sizing.mobile[i], label: `Chart ${i + 1} height` }); y += gap;
    }
  } else {
    const values = sizing.layouts[sizingKey(count, arrangement)];
    const split = (area: ChartRect, axis: "x" | "y", field: "main" | "first" | "second", label: string) => {
      const extent = (axis === "x" ? area.width : area.height) - gap, minimum = axis === "x" ? 240 : 180;
      const min = Math.min(.5, minimum / extent), max = 1 - min, value = Math.max(min, Math.min(max, values[field]));
      const size = Math.round(extent * value);
      const a = rect(area.x, area.y, axis === "x" ? size : area.width, axis === "y" ? size : area.height);
      const divider = rect(area.x + (axis === "x" ? size : 0), area.y + (axis === "y" ? size : 0), axis === "x" ? gap : area.width, axis === "y" ? gap : area.height);
      const b = rect(divider.x + (axis === "x" ? gap : 0), divider.y + (axis === "y" ? gap : 0), axis === "x" ? extent - size : area.width, axis === "y" ? extent - size : area.height);
      dividers.push({ ...divider, id: field, axis, field, extent, min, max, value, label });
      return [a, b];
    };
    const [a, b] = split(rect(0, 0, width, height), count === 3 && arrangement === "top" ? "y" : "x", "main", "Main chart division");
    if (count === 2) rects.push(a, b);
    else if (count === 3) rects.push(a, ...split(b, arrangement === "top" ? "x" : "y", "first", "Secondary chart division"));
    else { const left = split(a, "y", "first", "Left charts division"), right = split(b, "y", "second", "Right charts division"); rects.push(left[0], right[0], left[1], right[1]); }
  }
  return { rects, dividers, stacked, height: Math.max(height, ...rects.map(r => r.y + r.height + (stacked ? gap : 0))) };
}
