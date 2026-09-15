import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { usEquitiesTradingSession } from "@/lib/server/market-session-calendar";
import { seconds, type Candle, type CandleSession, type Interval } from "@/lib/workstation/types";

export const sessionBackgroundColor = (light: boolean) => light ? "#f2f5fa" : "#171e2b";
export const hasExtendedSession = (interval: Interval, session?: CandleSession) =>
  interval !== "1d" && interval !== "1wk" && session?.timezone === "America/New_York" &&
  session.calendar === "exchange" && session.marketHours === "extended";
type Band = { from: number; to: number };
type Market = ReturnType<typeof usEquitiesTradingSession>;
const DAY = 86400;

function lowerBound(candles: readonly Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (candles[mid].time < time) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A bar occupies [index - .5, index + .5]; split mixed bars by elapsed time.
 * Missing time between bars has no column and must not stretch a session band. */
export function sessionBoundaryColumn(candles: readonly Candle[], time: number, interval: Interval) {
  const next = lowerBound(candles, time);
  if (!next || candles[next]?.time === time) return next - .5;
  const previous = next - 1;
  const duration = Math.min(seconds[interval], (candles[next]?.time ?? Infinity) - candles[previous].time);
  return previous - .5 + Math.min(1, (time - candles[previous].time) / duration);
}

/** Only visible days are classified; there is no per-candle history index. */
export function extendedSessionBands(candles: readonly Candle[], interval: Interval, first: number, last: number, calendar: Map<number, Market> = new Map()): Band[] {
  if (!candles.length || first > last) return [];
  const left = first - .5, right = last + .5, bands: Band[] = [];
  let cursor = left;
  // New York's local date may precede the UTC date; include that preceding day.
  const start = Math.floor(candles[first].time / DAY) * DAY - DAY;
  const end = Math.floor((candles[last].time + seconds[interval]) / DAY) * DAY;
  for (let day = start; day <= end; day += DAY) {
    let market = calendar.get(day);
    if (market === undefined) {
      const date = new Date(day * 1000);
      market = usEquitiesTradingSession({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
      if (calendar.size >= 512) calendar.delete(calendar.keys().next().value!);
      calendar.set(day, market);
    }
    if (!market) continue;
    const from = Math.max(left, sessionBoundaryColumn(candles, market.open, interval));
    const to = Math.min(right, sessionBoundaryColumn(candles, market.close, interval));
    if (to <= from) continue;
    if (from > cursor) bands.push({ from: cursor, to: from });
    cursor = Math.max(cursor, to);
  }
  if (cursor < right) bands.push({ from: cursor, to: right });
  return bands;
}

export class SessionBackground implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private candles: readonly Candle[] = [];
  private interval: Interval = "5m";
  private enabled = false;
  private light = false;
  private calendar = new Map<number, Market>();
  private bounds = "";
  private bands: Band[] = [];
  private renderer: IPrimitivePaneRenderer = {
    draw: target => {
      if (!this.chart || !this.enabled || !this.candles.length) return;
      const scale = this.chart.timeScale(), range = scale.getVisibleLogicalRange();
      if (!range) return;
      const first = Math.max(0, Math.floor(range.from) - 1), last = Math.min(this.candles.length - 1, Math.ceil(range.to) + 1);
      const bounds = `${first}:${last}`;
      if (bounds !== this.bounds) {
        this.bands = extendedSessionBands(this.candles, this.interval, first, last, this.calendar);
        this.bounds = bounds;
      }
      // LWC 5.1 rejects fractional logical indexes. Interpolate between integer
      // coordinates so session boundaries can split an hourly candle's column.
      const origin = scale.logicalToCoordinate(0 as Logical), next = scale.logicalToCoordinate(1 as Logical);
      if (origin === null || next === null) return;
      const spacing = next - origin;
      target.useBitmapCoordinateSpace(({ context, bitmapSize, horizontalPixelRatio }) => {
        context.fillStyle = sessionBackgroundColor(this.light);
        for (const band of this.bands) {
          const from = origin + band.from * spacing, to = origin + band.to * spacing;
          const x = Math.max(0, Math.round(from * horizontalPixelRatio));
          const end = Math.min(bitmapSize.width, Math.round(to * horizontalPixelRatio));
          if (end > x) context.fillRect(x, 0, end - x, bitmapSize.height);
        }
      });
    },
  };
  private views: IPrimitivePaneView[] = [{ zOrder: () => "bottom", renderer: () => this.enabled ? this.renderer : null }];
  attached({ chart }: SeriesAttachedParameter<Time>) { this.chart = chart; }
  detached() { this.chart = null; this.candles = []; this.bands = []; this.bounds = ""; this.calendar.clear(); }
  paneViews() { return this.views; }
  // Called alongside existing setData/applyOptions, which already request a paint.
  setData(candles: readonly Candle[], interval: Interval, session: CandleSession | undefined, light: boolean) {
    const enabled = hasExtendedSession(interval, session);
    if (candles !== this.candles || interval !== this.interval || enabled !== this.enabled) this.bounds = "";
    this.candles = candles; this.interval = interval; this.enabled = enabled; this.light = light;
  }
  setTheme(light: boolean) { this.light = light; }
}
