import { aggregateRegularHours, isRegularHour } from "@/lib/workstation/regular-hours";
import { isRegularUsSession } from "@/lib/workstation/chart-session";
import { waitForHistory } from "@/lib/workstation/shared-requests";
import type { Candle } from "@/lib/workstation/types";
import type { PeerCandleQuery, PeerSeries } from "@/lib/workstation/peers";
import { workstationCandlePolicy } from "./workstation-candle-policy";
import { takeProviderSlot, deferProviderRequests } from "./workstation-cache-store";
import { validateCandles } from "./workstation-cache-codec";

// The only database operations permitted here are the existing tiny rate leases.
// Do not route peer requests through the persistent workstation candle loaders.
const resolutions = { "5m": "5Min", "10m": "10Min", "15m": "15Min", "1h": "1Hour", "1d": "1Day", "1wk": "1Week" };
class PeerProviderError extends Error {
  constructor(message: string, readonly status = 502, readonly retryAfter = 0) { super(message); }
}
export async function loadPeerCandles(input: PeerCandleQuery, signal: AbortSignal): Promise<PeerSeries[]> {
  const policy = workstationCandlePolicy();
  if (!policy.credentials) throw new Error("Peer charts require the workstation Alpaca provider and credentials.");
  const credentials = policy.credentials;
  const to = Math.min(input.to, Math.floor(Date.now() / 1000) - policy.delaySeconds - 1);
  const hourly = isRegularHour(input.timeframe, input.session);
  const from = hourly ? Math.floor(input.from / 86400) * 86400 : input.from;
  const range = { from: input.from, to: Math.max(input.from, to) };
  const deadline = Date.now() + 55000;
  const base = { range, adjustment: input.adjustment, feed: credentials.feed, source: `Alpaca ${credentials.feed.toUpperCase()} · ${input.adjustment}`, identity: `peers:v1:alpaca:${credentials.feed}:${input.adjustment}:${input.timeframe}:${input.session}` };
  async function fetchBatch(symbols: string[]): Promise<PeerSeries[]> {
    const rows = new Map(symbols.map(symbol => [symbol, [] as Candle[]]));
    const tokens = new Set<string>();
    let token: string | null = null, total = 0;
    try {
      if (to <= input.from) throw new PeerProviderError("This date range is inside the provider's data delay.");
      do {
        signal.throwIfAborted();
        while (!(await takeProviderSlot(true))) {
          if (Date.now() > deadline) throw new PeerProviderError("Peer history is queued behind the main charts. Retry shortly.", 429, 5);
          await waitForHistory(1050, signal);
        }
        if (Date.now() > deadline) throw new PeerProviderError("This range needs more history than one request can load. Zoom in or select a coarser timeframe.");
        const url = new URL(`${credentials.baseUrl}/v2/stocks/bars`);
        url.search = new URLSearchParams({ symbols: symbols.join(","), timeframe: hourly ? "5Min" : resolutions[input.timeframe], start: new Date(from * 1000).toISOString(), end: new Date(to * 1000 - 1).toISOString(), limit: "10000", feed: credentials.feed, adjustment: input.adjustment, sort: "asc", ...(token ? { page_token: token } : {}) }).toString();
        const response = await fetch(url, { cache: "no-store", headers: { "APCA-API-KEY-ID": credentials.keyId, "APCA-API-SECRET-KEY": credentials.secretKey }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
        if (!response.ok) {
          const retry = response.headers.get("retry-after"), reset = Number(response.headers.get("x-ratelimit-reset"));
          const retrySeconds = retry ? /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000 : reset ? reset - Date.now() / 1000 : 60;
          const cooldown = Math.ceil(Math.min(3600, Math.max(1, Number.isFinite(retrySeconds) ? retrySeconds : 60)));
          if (response.status === 429) await deferProviderRequests(cooldown);
          throw new PeerProviderError(response.status === 429 ? "Alpaca rate limit reached. Retry after the cooldown." : response.status === 401 || response.status === 403 ? "Alpaca credentials or feed access are unavailable." : `Alpaca could not load this symbol or range (${response.status}).`, response.status, response.status === 429 ? cooldown : 0);
        }
        const body = await response.json();
        if (!body || typeof body !== "object" || !Object.hasOwn(body, "bars") || body.bars !== null && (typeof body.bars !== "object" || Array.isArray(body.bars))) throw new Error("Invalid Alpaca history response.");
        for (const symbol of symbols) {
          const values = body.bars?.[symbol] ?? [];
          if (!Array.isArray(values)) throw new Error("Invalid Alpaca symbol history.");
          const candles = validateCandles(values.map((b: Record<string, unknown>) => {
            if (typeof b.t !== "string" || [b.o, b.h, b.l, b.c, b.v].some(v => typeof v !== "number")) throw new Error("Invalid Alpaca candle.");
            return { time: Date.parse(b.t) / 1000, open: b.o as number, high: b.h as number, low: b.l as number, close: b.c as number, volume: b.v as number };
          }));
          total += candles.length;
          if (total > 40000) throw new Error("This range is too large. Zoom in or choose a coarser timeframe.");
          rows.get(symbol)!.push(...candles.map(c => ({ ...c, volume: c.volume ?? 0 })));
        }
        token = body.next_page_token ?? null;
        if (token !== null && (typeof token !== "string" || tokens.has(token) || tokens.size >= 20)) throw new Error("Alpaca returned incomplete pagination. Retry a smaller range.");
        if (token) tokens.add(token);
      } while (token);
      signal.throwIfAborted();
      return symbols.map(symbol => {
        const source = validateCandles(rows.get(symbol)!);
        const candles = (hourly ? aggregateRegularHours(source) : source).filter(c => c.time >= input.from && c.time < to && (input.session !== "regular" || ["1d", "1wk"].includes(input.timeframe) || isRegularUsSession(c.time))).map(c => ({ ...c, volume: c.volume ?? 0 }));
        return { ...base, symbol, candles, status: candles.length ? "ready" : "empty" };
      });
    } catch (error) {
      signal.throwIfAborted();
      // Isolate an unsupported ticker without losing its healthy batch neighbours.
      if (error instanceof PeerProviderError && [400, 404, 422].includes(error.status) && symbols.length > 1) {
        const results: PeerSeries[] = [];
        for (const symbol of symbols) results.push(...await fetchBatch([symbol]));
        return results;
      }
      return symbols.map(symbol => ({ ...base, symbol, candles: [], status: "error", error: error instanceof Error ? error.message : "Peer history unavailable.", retryAfter: error instanceof PeerProviderError ? error.retryAfter : 0 }));
    }
  }
  return fetchBatch(input.symbols);
}
