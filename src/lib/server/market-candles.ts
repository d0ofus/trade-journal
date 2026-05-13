export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type CandleTimeframe = "5m" | "10m" | "15m" | "1h" | "1d" | "1wk";
export type CandleRange = { from: number; to: number } | null;

const TIMEFRAME_CONFIG: Record<CandleTimeframe, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "60d" },
  "10m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "1d": { interval: "1d", range: "10y" },
  "1wk": { interval: "1wk", range: "10y" },
};

export const SAFE_SYMBOL_PATTERN = /^[A-Z0-9.^=_-]{1,20}$/;

export function parseCandleTimeframe(value: string | null | undefined): CandleTimeframe {
  const timeframeRaw = (value ?? "1d").trim().toLowerCase();
  return timeframeRaw === "5m" || timeframeRaw === "5min"
    ? "5m"
    : timeframeRaw === "10m" || timeframeRaw === "10min"
      ? "10m"
      : timeframeRaw === "15m" || timeframeRaw === "15min"
        ? "15m"
        : timeframeRaw === "1h" || timeframeRaw === "60m"
          ? "1h"
          : timeframeRaw === "1w" || timeframeRaw === "1wk" || timeframeRaw === "w"
            ? "1wk"
            : "1d";
}

function dedupeCandles(rows: Candle[]) {
  const byTime = new Map<number, Candle>();
  for (const row of rows) byTime.set(row.time, row);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function normalizedYahooRange(fromRaw: number, toRaw: number, timeframe: CandleTimeframe) {
  const intervalSeconds =
    timeframe === "5m"
      ? 5 * 60
      : timeframe === "10m"
        ? 10 * 60
        : timeframe === "15m"
          ? 15 * 60
          : timeframe === "1h"
            ? 60 * 60
            : timeframe === "1wk"
              ? 7 * 24 * 60 * 60
              : 24 * 60 * 60;
  const period1 = Math.floor(fromRaw / intervalSeconds) * intervalSeconds;
  const period2 =
    timeframe === "1d" || timeframe === "1wk"
      ? (Math.floor(toRaw / intervalSeconds) + 1) * intervalSeconds
      : Math.ceil(toRaw / intervalSeconds) * intervalSeconds;

  return { period1, period2: Math.max(period1 + intervalSeconds, period2) };
}

function aggregateCandles(rows: Candle[], bucketSeconds: number) {
  const buckets = new Map<number, Candle[]>();
  for (const row of rows) {
    const bucket = Math.floor(row.time / bucketSeconds) * bucketSeconds;
    const list = buckets.get(bucket) ?? [];
    list.push(row);
    buckets.set(bucket, list);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, bucketRows]) => {
      const sorted = bucketRows.sort((a, b) => a.time - b.time);
      const volume = sorted.reduce((sum, row) => sum + (Number.isFinite(row.volume) ? Number(row.volume) : 0), 0);
      return {
        time,
        open: sorted[0].open,
        high: Math.max(...sorted.map((row) => row.high)),
        low: Math.min(...sorted.map((row) => row.low)),
        close: sorted[sorted.length - 1].close,
        volume: volume > 0 ? volume : undefined,
      };
    });
}

function trimTrailingDuplicateDailyCandle(rows: Candle[]) {
  if (rows.length < 2) return rows;
  const trimmed = [...rows];
  while (trimmed.length >= 2) {
    const last = trimmed[trimmed.length - 1];
    const previous = trimmed[trimmed.length - 2];
    const looksDuplicated =
      last.open === previous.open &&
      last.high === previous.high &&
      last.low === previous.low &&
      last.close === previous.close;
    if (!looksDuplicated) break;
    trimmed.pop();
  }
  return trimmed;
}

function parseCsvRows(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [] as Candle[];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    date: headers.indexOf("date"),
    open: headers.indexOf("open"),
    high: headers.indexOf("high"),
    low: headers.indexOf("low"),
    close: headers.indexOf("close"),
    volume: headers.indexOf("volume"),
  };

  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",");
    const rawTime = cols[idx.date];
    const ts = rawTime ? Date.parse(`${rawTime}T00:00:00.000Z`) : Number.NaN;
    const row = {
      time: Number.isFinite(ts) ? Math.floor(ts / 1000) : Number.NaN,
      open: Number(cols[idx.open]),
      high: Number(cols[idx.high]),
      low: Number(cols[idx.low]),
      close: Number(cols[idx.close]),
      volume: idx.volume >= 0 ? Number(cols[idx.volume]) : undefined,
    };
    if (!row.time || [row.open, row.high, row.low, row.close].some((v) => !Number.isFinite(v))) return [];
    return [row];
  });
}

function parseYahooRows(payload: unknown) {
  const result = (payload as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> } }> } })?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) return [] as Candle[];

  const open = quote.open ?? [];
  const high = quote.high ?? [];
  const low = quote.low ?? [];
  const close = quote.close ?? [];
  const volume = quote.volume ?? [];
  const size = Math.min(timestamps.length, open.length, high.length, low.length, close.length);
  const rows: Candle[] = [];
  for (let i = 0; i < size; i += 1) {
    const row = {
      time: timestamps[i],
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i],
    };
    if (
      Number.isFinite(row.time) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close)
    ) {
      rows.push({
        time: Number(row.time),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number.isFinite(row.volume) ? Number(row.volume) : undefined,
      });
    }
  }
  return dedupeCandles(rows);
}

export async function loadCandlesForSymbol(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: CandleRange;
  limit: number;
}) {
  const { symbol, timeframe, range, limit } = input;
  const config = TIMEFRAME_CONFIG[timeframe];
  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  yahooUrl.searchParams.set("interval", config.interval);
  if (range) {
    const normalizedRange = normalizedYahooRange(range.from, range.to, timeframe);
    yahooUrl.searchParams.set("period1", String(normalizedRange.period1));
    yahooUrl.searchParams.set("period2", String(normalizedRange.period2));
  } else {
    yahooUrl.searchParams.set("range", config.range);
  }
  yahooUrl.searchParams.set("includePrePost", "false");
  yahooUrl.searchParams.set("events", "div,splits");

  const yahooRes = await fetch(yahooUrl.toString(), { cache: "no-store" });
  if (yahooRes.ok) {
    const payload = await yahooRes.json();
    const parsedRows = dedupeCandles(parseYahooRows(payload));
    const rows =
      timeframe === "1d" || timeframe === "1wk"
        ? trimTrailingDuplicateDailyCandle(parsedRows)
        : timeframe === "10m"
          ? aggregateCandles(parsedRows, 10 * 60)
          : parsedRows;
    if (rows.length > 0) return { symbol, candles: rows.slice(-limit) };
  }

  if (timeframe === "1d") {
    const candidates = [symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`, symbol.toLowerCase()];
    for (const candidate of candidates) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const csvText = await res.text();
      const rows = trimTrailingDuplicateDailyCandle(dedupeCandles(parseCsvRows(csvText)));
      if (rows.length > 0) return { symbol: candidate.toUpperCase(), candles: rows.slice(-limit) };
    }
  }

  return null;
}
