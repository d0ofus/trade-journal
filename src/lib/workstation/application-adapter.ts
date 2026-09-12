import { Candle, CandleResult, TradeDocument, WorkstationAdapter, seconds } from "./types";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "./payload";
import { tradeChartSession } from "./chart-session";
import { CandleMemory } from "./candle-memory";
import type { CandleCacheMetadata } from "./candle-ranges";
export function createApplicationAdapter(): WorkstationAdapter {
  const cache = new CandleMemory();
  const inflight = new Map<string, Promise<CandleResult>>();
  const legacy = new Map<string, { at: number; result: CandleResult }>();
  async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { credentials: "same-origin", ...init }); const body = await response.json(); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed"); return body as T; }
  const candles = async (mode: "cache" | "fill" | "refresh", ...[trade, interval, signal, range, identity]: Parameters<WorkstationAdapter["candles"]>): Promise<CandleResult> => {
      signal?.throwIfAborted();
      const session = trade.chartSession ?? tradeChartSession(trade);
      const padding = Math.max(seconds[interval] * 240, trade.closeTime - trade.openTime);
      const from = range?.from ?? Math.max(1, trade.openTime - padding), to = range?.to ?? trade.closeTime + Math.max(seconds[interval] * 60, 86400);
      const base = `${trade.symbol}:${interval}:${session}`;
      const cached = cache.get(base, { from, to: to + 0.001 }, identity);
      if (mode !== "refresh" && cached?.cache?.status === "hit") return cached;
      const key = `${base}:${from}:${to}:${identity ?? "initial"}:${mode}`;
      const previous = legacy.get(key);
      if (mode !== "refresh" && previous && Date.now() - previous.at < 300000) return previous.result;
      const existing = inflight.get(key); if (existing) return existing;
      const pending = (async () => {
      const params = new URLSearchParams({ symbol: trade.symbol, timeframe: interval, from: String(from), to: String(to), limit: "30000", mode });
      if (identity) params.set("identity", identity);
      params.set("session", session);
      const response = await request<{ candles: Candle[]; source?: string; provider?: CandleResult["provider"]; metadata?: { cache?: CandleCacheMetadata; warnings?: string[]; truncated?: boolean; session?: CandleResult["session"] } }>(`/api/workstation/candles?${params}`, { signal: AbortSignal.timeout(120000) });
      const providerLabel = response.provider ? `${response.provider.provider.toUpperCase()}${response.provider.feed ? ` ${response.provider.feed.toUpperCase()}` : ""} / ${response.provider.adjustment}${response.provider.cached ? " / cache" : ""}${response.provider.fallback ? " / fallback" : ""}` : response.source ?? "Provider";
      const result: CandleResult = { cache: response.metadata?.cache, identity: response.provider?.identity, provider: response.provider, session: response.metadata?.session, candles: response.candles.map(c => ({ ...c, volume: c.volume ?? 0 })), source: providerLabel, warning: response.metadata?.warnings?.join(" · ") || (response.metadata?.cache?.enabled ? "" : "Provider history · UTC"), truncated: response.metadata?.truncated ?? false };
      cache.put(base, result);
      if (!result.cache?.enabled && result.candles.length && !result.truncated && !response.metadata?.warnings?.length) {
        if (legacy.size >= 48) legacy.delete(legacy.keys().next().value!);
        legacy.set(key, { at: Date.now(), result });
      }
      return result;
      })();
      inflight.set(key, pending);
      try { const result = await pending; signal?.throwIfAborted(); return result; }
      finally { if (inflight.get(key) === pending) inflight.delete(key); }
  };
  return {
    mode: "application",
    load: id => request<TradeDocument>(`/api/closed-trades/${encodeURIComponent(id)}/workstation`),
    async save(id, document, expectedRevision) {
      if (jsonBytes({ document, expectedRevision }) > REVIEW_PACKAGE_MAX_BYTES) throw new Error(REVIEW_PACKAGE_TOO_LARGE);
      // The archive is server-owned and need not be uploaded with every keystroke.
      return request<TradeDocument>(`/api/closed-trades/${encodeURIComponent(id)}/workstation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: { ...document, legacy: undefined }, expectedRevision }) });
    },
    candles: (...args) => candles("fill", ...args),
    cachedCandles: (...args) => candles("cache", ...args),
    refreshCandles: (...args) => candles("refresh", ...args),
  };
}
