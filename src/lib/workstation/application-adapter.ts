import { Candle, CandleResult, TradeDocument, WorkstationAdapter, seconds } from "./types";
import { jsonBytes, REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "./payload";
export function createApplicationAdapter(): WorkstationAdapter {
  const cache = new Map<string, { at: number; data: CandleResult }>();
  async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { credentials: "same-origin", ...init }); const body = await response.json(); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed"); return body as T; }
  return {
    mode: "application",
    load: id => request<TradeDocument>(`/api/closed-trades/${encodeURIComponent(id)}/workstation`),
    async save(id, document, expectedRevision) {
      if (jsonBytes({ document, expectedRevision }) > REVIEW_PACKAGE_MAX_BYTES) throw new Error(REVIEW_PACKAGE_TOO_LARGE);
      // The archive is server-owned and need not be uploaded with every keystroke.
      return request<TradeDocument>(`/api/closed-trades/${encodeURIComponent(id)}/workstation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: { ...document, legacy: undefined }, expectedRevision }) });
    },
    async candles(trade, interval, signal, range, identity) {
      signal?.throwIfAborted();
      const padding = Math.max(seconds[interval] * 240, trade.closeTime - trade.openTime);
      const from = range?.from ?? Math.max(1, trade.openTime - padding), to = range?.to ?? trade.closeTime + Math.max(seconds[interval] * 60, 86400);
      const key = `${trade.symbol}:${interval}:${from}:${to}:${identity ?? "initial"}`, cached = cache.get(key); if (cached && Date.now() - cached.at < 300000) return cached.data;
      const params = new URLSearchParams({ symbol: trade.symbol, timeframe: interval, from: String(from), to: String(to), limit: "30000" });
      if (identity) params.set("identity", identity);
      const response = await request<{ candles: Candle[]; source?: string; provider?: CandleResult["provider"]; metadata?: { warnings?: string[]; truncated?: boolean; session?: CandleResult["session"] } }>(`/api/workstation/candles?${params}`, { signal });
      signal?.throwIfAborted();
      const providerLabel = response.provider ? `${response.provider.provider.toUpperCase()}${response.provider.feed ? ` ${response.provider.feed.toUpperCase()}` : ""} / ${response.provider.adjustment}${response.provider.cached ? " / cache" : ""}${response.provider.fallback ? " / fallback" : ""}` : response.source ?? "Provider";
      const result = { identity: response.provider?.identity, provider: response.provider, session: response.metadata?.session, candles: response.candles.map(c => ({ ...c, volume: c.volume ?? 0 })), source: providerLabel, warning: response.metadata?.warnings?.join(" · ") || "Provider history · UTC", truncated: response.metadata?.truncated ?? false };
      // Failed, empty, partial, and truncated pages must remain retryable immediately.
      if (result.candles.length && !result.truncated && !response.metadata?.warnings?.length) {
        if (cache.size >= 48) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: Date.now(), data: result });
      }
      return result;
    },
  };
}
