import type { AlpacaCandleCredentials, Candle, CandleTimeframe } from "./market-candles";
import type { CandleRange } from "@/lib/workstation/candle-ranges";
import { AlpacaCandleError } from "./alpaca-candle-error";
import { validateCandles } from "./workstation-cache-codec";
import { deferProviderRequests, takeProviderSlot } from "./workstation-cache-store";

const intervals: Record<CandleTimeframe, string> = { "5m": "5Min", "10m": "10Min", "15m": "15Min", "1h": "1Hour", "1d": "1Day", "1wk": "1Week" };
export class CacheBusyError extends Error { constructor() { super("Chart history is queued; cached candles remain available."); } }
export class CacheProviderError extends AlpacaCandleError {
  constructor(status: number, readonly retryAfterSeconds: number) { super("http", status); }
}
/** Workstation fetch only: no writes to the legacy candle cache. A 200 empty result is meaningful coverage. */
export async function fetchCompactCandles(symbol: string, timeframe: CandleTimeframe, range: CandleRange, credentials: AlpacaCandleCredentials, background = false, coordinate = true): Promise<Candle[]> {
  const rows: Candle[] = []; let token: string | null = null; const seen = new Set<string>();
  const deadline = Date.now() + 45_000;
  do {
    while (coordinate && !(await takeProviderSlot(background))) {
      if (Date.now() > deadline) throw new CacheBusyError();
      await new Promise(resolve => setTimeout(resolve, background ? 1050 : 525));
    }
    if (Date.now() > deadline) throw new CacheBusyError();
    const url = new URL(`${credentials.baseUrl}/v2/stocks/bars`);
    for (const [key, value] of Object.entries({ symbols: symbol, timeframe: intervals[timeframe], start: new Date(range.from * 1000).toISOString(), end: new Date(range.to * 1000 - 1).toISOString(), limit: "10000", feed: credentials.feed, adjustment: credentials.adjustment, sort: "asc" })) url.searchParams.set(key, value);
    if (token) url.searchParams.set("page_token", token);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000), headers: { "APCA-API-KEY-ID": credentials.keyId, "APCA-API-SECRET-KEY": credentials.secretKey } });
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 0;
      const retrySeconds = Number.isFinite(seconds) ? Math.min(86400, Math.max(0, seconds)) : 0;
      if (response.status === 429 && coordinate) await deferProviderRequests(Math.max(60, retrySeconds));
      throw new CacheProviderError(response.status, retrySeconds);
    }
    const body = await response.json();
    if (!body || typeof body !== "object" || !Object.hasOwn(body, "bars") || (body.bars !== null && (typeof body.bars !== "object" || Array.isArray(body.bars)))) throw new Error("Invalid provider response.");
    const values = body.bars?.[symbol] ?? [];
    if (!Array.isArray(values)) throw new Error("Invalid provider bars.");
    rows.push(...validateCandles(values.map((b: Record<string, unknown>) => {
      if (typeof b.t !== "string" || [b.o, b.h, b.l, b.c].some(v => typeof v !== "number") || (b.v != null && typeof b.v !== "number")) throw new Error("Invalid provider bar.");
      return { time: Date.parse(b.t) / 1000, open: b.o as number, high: b.h as number, low: b.l as number, close: b.c as number, volume: b.v == null ? undefined : b.v as number };
    })));
    token = body.next_page_token ?? null;
    if (token !== null && (typeof token !== "string" || seen.has(token) || seen.size >= 20 || rows.length > 30_000)) throw new Error("Incomplete provider pagination; cache coverage was not changed.");
    if (token) seen.add(token);
  } while (token);
  return validateCandles(rows).filter(c => c.time >= range.from && c.time < range.to);
}
