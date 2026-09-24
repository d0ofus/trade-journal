import type { AlpacaCandleCredentials } from "./market-candles";
import type { SplitAdjustment, StockSplit } from "@/lib/workstation/split-adjustment";
import { SharedRequests, waitForHistory } from "@/lib/workstation/shared-requests";
import { takeProviderSlot, deferProviderRequests } from "./workstation-cache-store";
import { CacheBusyError, CacheProviderError } from "./workstation-cache-provider";
import { localDateTimeToEpoch } from "./market-session-calendar";

const requests = new SharedRequests<SplitAdjustment>();
const cache = new Map<string, { expires: number; value: SplitAdjustment }>();
const foregroundDemand = new Map<string, number>();

export function parseStockSplits(body: unknown, symbol: string, now: number): StockSplit[] {
  if (!body || typeof body !== "object" || !("corporate_actions" in body)) throw new Error("Invalid corporate action response.");
  const actions = body.corporate_actions;
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) throw new Error("Invalid corporate actions.");
  const splits: StockSplit[] = [];
  for (const type of ["forward_splits", "reverse_splits"]) {
    const rows = (actions as Record<string, unknown>)[type] ?? [];
    if (!Array.isArray(rows)) throw new Error("Invalid stock splits.");
    for (const row of rows) {
      if (!row || row.symbol !== symbol || typeof row.ex_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.ex_date) ||
        typeof row.new_rate !== "number" || typeof row.old_rate !== "number" || !Number.isFinite(row.new_rate) || !Number.isFinite(row.old_rate) || row.new_rate <= 0 || row.old_rate <= 0) throw new Error("Unverified stock split.");
      const [year, month, day] = row.ex_date.split("-").map(Number);
      if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== row.ex_date) throw new Error("Invalid split date.");
      const time = localDateTimeToEpoch({ year, month, day }, 0, 0), ratio = row.new_rate / row.old_rate;
      if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("Invalid split ratio.");
      if (time <= now) splits.push({ time, ratio });
    }
  }
  return splits;
}

/** Small public metadata cache, shared across panels; failures are never cached as 'no splits'. */
export async function loadStockSplits(symbol: string, credentials: AlpacaCandleCredentials, signal?: AbortSignal, background = false): Promise<SplitAdjustment> {
  const today = new Date().toISOString().slice(0, 10), key = `${credentials.baseUrl}:${symbol}:${today}`;
  signal?.throwIfAborted();
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  if (!background) foregroundDemand.set(key, (foregroundDemand.get(key) ?? 0) + 1);
  try { return await requests.run(key, signal, async signal => {
    const splits: StockSplit[] = [], seen = new Set<string>();
    let token: string | null = null;
    const deadline = Date.now() + 45_000;
    do {
      // A workspace request joining peer metadata work promotes the shared request.
      while (!(await takeProviderSlot(background && !foregroundDemand.has(key)))) {
        if (Date.now() > deadline) throw new CacheBusyError();
        await waitForHistory(525, signal);
      }
      signal.throwIfAborted();
      const url = new URL(`${credentials.baseUrl}/v1/corporate-actions`);
      url.search = new URLSearchParams({ symbols: symbol, types: "forward_split,reverse_split", start: "1970-01-01", end: today, limit: "1000", sort: "asc" }).toString();
      if (token) url.searchParams.set("page_token", token);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]), headers: { "APCA-API-KEY-ID": credentials.keyId, "APCA-API-SECRET-KEY": credentials.secretKey } });
      if (!response.ok) {
        if (response.status === 429) await deferProviderRequests(60);
        throw new CacheProviderError(response.status, response.status === 429 ? 60 : 0);
      }
      const body = await response.json();
      splits.push(...parseStockSplits(body, symbol, Date.now() / 1000));
      token = body.next_page_token ?? null;
      if (token !== null && (typeof token !== "string" || seen.has(token) || seen.size >= 10)) throw new Error("Incomplete stock split history.");
      if (token) seen.add(token);
    } while (token);
    signal.throwIfAborted();
    const unique = new Map<number, number>();
    for (const split of splits) {
      if (unique.has(split.time) && unique.get(split.time) !== split.ratio) throw new Error("Conflicting stock splits.");
      unique.set(split.time, split.ratio);
    }
    const value: SplitAdjustment = { version: 1, asOf: today, splits: [...unique].map(([time, ratio]) => ({ time, ratio })).sort((a, b) => a.time - b.time) };
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 300_000, value });
    return value;
  }); } finally {
    if (!background) { const remaining = (foregroundDemand.get(key) ?? 1) - 1; if (remaining) foregroundDemand.set(key, remaining); else foregroundDemand.delete(key); }
  }
}
