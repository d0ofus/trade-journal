import type { MarketMetrics } from "./market-metrics";
import { Candle, CandleResult, TradeDocument, WorkstationAdapter, seconds } from "./types";
import { metricIdentity } from "./share-eligibility";
import { REVIEW_PACKAGE_MAX_BYTES, REVIEW_PACKAGE_TOO_LARGE } from "./payload";
import { tradeChartSession } from "./chart-session";
import { CandleMemory } from "./candle-memory";
import type { CandleCacheMetadata } from "./candle-ranges";
import { SharedRequests } from "./shared-requests";
import { externalizeEvidence, forgetPendingEvidence } from "./evidence-storage";
export function createApplicationAdapter(): WorkstationAdapter {
  let privateWrites = false;
  const cache = new CandleMemory();
  const inflight = new SharedRequests<CandleResult>();
  const metricRequests = new SharedRequests<MarketMetrics>();
  const legacy = new Map<string, { at: number; result: CandleResult }>();
  async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { credentials: "same-origin", ...init }); const body = await response.json(); if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed"); return body as T; }
  const candles = async (mode: "cache" | "fill" | "refresh", purpose: "benchmark" | undefined, ...[trade, interval, signal, range, identity]: Parameters<WorkstationAdapter["candles"]>): Promise<CandleResult> => {
      signal?.throwIfAborted();
      const session = trade.chartSession ?? tradeChartSession(trade);
      const padding = Math.max(seconds[interval] * 240, trade.closeTime - trade.openTime);
      const from = range?.from ?? Math.max(1, trade.openTime - padding), to = range?.to ?? trade.closeTime + Math.max(seconds[interval] * 60, 86400);
      const base = `${trade.symbol}:${interval}:${session}`;
      const cached = cache.get(base, { from, to: to + 0.001 }, identity);
      if (mode !== "refresh" && cached?.cache?.status === "hit") return cached;
      const key = `${base}:${from}:${to}:${identity ?? "initial"}:${mode}:${purpose ?? "primary"}`;
      const previous = legacy.get(key);
      if (mode !== "refresh" && previous && Date.now() - previous.at < 300000) return previous.result;
      return inflight.run(key, signal, async sharedSignal => {
      const params = new URLSearchParams({ symbol: trade.symbol, timeframe: interval, from: String(from), to: String(to), limit: "30000", adjustment: "split", mode });
      if (purpose) { params.set("purpose", purpose); if (mode === "fill") params.set("mode", "complete"); }
      if (identity) params.set("identity", identity);
      params.set("session", session);
      const response = await request<{ candles: Candle[]; source?: string; provider?: CandleResult["provider"]; metadata?: { splitAdjustment?: CandleResult["splitAdjustment"]; cache?: CandleCacheMetadata; warnings?: string[]; truncated?: boolean; session?: CandleResult["session"] } }>(`/api/workstation/candles?${params}`, { priority: purpose ? "low" : "high", signal: AbortSignal.any([sharedSignal, AbortSignal.timeout(120000)]) });
      sharedSignal.throwIfAborted();
      const providerLabel = response.provider ? `${response.provider.provider.toUpperCase()}${response.provider.feed ? ` ${response.provider.feed.toUpperCase()}` : ""} / ${response.provider.adjustment}${response.provider.cached ? " / cache" : ""}${response.provider.fallback ? " / fallback" : ""}` : response.source ?? "Provider";
      const result: CandleResult = { splitAdjustment: response.metadata?.splitAdjustment, cache: response.metadata?.cache, identity: response.provider?.identity, provider: response.provider, session: response.metadata?.session, candles: response.candles.map(c => ({ ...c, volume: c.volume ?? 0 })), source: providerLabel, warning: response.metadata?.warnings?.join(" · ") || (response.metadata?.cache?.enabled ? "" : "Provider history · UTC"), truncated: response.metadata?.truncated ?? false };
      cache.put(base, result);
      if (!result.cache?.enabled && result.candles.length && !result.truncated && !response.metadata?.warnings?.length) {
        if (legacy.size >= 48) legacy.delete(legacy.keys().next().value!);
        legacy.set(key, { at: Date.now(), result });
      }
      return result;
      });
  };
  return {
    mode: "application",
    benchmarkCandles: (symbol, trade, interval, signal, range, mode = "fill") => candles(mode, "benchmark", { ...trade, symbol }, interval, signal, range),
    metrics: (trade, signal) => metricRequests.run(metricIdentity(trade), signal, sharedSignal => request(`/api/closed-trades/${encodeURIComponent(trade.id)}/market-metrics`, { signal: sharedSignal, priority: "low" })),
    loadView: id => request(`/api/closed-trades/${encodeURIComponent(id)}/workstation/view`),
    saveView: (id, view, expectedRevision) => request(`/api/closed-trades/${encodeURIComponent(id)}/workstation/view`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view, expectedRevision }), keepalive: true }),
    load: async id => { const response = await fetch(`/api/closed-trades/${encodeURIComponent(id)}/workstation`, { credentials: "same-origin", cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Review load failed"); privateWrites = response.headers.get("X-Evidence-Writes") === "r2"; return body as TradeDocument; },
    async save(id, document, expectedRevision) {
      if (privateWrites && document.evidence.some(e => !e.asset)) document = await externalizeEvidence(id, "application", document);
      const body = JSON.stringify({ document: { ...document, legacy: undefined }, expectedRevision });
      if (new TextEncoder().encode(body).byteLength > REVIEW_PACKAGE_MAX_BYTES) throw new Error(REVIEW_PACKAGE_TOO_LARGE);
      // The archive is server-owned and need not be uploaded with every keystroke.
      const saved = await request<TradeDocument>(`/api/closed-trades/${encodeURIComponent(id)}/workstation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
      for (const evidence of saved.evidence) if (evidence.asset) void forgetPendingEvidence(id, "application", evidence.id).catch(() => {});
      return saved;
    },
    candles: (...args) => candles("fill", undefined, ...args),
    cachedCandles: (...args) => candles("cache", undefined, ...args),
    refreshCandles: (...args) => candles("refresh", undefined, ...args),
  };
}
