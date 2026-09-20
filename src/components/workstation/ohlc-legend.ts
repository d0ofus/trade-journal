import type { Candle } from "@/lib/workstation/types";

type OhlcCandle = Pick<Candle, "time" | "open" | "high" | "low" | "close">;
const prices = ["open", "high", "low", "close"] as const;

function isOhlcCandle(value: unknown): value is OhlcCandle {
  if (!value || typeof value !== "object") return false;
  const candle = value as OhlcCandle;
  return Number.isFinite(candle.time) && prices.every(key => Number.isFinite(candle[key]));
}

/** Last candle at/before a timestamp, without scanning or indexing the history. */
function atOrBefore(candles: readonly Candle[], time: number) {
  let lo = 0, hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return candles[lo - 1];
}

/** Owns only the empty React text slots and their visibility; never renders the chart. */
export function createOhlcLegend(root: HTMLElement) {
  const percent = root.querySelector<HTMLElement>("[data-ohlc-percent]");
  const fields = prices.map(key => root.querySelector<HTMLElement>(`[data-ohlc="${key}"]`)!);
  const labels = fields.map(field => field.parentElement!);
  const empty = root.querySelector<HTMLElement>("[data-ohlc-empty]")!;
  let displayed: OhlcCandle | null = null;
  let inspectedTime: number | null = null;
  let history: readonly Candle[] = [];

  function update(candle: OhlcCandle | null) {
    if (percent) {
      const previous = candle ? atOrBefore(history, candle.time - .000001) : undefined;
      const change = candle && previous && previous.close > 0 ? (candle.close - previous.close) / previous.close * 100 : NaN;
      const valid = Number.isFinite(change);
      const text = valid ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";
      if (percent.textContent !== text) percent.textContent = text;
      if (percent.hidden !== !candle) percent.hidden = !candle;
      const direction = valid ? change > 0 ? "positive" : change < 0 ? "negative" : "" : "";
      if (percent.className !== direction) percent.className = direction;
    }
    if (displayed === candle || (displayed && candle && displayed.time === candle.time &&
      prices.every(key => displayed![key] === candle[key]))) return;
    if (!!displayed !== !!candle) {
      labels.forEach(label => { label.hidden = !candle; });
      empty.hidden = !!candle;
    }
    if (candle) {
      prices.forEach((key, index) => {
        if (displayed?.[key] === candle[key]) return;
        const text = candle[key].toFixed(2);
        if (fields[index].textContent !== text) fields[index].textContent = text;
      });
      const direction = candle.close >= candle.open ? "positive" : "negative";
      if (fields[3].className !== direction) fields[3].className = direction;
    }
    displayed = candle;
  }

  return {
    update,
    inspect(value: unknown) {
      // Missing/whitespace data and pointer exits retain the last inspected candle.
      if (!isOhlcCandle(value)) return;
      inspectedTime = value.time;
      update(value);
    },
    reset() {
      inspectedTime = null;
      history = [];
      update(null);
    },
    reconcile(candles: readonly Candle[], visibleTo?: number) {
      history = candles;
      const inspected = inspectedTime === null ? undefined : atOrBefore(candles, inspectedTime);
      if (inspected && inspected.time === inspectedTime) {
        update(inspected);
        return;
      }
      // Replay can remove the inspected candle; never retain prices from the future.
      inspectedTime = null;
      update((visibleTo === undefined ? undefined : atOrBefore(candles, visibleTo)) ?? candles.at(-1) ?? null);
    },
  };
}
