import { prisma } from "@/lib/prisma";
import { inferBarIntervalSeconds } from "@/lib/charts/execution-marker-alignment";
import {
  evaluateUsEquitiesCandleCoverage,
  isSessionAwareTimeframe,
  type CandleCoverage,
  type CandleSessionProfile,
  unverifiedCandleCoverage,
  US_EQUITIES_CORE_PROFILE,
} from "@/lib/server/market-session-calendar";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type CandleTimeframe = "5m" | "10m" | "15m" | "1h" | "1d" | "1wk";
export type CandleRange = { from: number; to: number } | null;
export type CandleCacheKind = "native" | "derived-5m";
export type CandleResponseMetadata = {
  requestedRange: CandleRange;
  returnedRange: CandleRange;
  barIntervalSeconds: number | null;
  limit: number;
  truncated: boolean;
  warnings: string[];
};
export type LoadedCandles = {
  symbol: string;
  candles: Candle[];
  source: string | null;
  cacheKind?: CandleCacheKind;
  coverage?: CandleCoverage;
  warnings?: string[];
};

const TIMEFRAME_CONFIG: Record<CandleTimeframe, { interval: string; range: string; defaultDays: number }> = {
  "5m": { interval: "5m", range: "60d", defaultDays: 60 },
  "10m": { interval: "5m", range: "60d", defaultDays: 60 },
  "15m": { interval: "15m", range: "60d", defaultDays: 60 },
  "1h": { interval: "60m", range: "730d", defaultDays: 730 },
  "1d": { interval: "1d", range: "10y", defaultDays: 3650 },
  "1wk": { interval: "1wk", range: "10y", defaultDays: 3650 },
};

const ALPACA_TIMEFRAME: Record<CandleTimeframe, string> = {
  "5m": "5Min",
  "10m": "10Min",
  "15m": "15Min",
  "1h": "1Hour",
  "1d": "1Day",
  "1wk": "1Week",
};

const ALPACA_SOURCE = "alpaca";
const DEMO_SOURCE = "demo";
const READABLE_CACHE_SOURCES = [ALPACA_SOURCE, DEMO_SOURCE];
const MAX_ALPACA_BARS_PER_PAGE = 10_000;
const MAX_ALPACA_PAGES = 20;
const MAX_AGGREGATE_READ_ATTEMPTS = 6;
const MAX_AGGREGATE_SOURCE_ROWS = 100_000;
const MAX_AGGREGATE_SOURCE_MULTIPLIER = 8;
const US_EQUITY_EXCHANGES = new Set([
  "AMEX",
  "ARCA",
  "BATS",
  "CBOE",
  "EDGEA",
  "EDGX",
  "IEX",
  "ISLAND",
  "NASDAQ",
  "NASDAQCM",
  "NASDAQGM",
  "NASDAQGS",
  "NYSE",
  "NYSEARCA",
  "NYSEMKT",
  "SMART",
]);

export const SAFE_SYMBOL_PATTERN = /^[A-Z0-9.^=_-]{1,20}$/;

export function isCandleRequestAbort(error: unknown, signal?: AbortSignal) {
  return Boolean(signal?.aborted) || (error instanceof DOMException && error.name === "AbortError");
}

function throwIfCandleRequestAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("Candle request aborted.", "AbortError");
}

export function summarizeCandleResponse(input: {
  candles: Candle[];
  range: CandleRange;
  limit: number;
  loadedCount?: number;
}): CandleResponseMetadata {
  const candles = dedupeCandles(input.candles).filter((candle) => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  const first = candles[0];
  const last = candles.at(-1);
  const barIntervalSeconds = candles.length > 1 ? inferBarIntervalSeconds(candles) : null;
  const returnedRange = first && last ? { from: first.time, to: last.time } : null;
  const limit = Math.max(1, Math.floor(input.limit));
  const loadedCount = Number.isFinite(input.loadedCount) ? Math.max(0, Math.floor(Number(input.loadedCount))) : candles.length;
  const truncated = loadedCount > limit;
  const warnings: string[] = [];

  if (truncated) {
    warnings.push("Candle response reached the bar limit.");
  }
  if (input.range && returnedRange) {
    const tolerance = Math.max(barIntervalSeconds ?? 0, 24 * 60 * 60);
    if (returnedRange.from - input.range.from > tolerance) {
      warnings.push("Candle data starts after the requested range.");
    }
    if (input.range.to - returnedRange.to > tolerance) {
      warnings.push("Candle data ends before the requested range.");
    }
  }

  return {
    requestedRange: input.range,
    returnedRange,
    barIntervalSeconds,
    limit,
    truncated,
    warnings,
  };
}

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

function defaultRangeForTimeframe(timeframe: CandleTimeframe) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - TIMEFRAME_CONFIG[timeframe].defaultDays * 24 * 60 * 60;
  return { from, to };
}

function clipCandlesToRange(rows: Candle[], range: CandleRange) {
  const normalized = dedupeCandles(rows);
  return range
    ? normalized.filter((candle) => candle.time >= range.from && candle.time <= range.to)
    : normalized;
}

function timeframeIntervalSeconds(timeframe: CandleTimeframe) {
  return timeframe === "5m"
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
}

function cachedCandlesCoverRequestedRange(candles: Candle[], timeframe: CandleTimeframe, range: CandleRange) {
  if (!range) return true;
  const rows = dedupeCandles(candles);
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return false;
  const tolerance = Math.max(inferBarIntervalSeconds(rows) ?? 0, timeframeIntervalSeconds(timeframe));
  return first.time - range.from <= tolerance && range.to - last.time <= tolerance;
}

function cachedCandlesAreUsable(candles: Candle[], timeframe: CandleTimeframe, limit: number, range: CandleRange) {
  if (candles.length === 0) return false;
  const minimumBars = timeframe === "1d" || timeframe === "1wk" ? 5 : 20;
  return candles.length >= Math.min(minimumBars, Math.max(1, limit)) && cachedCandlesCoverRequestedRange(candles, timeframe, range);
}

function normalizedExchange(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase().replace(/[ ._-]/g, "");
}

async function resolveCandleSessionProfile(symbol: string, signal?: AbortSignal): Promise<CandleSessionProfile | null> {
  throwIfCandleRequestAborted(signal);
  try {
    const instruments = await prisma.instrument.findMany({
      where: { symbol },
      select: { assetType: true, currency: true, exchange: true },
      take: 25,
    });
    throwIfCandleRequestAborted(signal);
    if (instruments.length === 0) return null;
    const supported = instruments.every((instrument) =>
      (instrument.assetType === "STOCK" || instrument.assetType === "ETF") &&
      instrument.currency.trim().toUpperCase() === "USD" &&
      US_EQUITY_EXCHANGES.has(normalizedExchange(instrument.exchange)),
    );
    return supported ? US_EQUITIES_CORE_PROFILE : null;
  } catch (error) {
    if (isCandleRequestAbort(error, signal)) throw error;
    return null;
  }
}

function candleCoverage(input: {
  candles: Candle[];
  timeframe: CandleTimeframe;
  range: CandleRange;
  effectiveRange: { from: number; to: number };
  limit: number;
  profile: CandleSessionProfile | null;
  scanExhausted?: boolean;
}) {
  if (!input.profile || !isSessionAwareTimeframe(input.timeframe)) {
    return unverifiedCandleCoverage(input.scanExhausted);
  }
  const range = input.range ?? input.effectiveRange;
  return evaluateUsEquitiesCandleCoverage({
    candleTimes: input.candles.map((candle) => candle.time),
    timeframe: input.timeframe,
    from: range.from,
    to: range.to,
    limit: input.limit,
    scanExhausted: input.scanExhausted,
  });
}

function coverageIsUsable(coverage: CandleCoverage, legacyUsable: boolean) {
  if (coverage.status === "unverified") return legacyUsable;
  return coverage.status === "complete" || coverage.status === "closed" || coverage.status === "limited";
}

function providerUnavailableWarning(provider: string, hasFallbackCandles: boolean) {
  return `${provider} candle provider unavailable; ${hasFallbackCandles ? "showing cached candles." : "no candle data returned."}`;
}

function providerEmptyWarning(provider: string, hasFallbackCandles: boolean) {
  return `${provider} candle provider returned no usable data; ${hasFallbackCandles ? "showing cached candles." : "no candle data returned."}`;
}

function cacheUnavailableWarning(hasProviderFallback: boolean) {
  return `Candle cache unavailable; ${hasProviderFallback ? "using live provider candles." : "no cached candle fallback available."}`;
}

function alpacaCredentials() {
  const keyId = process.env.ALPACA_API_KEY_ID ?? process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_API_SECRET_KEY ?? process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) return null;
  return {
    keyId,
    secretKey,
    baseUrl: (process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets").replace(/\/+$/, ""),
    feed: process.env.ALPACA_DATA_FEED ?? "iex",
    adjustment: process.env.ALPACA_ADJUSTMENT ?? "raw",
  };
}

async function readCachedCandles(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: CandleRange;
  limit: number;
  preferLatest?: boolean;
  signal?: AbortSignal;
}) {
  throwIfCandleRequestAborted(input.signal);
  const where = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    source: { in: READABLE_CACHE_SOURCES },
    time: input.range
      ? {
          gte: new Date(input.range.from * 1000),
          lte: new Date(input.range.to * 1000),
        }
      : undefined,
  };

  const descending = !input.range || input.preferLatest;
  const rows = await prisma.marketCandle.findMany({
    where,
    orderBy: descending ? { time: "desc" } : { time: "asc" },
    take: Math.max(1, input.limit),
  });
  throwIfCandleRequestAborted(input.signal);

  return (descending ? rows.reverse() : rows).map((row) => ({
    time: Math.floor(row.time.getTime() / 1000),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? undefined,
  }));
}

async function readCachedCandlesWithRetry(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: CandleRange;
  limit: number;
  preferLatest?: boolean;
  signal?: AbortSignal;
}) {
  try {
    return await readCachedCandles(input);
  } catch (firstError) {
    if (isCandleRequestAbort(firstError, input.signal)) throw firstError;
    try {
      return await readCachedCandles(input);
    } catch (retryError) {
      if (isCandleRequestAbort(retryError, input.signal)) throw retryError;
      throw firstError;
    }
  }
}

function aggregateCachePlan(timeframe: CandleTimeframe) {
  if (timeframe === "10m") return { bucketSeconds: 10 * 60, sourceTimeframe: "5m" as const };
  if (timeframe === "15m") return { bucketSeconds: 15 * 60, sourceTimeframe: "5m" as const };
  return null;
}

async function readAggregatedCachedCandles(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: CandleRange;
  limit: number;
  signal?: AbortSignal;
}) {
  const plan = aggregateCachePlan(input.timeframe);
  if (!plan) return { candles: [] as Candle[], scanExhausted: false };

  const sourceIntervalSeconds = timeframeIntervalSeconds(plan.sourceTimeframe);
  const sourceBarsPerTargetBar = Math.ceil(plan.bucketSeconds / sourceIntervalSeconds);
  const sourceRange = input.range
    ? {
        from: Math.floor(input.range.from / plan.bucketSeconds) * plan.bucketSeconds,
        to:
          input.timeframe === "15m"
            ? Math.floor(input.range.to / plan.bucketSeconds) * plan.bucketSeconds + plan.bucketSeconds - sourceIntervalSeconds
            : input.range.to,
      }
    : null;
  let sourceLimit =
    input.limit * sourceBarsPerTargetBar +
    (input.timeframe === "15m" ? sourceBarsPerTargetBar - 1 : 0);
  const maximumSourceLimit = Math.min(
    MAX_AGGREGATE_SOURCE_ROWS,
    input.limit * sourceBarsPerTargetBar * MAX_AGGREGATE_SOURCE_MULTIPLIER + sourceBarsPerTargetBar,
  );
  let clipped: Candle[] = [];
  let scanExhausted = false;

  for (let attempt = 0; attempt < MAX_AGGREGATE_READ_ATTEMPTS; attempt += 1) {
    throwIfCandleRequestAborted(input.signal);
    const sourceCandles = await readCachedCandlesWithRetry({
      symbol: input.symbol,
      timeframe: plan.sourceTimeframe,
      range: sourceRange,
      limit: sourceLimit,
      preferLatest: input.timeframe === "15m",
      signal: input.signal,
    });
    const aggregated =
      input.timeframe === "15m"
        ? aggregateCompleteCandles(sourceCandles, plan.bucketSeconds, sourceIntervalSeconds)
        : aggregateCandles(sourceCandles, plan.bucketSeconds);
    clipped = input.range
      ? aggregated.filter((candle) => candle.time >= input.range!.from && candle.time <= input.range!.to)
      : aggregated;

    const canReadFarther = sourceCandles.length >= sourceLimit;
    if (input.timeframe !== "15m" || clipped.length >= input.limit || !canReadFarther) {
      break;
    }
    if (sourceLimit >= maximumSourceLimit || attempt === MAX_AGGREGATE_READ_ATTEMPTS - 1) {
      scanExhausted = true;
      break;
    }
    const missingTargetBars = input.limit - clipped.length;
    sourceLimit = Math.min(
      maximumSourceLimit,
      Math.max(sourceLimit * 2, sourceLimit + missingTargetBars * sourceBarsPerTargetBar + sourceBarsPerTargetBar),
    );
  }

  return { candles: clipped.slice(-input.limit), scanExhausted };
}

function chunked<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function cacheAlpacaCandles(symbol: string, timeframe: CandleTimeframe, candles: Candle[]) {
  const rows = dedupeCandles(candles).filter((candle) =>
    [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite),
  );
  if (rows.length === 0) return;

  for (const chunk of chunked(rows, 1000)) {
    await prisma.marketCandle.createMany({
      data: chunk.map((candle) => ({
        symbol,
        timeframe,
        source: ALPACA_SOURCE,
        time: new Date(candle.time * 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number.isFinite(candle.volume) ? candle.volume : undefined,
      })),
      skipDuplicates: true,
    });
  }

  const refreshRows = rows.slice(-50);
  for (const candle of refreshRows) {
    await prisma.marketCandle.upsert({
      where: {
        symbol_timeframe_time_source: {
          symbol,
          timeframe,
          source: ALPACA_SOURCE,
          time: new Date(candle.time * 1000),
        },
      },
      update: {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number.isFinite(candle.volume) ? candle.volume : undefined,
      },
      create: {
        symbol,
        timeframe,
        source: ALPACA_SOURCE,
        time: new Date(candle.time * 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number.isFinite(candle.volume) ? candle.volume : undefined,
      },
    });
  }
}

function parseAlpacaRows(payload: unknown, symbol: string) {
  const bars = (payload as { bars?: Record<string, Array<{ t?: string; o?: number; h?: number; l?: number; c?: number; v?: number }>> })?.bars?.[symbol] ?? [];
  return bars.flatMap((bar): Candle[] => {
    const parsed = bar.t ? Date.parse(bar.t) : Number.NaN;
    const row = {
      time: Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Number.NaN,
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number.isFinite(bar.v) ? Number(bar.v) : undefined,
    };
    return [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite) ? [row] : [];
  });
}

async function loadAlpacaCandlesForSymbol(input: {
  symbol: string;
  timeframe: CandleTimeframe;
  range: { from: number; to: number };
  limit: number;
  signal?: AbortSignal;
}) {
  throwIfCandleRequestAborted(input.signal);
  const credentials = alpacaCredentials();
  if (!credentials) return null;

  const rows: Candle[] = [];
  let pageToken: string | null = null;
  let page = 0;
  const targetLimit = Math.max(1, input.limit);

  do {
    throwIfCandleRequestAborted(input.signal);
    const url = new URL(`${credentials.baseUrl}/v2/stocks/bars`);
    url.searchParams.set("symbols", input.symbol);
    url.searchParams.set("timeframe", ALPACA_TIMEFRAME[input.timeframe]);
    url.searchParams.set("start", new Date(input.range.from * 1000).toISOString());
    url.searchParams.set("end", new Date(input.range.to * 1000).toISOString());
    url.searchParams.set("limit", String(Math.min(MAX_ALPACA_BARS_PER_PAGE, Math.max(1, targetLimit - rows.length))));
    url.searchParams.set("adjustment", credentials.adjustment);
    url.searchParams.set("feed", credentials.feed);
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: input.signal,
      headers: {
        "APCA-API-KEY-ID": credentials.keyId,
        "APCA-API-SECRET-KEY": credentials.secretKey,
      },
    });
    if (!res.ok) throw new Error("Alpaca candle provider unavailable.");

    const payload = await res.json();
    throwIfCandleRequestAborted(input.signal);
    rows.push(...parseAlpacaRows(payload, input.symbol));
    pageToken = (payload as { next_page_token?: string | null }).next_page_token ?? null;
    page += 1;
  } while (pageToken && rows.length < targetLimit && page < MAX_ALPACA_PAGES);

  const candles = dedupeCandles(rows).slice(-targetLimit);
  if (candles.length === 0) throw new Error("Alpaca candle provider returned no usable data.");

  // Once usable provider data is accepted, finish its durable cache write even if the caller disconnects.
  throwIfCandleRequestAborted(input.signal);
  let cacheWriteWarning: string | null = null;
  try {
    await cacheAlpacaCandles(input.symbol, input.timeframe, candles);
  } catch {
    cacheWriteWarning = "Candle cache update failed; showing live provider candles.";
  }
  throwIfCandleRequestAborted(input.signal);
  return {
    symbol: input.symbol,
    candles,
    source: ALPACA_SOURCE,
    warnings: cacheWriteWarning ? [cacheWriteWarning] : undefined,
  };
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
  const period2 = (Math.floor(toRaw / intervalSeconds) + 1) * intervalSeconds;

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

type YahooChartResult = {
  timestamp?: number[];
  meta?: {
    instrumentType?: string;
    exchangeName?: string;
    fullExchangeName?: string;
    exchangeTimezoneName?: string;
  };
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

function yahooChartResult(payload: unknown) {
  return (payload as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0] ?? null;
}

function yahooSessionProfile(payload: unknown): CandleSessionProfile | null {
  const meta = yahooChartResult(payload)?.meta;
  const instrumentType = (meta?.instrumentType ?? "").trim().toUpperCase();
  const exchange = normalizedExchange(meta?.exchangeName ?? meta?.fullExchangeName);
  return (instrumentType === "EQUITY" || instrumentType === "ETF") &&
    meta?.exchangeTimezoneName === US_EQUITIES_CORE_PROFILE.timezone &&
    US_EQUITY_EXCHANGES.has(exchange)
    ? US_EQUITIES_CORE_PROFILE
    : null;
}

function parseYahooRows(payload: unknown) {
  const result = yahooChartResult(payload);
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
  signal?: AbortSignal;
}): Promise<LoadedCandles> {
  const { timeframe, range, limit } = input;
  throwIfCandleRequestAborted(input.signal);
  const symbol = input.symbol.trim().toUpperCase();
  const config = TIMEFRAME_CONFIG[timeframe];
  const boundedLimit = Math.max(1, limit);
  const effectiveRange = range ?? defaultRangeForTimeframe(timeframe);
  const sessionProfile = await resolveCandleSessionProfile(symbol, input.signal);
  throwIfCandleRequestAborted(input.signal);
  const warnings: string[] = [];
  let cacheReadFailed = false;
  let cached: Candle[] = [];
  let cacheKind: CandleCacheKind | undefined = "native";
  let cacheCoverage = unverifiedCandleCoverage();
  let cacheScanExhausted = false;
  try {
    cached = await readCachedCandlesWithRetry({
      symbol,
      timeframe,
      range,
      limit: boundedLimit,
      preferLatest: timeframe === "15m",
      signal: input.signal,
    });
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    cacheReadFailed = true;
  }

  if (timeframe === "15m") {
    const nativeCached = cached;
    let derivedCached: Candle[] = [];
    let derivedScanExhausted = false;
    let derivedCacheReadFailed = false;
    try {
      const derived = await readAggregatedCachedCandles({ symbol, timeframe, range, limit: boundedLimit, signal: input.signal });
      derivedCached = derived.candles;
      derivedScanExhausted = derived.scanExhausted;
    } catch (error) {
      if (isCandleRequestAbort(error, input.signal)) throw error;
      derivedCacheReadFailed = true;
    }
    const selected = chooseBestCacheCandidate(
      nativeCached,
      derivedCached,
      range,
      effectiveRange,
      boundedLimit,
      sessionProfile,
      derivedScanExhausted,
    );
    cached = selected?.candles ?? [];
    cacheKind = selected?.cacheKind;
    cacheCoverage = selected?.coverage ?? candleCoverage({
      candles: [],
      timeframe,
      range,
      effectiveRange,
      limit: boundedLimit,
      profile: sessionProfile,
      scanExhausted: derivedScanExhausted,
    });
    cacheScanExhausted = selected?.scanExhausted ?? derivedScanExhausted;
    cacheReadFailed = cacheReadFailed && derivedCacheReadFailed;
    if (selected?.usable) {
      return {
        symbol,
        candles: selected.candles.slice(-boundedLimit),
        source: "cache",
        cacheKind: selected.cacheKind,
        coverage: selected.coverage,
      };
    }
  } else {
    cacheCoverage = candleCoverage({
      candles: cached,
      timeframe,
      range,
      effectiveRange,
      limit: boundedLimit,
      profile: sessionProfile,
    });
    if (coverageIsUsable(cacheCoverage, cachedCandlesAreUsable(cached, timeframe, boundedLimit, range))) {
      return { symbol, candles: cached.slice(-boundedLimit), source: "cache", cacheKind, coverage: cacheCoverage };
    }
    if (!cacheReadFailed && cached.length === 0 && aggregateCachePlan(timeframe)) {
      try {
        const derived = await readAggregatedCachedCandles({ symbol, timeframe, range, limit: boundedLimit, signal: input.signal });
        cached = derived.candles;
        cacheScanExhausted = derived.scanExhausted;
        cacheKind = "derived-5m";
      } catch (error) {
        if (isCandleRequestAbort(error, input.signal)) throw error;
        cacheReadFailed = true;
      }
      cacheCoverage = candleCoverage({
        candles: cached,
        timeframe,
        range,
        effectiveRange,
        limit: boundedLimit,
        profile: sessionProfile,
        scanExhausted: cacheScanExhausted,
      });
      if (coverageIsUsable(cacheCoverage, cachedCandlesAreUsable(cached, timeframe, boundedLimit, range))) {
        return { symbol, candles: cached, source: "cache", cacheKind, coverage: cacheCoverage };
      }
    }
  }

  let alpaca: LoadedCandles | null = null;
  try {
    alpaca = await loadAlpacaCandlesForSymbol({
      symbol,
      timeframe,
      range: effectiveRange,
      limit: boundedLimit,
      signal: input.signal,
    });
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    warnings.push(providerUnavailableWarning("Alpaca", cached.length > 0));
  }
  if (alpaca) {
    const providerCandles = clipCandlesToRange(alpaca.candles, range);
    const providerCoverage = candleCoverage({
      candles: providerCandles,
      timeframe,
      range,
      effectiveRange,
      limit: boundedLimit,
      profile: US_EQUITIES_CORE_PROFILE,
    });
    if (providerCandlesShouldReplaceCache(providerCandles, cached, timeframe, range, boundedLimit, providerCoverage, cacheCoverage)) {
      return {
        ...alpaca,
        candles: providerCandles,
        coverage: providerCoverage,
        warnings: [
          ...(cacheReadFailed ? [cacheUnavailableWarning(true)] : []),
          ...(timeframe === "15m" && cached.length > 0
            ? ["15-minute candle cache coverage is incomplete; using live provider candles."]
            : []),
          ...(alpaca.warnings ?? []),
        ],
      };
    }
    warnings.push("Alpaca candle provider returned partial coverage; keeping the more complete candle cache.");
  }

  if (cacheReadFailed) {
    warnings.push(cacheUnavailableWarning(false));
  }

  if (!range && cached.length > 0 && timeframe !== "15m") {
    return { symbol, candles: cached.slice(-boundedLimit), source: "cache", cacheKind, warnings };
  }

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

  try {
    const yahooRes = await fetch(yahooUrl.toString(), { cache: "no-store", signal: input.signal });
    throwIfCandleRequestAborted(input.signal);
    if (yahooRes.ok) {
      const payload = await yahooRes.json();
      throwIfCandleRequestAborted(input.signal);
      const parsedRows = dedupeCandles(parseYahooRows(payload));
      const rows = clipCandlesToRange(
        timeframe === "1d" || timeframe === "1wk"
          ? trimTrailingDuplicateDailyCandle(parsedRows)
          : timeframe === "10m"
            ? aggregateCandles(parsedRows, 10 * 60)
            : parsedRows,
        range,
      );
      const providerCoverage = candleCoverage({
        candles: rows,
        timeframe,
        range,
        effectiveRange,
        limit: boundedLimit,
        profile: yahooSessionProfile(payload) ?? sessionProfile,
      });
      if (rows.length > 0 && providerCandlesShouldReplaceCache(rows, cached, timeframe, range, boundedLimit, providerCoverage, cacheCoverage)) {
        return {
          symbol,
          candles: rows.slice(-boundedLimit),
          source: "yahoo",
          coverage: providerCoverage,
          warnings: [
            ...warnings,
            ...(timeframe === "15m" && cached.length > 0
              ? ["15-minute candle cache coverage is incomplete; using live provider candles."]
              : []),
          ],
        };
      }
      warnings.push(
        rows.length > 0
          ? "Yahoo candle provider returned partial coverage; keeping the more complete candle cache."
          : providerEmptyWarning("Yahoo", cached.length > 0),
      );
    } else {
      warnings.push(providerUnavailableWarning("Yahoo", cached.length > 0));
    }
  } catch (error) {
    if (isCandleRequestAbort(error, input.signal)) throw error;
    warnings.push(providerUnavailableWarning("Yahoo", cached.length > 0));
  }

  if (timeframe === "1d") {
    const candidates = [symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`, symbol.toLowerCase()];
    let stooqFetchFailed = false;
    for (const candidate of candidates) {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
      try {
        const res = await fetch(url, { cache: "no-store", signal: input.signal });
        throwIfCandleRequestAborted(input.signal);
        if (!res.ok) {
          stooqFetchFailed = true;
          continue;
        }
        const csvText = await res.text();
        throwIfCandleRequestAborted(input.signal);
        const rows = clipCandlesToRange(trimTrailingDuplicateDailyCandle(dedupeCandles(parseCsvRows(csvText))), range);
        const providerCoverage = unverifiedCandleCoverage();
        if (rows.length > 0 && providerCandlesShouldReplaceCache(rows, cached, timeframe, range, boundedLimit, providerCoverage, cacheCoverage)) {
          return {
            symbol: candidate.toUpperCase(),
            candles: rows.slice(-boundedLimit),
            source: "stooq",
            coverage: providerCoverage,
            warnings,
          };
        }
      } catch (error) {
        if (isCandleRequestAbort(error, input.signal)) throw error;
        stooqFetchFailed = true;
      }
    }
    warnings.push(stooqFetchFailed ? providerUnavailableWarning("Stooq", cached.length > 0) : providerEmptyWarning("Stooq", cached.length > 0));
  }

  if (cached.length > 0) {
    throwIfCandleRequestAborted(input.signal);
    return {
      symbol,
      candles: cached.slice(-boundedLimit),
      source: "cache",
      cacheKind,
      coverage: candleCoverage({
        candles: cached,
        timeframe,
        range,
        effectiveRange,
        limit: boundedLimit,
        profile: sessionProfile,
        scanExhausted: cacheScanExhausted,
      }),
      warnings: [
        ...(timeframe === "15m"
          ? ["15-minute candle cache coverage is incomplete; showing the best available cached candles."]
          : []),
        ...warnings,
      ],
    };
  }

  throwIfCandleRequestAborted(input.signal);
  return {
    symbol,
    candles: [],
    source: null,
    coverage: candleCoverage({
      candles: [],
      timeframe,
      range,
      effectiveRange,
      limit: boundedLimit,
      profile: sessionProfile,
      scanExhausted: cacheScanExhausted,
    }),
    warnings,
  };
}

function aggregateCompleteCandles(rows: Candle[], bucketSeconds: number, sourceIntervalSeconds: number) {
  const normalized = dedupeCandles(rows).filter((row) =>
    [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite),
  );
  const buckets = new Map<number, Map<number, Candle>>();
  for (const row of normalized) {
    const bucket = Math.floor(row.time / bucketSeconds) * bucketSeconds;
    const bucketRows = buckets.get(bucket) ?? new Map<number, Candle>();
    bucketRows.set(row.time, row);
    buckets.set(bucket, bucketRows);
  }

  const expectedRows = Math.floor(bucketSeconds / sourceIntervalSeconds);
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([time, bucketRows]) => {
      const sorted = Array.from({ length: expectedRows }, (_, index) =>
        bucketRows.get(time + index * sourceIntervalSeconds),
      );
      if (bucketRows.size !== expectedRows || sorted.some((row) => !row)) return [];
      const completeRows = sorted as Candle[];
      const hasCompleteVolume = completeRows.every((row) => Number.isFinite(row.volume));
      return [{
        time,
        open: completeRows[0].open,
        high: Math.max(...completeRows.map((row) => row.high)),
        low: Math.min(...completeRows.map((row) => row.low)),
        close: completeRows[completeRows.length - 1].close,
        volume: hasCompleteVolume
          ? completeRows.reduce((sum, row) => sum + Number(row.volume), 0)
          : undefined,
      }];
    });
}

type CacheCandidate = {
  candles: Candle[];
  cacheKind: CandleCacheKind;
  usable: boolean;
  coverage: CandleCoverage;
  scanExhausted: boolean;
};

function candidateCoverageSeconds(candles: Candle[], range: CandleRange, intervalSeconds: number) {
  const rows = dedupeCandles(candles);
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return 0;
  if (!range) return Math.max(0, last.time - first.time) + intervalSeconds;
  const start = Math.max(range.from, first.time);
  const end = Math.min(range.to, last.time + intervalSeconds);
  return Math.max(0, end - start);
}

function compareCandleQuality(left: Candle[], right: Candle[], range: CandleRange, intervalSeconds: number) {
  const leftRows = dedupeCandles(left);
  const rightRows = dedupeCandles(right);
  const leftLast = leftRows.at(-1)?.time ?? Number.NEGATIVE_INFINITY;
  const rightLast = rightRows.at(-1)?.time ?? Number.NEGATIVE_INFINITY;

  if (!range && Math.abs(leftLast - rightLast) > intervalSeconds) {
    return rightLast - leftLast;
  }
  if (range) {
    const coverageDifference =
      candidateCoverageSeconds(rightRows, range, intervalSeconds) -
      candidateCoverageSeconds(leftRows, range, intervalSeconds);
    if (coverageDifference !== 0) return coverageDifference;
  }
  if (leftRows.length !== rightRows.length) return rightRows.length - leftRows.length;
  if (leftLast !== rightLast) return rightLast - leftLast;
  return 0;
}

function coverageStatusRank(status: CandleCoverage["status"]) {
  return status === "complete" ? 5 : status === "limited" ? 4 : status === "closed" ? 4 : status === "partial" ? 2 : 1;
}

function compareCoverageQuality(left: CandleCoverage, right: CandleCoverage) {
  const statusDifference = coverageStatusRank(right.status) - coverageStatusRank(left.status);
  if (statusDifference !== 0) return statusDifference;
  if (left.presentBars !== right.presentBars) return right.presentBars - left.presentBars;
  if (left.missingBars !== right.missingBars) return left.missingBars - right.missingBars;
  if (left.scanExhausted !== right.scanExhausted) return left.scanExhausted ? 1 : -1;
  return 0;
}

function providerCandlesShouldReplaceCache(
  providerCandles: Candle[],
  cachedCandles: Candle[],
  timeframe: CandleTimeframe,
  range: CandleRange,
  limit: number,
  providerCoverage: CandleCoverage,
  cacheCoverage: CandleCoverage,
) {
  if (providerCandles.length === 0) return false;
  if (cachedCandles.length === 0) return true;
  const coverageDifference = compareCoverageQuality(providerCoverage, cacheCoverage);
  if (coverageDifference !== 0) return coverageDifference < 0;
  const providerUsable = cachedCandlesAreUsable(providerCandles, timeframe, limit, range);
  const cacheUsable = cachedCandlesAreUsable(cachedCandles, timeframe, limit, range);
  if (providerUsable !== cacheUsable) return providerUsable;
  if (!providerUsable && providerCandles.length < cachedCandles.length) return false;
  return compareCandleQuality(providerCandles, cachedCandles, range, timeframeIntervalSeconds(timeframe)) <= 0;
}

function candleTimesMatch(left: Candle[], right: Candle[]) {
  const leftTimes = dedupeCandles(left).map((candle) => candle.time);
  const rightTimes = dedupeCandles(right).map((candle) => candle.time);
  return leftTimes.length === rightTimes.length && leftTimes.every((time, index) => time === rightTimes[index]);
}

function chooseBestCacheCandidate(
  nativeCandles: Candle[],
  derivedCandles: Candle[],
  range: CandleRange,
  effectiveRange: { from: number; to: number },
  limit: number,
  sessionProfile: CandleSessionProfile | null,
  derivedScanExhausted: boolean,
): CacheCandidate | null {
  const candidates = ([
    {
      candles: dedupeCandles(nativeCandles),
      cacheKind: "native" as const,
      coverage: candleCoverage({
        candles: nativeCandles,
        timeframe: "15m",
        range,
        effectiveRange,
        limit,
        profile: sessionProfile,
      }),
      scanExhausted: false,
    },
    {
      candles: dedupeCandles(derivedCandles),
      cacheKind: "derived-5m" as const,
      coverage: candleCoverage({
        candles: derivedCandles,
        timeframe: "15m",
        range,
        effectiveRange,
        limit,
        profile: sessionProfile,
        scanExhausted: derivedScanExhausted,
      }),
      scanExhausted: derivedScanExhausted,
    },
  ].map((candidate) => ({
    ...candidate,
    usable: coverageIsUsable(
      candidate.coverage,
      cachedCandlesAreUsable(candidate.candles, "15m", limit, range),
    ),
  })) satisfies CacheCandidate[]).filter((candidate) => candidate.candles.length > 0 || candidate.coverage.status === "closed");
  if (candidates.length === 0) return null;

  return candidates.sort((left, right) => {
    if (left.usable !== right.usable) return left.usable ? -1 : 1;
    const coverageDifference = compareCoverageQuality(left.coverage, right.coverage);
    if (coverageDifference !== 0) return coverageDifference;
    const qualityDifference = compareCandleQuality(left.candles, right.candles, range, 15 * 60);
    if (qualityDifference !== 0) return qualityDifference;
    if (!candleTimesMatch(left.candles, right.candles)) {
      return left.cacheKind === "derived-5m" ? -1 : 1;
    }
    return left.cacheKind === "native" ? -1 : 1;
  })[0];
}
