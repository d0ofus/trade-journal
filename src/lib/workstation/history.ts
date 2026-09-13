import { Candle, CandleResult, Interval, Trade, WorkstationAdapter, seconds } from "./types";

export type HistoryRange = { from: number; to: number };
export type HistoryDirection = "older" | "newer";
export const MAX_HISTORY_CANDLES = 100_000;
const DAY = 86400;
const pageDays: Record<Interval, number> = { "5m": 14, "10m": 21, "15m": 28, "1h": 90, "1d": 365, "1wk": 1825 };

/** Fit includes complete coarse candles and the full holding period, even across weekends. */
export function fitTradeHistoryRange(trade: Trade, interval: Interval): HistoryRange {
  const padding = Math.max(DAY, seconds[interval] * 10, (trade.closeTime - trade.openTime) * .35);
  return { from: Math.max(1, Math.floor(trade.openTime - padding)), to: Math.ceil(trade.closeTime + padding) };
}

export function initialHistoryRange(trade: Trade, interval: Interval, context?: HistoryRange | null): HistoryRange {
  const span = pageDays[interval] * DAY;
  const padding = Math.max(seconds[interval] * 60, DAY);
  const center = context ? (context.from + context.to) / 2 : (trade.openTime + trade.closeTime) / 2;
  const duration = context ? context.to - context.from : trade.closeTime - trade.openTime;
  const width = Math.min(span, Math.max(duration + padding * 2, seconds[interval] * 240));
  return { from: Math.max(1, Math.floor(center - width / 2)), to: Math.floor(center + width / 2) };
}

export function mergeHistory(current: Candle[], incoming: Candle[], range?: HistoryRange): Candle[] {
  const rows = new Map(current.map(c => [c.time, c]));
  for (const candle of incoming) {
    if (range && (candle.time < range.from || candle.time > range.to)) continue;
    if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
      || candle.time <= 0 || candle.low > Math.min(candle.open, candle.close)
      || candle.high < Math.max(candle.open, candle.close) || candle.volume < 0) {
      throw new Error("Provider returned invalid candles. Existing chart history is preserved.");
    }
    rows.set(candle.time, candle);
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

/** Preserve the bar under the left edge and fractional scroll position, including blank overscroll. */
export function preserveHistoryViewport(previous: Candle[], next: Candle[], range: HistoryRange): HistoryRange {
  if (!previous.length || !next.length) return range;
  const anchor = Math.max(0, Math.min(previous.length - 1, Math.floor(range.from)));
  const index = next.findIndex(c => c.time === previous[anchor].time);
  return index < 0 ? range : { from: range.from + index - anchor, to: range.to + index - anchor };
}

export type HistoryState = {
  interval?: Interval;
  result: CandleResult;
  loading: "initial" | HistoryDirection | null;
  error: string;
  failed: "initial" | HistoryDirection | null;
  messages: Record<HistoryDirection, string>;
  range: HistoryRange;
};

/** One cancellable history session per chart/ticker/interval. No review or ingestion writes. */
export class CandleHistory {
  private controller = new AbortController();
  private busy = false;
  private paused = new Set<HistoryDirection>();
  private sources = new Set<string>();
  private warnings = new Set<string>();
  state: HistoryState;

  constructor(
    private adapter: WorkstationAdapter,
    private trade: Trade,
    private interval: Interval,
    range: HistoryRange,
    private changed: (state: HistoryState) => void,
    private now = () => Math.floor(Date.now() / 1000),
  ) {
    this.state = { interval, result: { candles: [], warning: "", source: "" }, loading: null, error: "", failed: null, messages: { older: "", newer: "" }, range };
  }

  dispose() { this.controller.abort(); }
  private publish(update: Partial<HistoryState>) {
    if (this.controller.signal.aborted) return;
    this.state = { ...this.state, ...update };
    this.changed(this.state);
  }
  async start() { return this.load(this.state.range, "initial"); }
  async refresh(context?: HistoryRange | null) { return this.load(initialHistoryRange(this.trade, this.interval, context), "initial", true); }
  /** Fill an explicitly requested calendar window in bounded, cancellable pages. */
  async cover(range: HistoryRange): Promise<void> {
    const end = Math.min(range.to, this.now());
    while (!this.controller.signal.aborted && !this.state.failed) {
      const direction = this.state.range.from > range.from ? "older" : this.state.range.to < end ? "newer" : null;
      if (!direction || !(await this.extend(direction))) return;
    }
  }
  async retry() {
    const failed = this.state.failed;
    if (failed === "initial") return this.start();
    if (failed) return this.extend(failed, true);
    return false;
  }
  async extend(direction: HistoryDirection, manual = false, visibleBars?: number): Promise<boolean> {
    if (this.busy || this.controller.signal.aborted || this.state.failed === "initial" || (!manual && this.paused.has(direction))) return false;
    if (this.state.result.candles.length >= MAX_HISTORY_CANDLES) {
      this.publish({ messages: { ...this.state.messages, [direction]: "Chart memory limit reached (100,000 bars). Switch timeframe or reopen the chart to browse another period." } });
      return false;
    }
    const width = visibleBars ? Math.min(pageDays[this.interval] * DAY, Math.max(2 * DAY, seconds[this.interval] * visibleBars)) : pageDays[this.interval] * DAY, overlap = seconds[this.interval] * 2;
    const current = this.state.range;
    const range = direction === "older"
      ? { from: Math.max(1, current.from - width), to: current.from + overlap }
      : { from: current.to - overlap, to: Math.min(this.now(), current.to + width) };
    if ((direction === "newer" && range.to <= current.to) || (direction === "older" && range.from >= current.from)) {
      this.paused.add(direction);
      this.publish({ messages: { ...this.state.messages, [direction]: direction === "newer" ? "Reached the current date. History loads on demand; no live streaming." : "Reached the earliest supported date." } });
      return false;
    }
    return this.load(range, direction);
  }
  private async load(range: HistoryRange, direction: "initial" | HistoryDirection, refresh = false): Promise<boolean> {
    if (this.busy || this.controller.signal.aborted) return false;
    this.busy = true;
    this.publish({ loading: direction, error: "", failed: null });
    try {
      const publishCached = (value: CandleResult) => {
        if (value.truncated) throw new Error("History response was truncated. Use a smaller history window.");
        if (this.state.result.candles.length && this.state.result.identity && value.candles.length && value.identity !== this.state.result.identity) throw new Error("History provider changed. Existing candles are preserved; reload to start a separate series.");
        const previous = value.cache?.enabled ? this.state.result.candles.filter(c => !value.cache!.covered.some(r => c.time >= r.from && c.time < r.to)) : this.state.result.candles;
        const candles = mergeHistory(previous, value.candles, range);
        if (candles.length > MAX_HISTORY_CANDLES) throw new Error("Chart memory limit reached (100,000 bars). Use a larger timeframe.");
        this.publish({ result: { ...value, candles, identity: this.state.result.candles.length ? this.state.result.identity : value.identity } });
      };
      let response = await this.adapter.cachedCandles?.(this.trade, this.interval, this.controller.signal, range, this.state.result.candles.length ? this.state.result.identity : undefined);
      if (response?.cache?.enabled && !response.truncated) publishCached(response);
      const deadline = Date.now() + 90_000;
      let attempts = 0;
      while (refresh || !response?.cache?.enabled || response.cache.missing.length || response.cache.refresh.length) {
        if (attempts >= 60 || Date.now() > deadline) throw new Error("Additional history is still queued. Cached candles are ready; retry to resume the missing range.");
        if (attempts && response?.cache?.retryAfterMs) {
          const wait = response.cache.retryAfterMs;
          if (wait > 5000) throw new Error(response.warning || "History preparation is paused. Cached candles remain available.");
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error("History cancelled")); };
            const timer = setTimeout(() => { this.controller.signal.removeEventListener("abort", abort); resolve(); }, wait);
            this.controller.signal.addEventListener("abort", abort, { once: true });
          });
        }
        this.controller.signal.throwIfAborted();
        const fetch = refresh ? this.adapter.refreshCandles ?? this.adapter.candles : this.adapter.candles;
        response = await fetch(this.trade, this.interval, this.controller.signal, range, this.state.result.candles.length ? this.state.result.identity : undefined);
        refresh = false;
        attempts++;
        if (response.cache?.enabled) publishCached(response);
        else break; // Original adapters and explicitly separate Yahoo fallback keep their existing contract.
        // Temporary bars are usable, but never claim durable coverage or retry storage automatically.
        if (response.cache?.persistencePaused) break;
      }
      if (!response) throw new Error("History response unavailable.");
      if (this.controller.signal.aborted) return false;
      // Advancing past a truncated response could silently skip unreturned history.
      if (response.truncated) throw new Error("History response was truncated. Existing candles are preserved; retry this range before continuing.");
      if (this.state.result.candles.length && this.state.result.identity && response.candles.length && response.identity !== this.state.result.identity) {
        throw new Error("The history provider, feed or price basis changed. Existing candles are preserved. Retry for the original provider, or reload this chart to start a separate series.");
      }
      const candles = mergeHistory(this.state.result.candles, response.candles, range);
      if (candles.length > MAX_HISTORY_CANDLES) throw new Error("Chart memory limit reached (100,000 bars). Use a larger timeframe to browse further.");
      if (response.source) this.sources.add(response.source);
      if (response.warning) this.warnings.add(response.warning);
      const previous = this.state.range;
      const progressed = direction === "initial" || response.candles.some(c => direction === "older" ? c.time < previous.from : c.time > previous.to);
      const messages = { ...this.state.messages };
      if (direction !== "initial") {
        if (progressed) { this.paused.delete(direction); messages[direction] = ""; }
        else {
          this.paused.add(direction);
          messages[direction] = `No ${direction} bars returned for ${new Date(range.from * 1000).toISOString().slice(0, 10)}–${new Date(range.to * 1000).toISOString().slice(0, 10)}. History may be unavailable; use Load ${direction} to search the next window.`;
          this.warnings.add(response.cache?.enabled && !response.cache.missing.length ? "Provider query completed: no eligible bars in this period." : `No bars returned for ${new Date(range.from * 1000).toISOString().slice(0, 10)}–${new Date(range.to * 1000).toISOString().slice(0, 10)}; coverage is not confirmed.`);
        }
      }
      this.publish({
        result: { cache: response.cache, candles, source: [...this.sources].join(" / "), warning: [...this.warnings].join(" · "), identity: this.state.result.candles.length ? this.state.result.identity : response.identity, provider: response.provider ?? this.state.result.provider, session: response.session ?? this.state.result.session },
        range: { from: Math.min(previous.from, range.from), to: Math.max(previous.to, range.to) },
        messages,
      });
      return true;
    } catch (error) {
      if (this.controller.signal.aborted) return false;
      if (direction !== "initial") this.paused.add(direction);
      this.publish({ error: error instanceof Error ? error.message : "History request failed. Existing candles are preserved.", failed: direction });
      return false;
    } finally {
      this.busy = false;
      this.publish({ loading: null });
    }
  }
}
