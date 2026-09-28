import { emptyFundamentals, fundamentalsCutoff, type FundamentalsMode, type FundamentalsSnapshot } from "@/lib/workstation/fundamentals";
import { SharedRequests, waitForHistory } from "@/lib/workstation/shared-requests";
import type { Trade } from "@/lib/workstation/types";
import { extractFundamentalFacts, parseFundamentalQuarters, type FundamentalFacts } from "./sec-fundamentals-parser";
import { readSecCache, writeSecCache, type SecCacheEntry } from "./sec-fundamentals-cache";
import { claimCacheLease, releaseCacheLease, type CacheLease } from "./workstation-cache-store";
import { secJson } from "./sec-client";

type Dependencies = {
  read: typeof readSecCache; write: typeof writeSecCache; fetch: typeof secJson;
  claim: (key: string, ms: number) => Promise<CacheLease | null>; release: typeof releaseCacheLease;
};
const defaults: Dependencies = { read: readSecCache, write: writeSecCache, fetch: secJson, claim: claimCacheLease, release: releaseCacheLease };
const requests = new SharedRequests<SecCacheEntry & { stale: boolean }>();
const hour = 3_600_000;
const normalize = (symbol: string) => symbol.trim().toUpperCase().replace(/\./g, "-");
type Issuer = { cik: string; name: string };

export async function loadTradeFundamentals(trade: Trade, mode: FundamentalsMode, signal: AbortSignal, deps: Dependencies = defaults): Promise<FundamentalsSnapshot> {
  const cutoff = mode === "before-entry" ? fundamentalsCutoff(trade) : null;
  const result = emptyFundamentals(trade.symbol, mode, cutoff);
  if (mode === "before-entry" && !cutoff) return { ...result, status: "unresolved-date", message: "Resolve the entry execution date to view fundamentals before entry." };
  if (trade.assetType && trade.assetType !== "STOCK") return { ...result, status: "unsupported", message: "SEC company fundamentals are available for stocks with supported USD US-GAAP filings." };
  async function cached(key: string, maxAge: (value: unknown) => number, fetchValue: (signal: AbortSignal) => Promise<unknown>) {
    const prior = await deps.read(key);
    if (prior && Date.now() - Date.parse(prior.fetchedAt) < maxAge(prior.value)) return { ...prior, stale: false };
    // The freshness requirement is part of the key; the actual provider work is
    // coordinated by a distributed lease shared across modes and server instances.
    return requests.run(`${key}:${mode}`, signal, async parent => {
      const bounded = AbortSignal.any([parent, AbortSignal.timeout(55_000)]);
      let lease: CacheLease | null = null;
      try {
        while (!(lease = await deps.claim(`sec:fundamentals:${key}`, 60_000))) {
          await waitForHistory(400, bounded);
          const available = await deps.read(key);
          if (available && Date.now() - Date.parse(available.fetchedAt) < maxAge(available.value)) return { ...available, stale: false };
        }
        const available = await deps.read(key);
        if (available && Date.now() - Date.parse(available.fetchedAt) < maxAge(available.value)) return { ...available, stale: false };
        const value = await fetchValue(bounded), entry = { value, fetchedAt: new Date().toISOString() };
        await deps.write(key, entry, lease);
        return { ...entry, stale: false };
      } catch (error) {
        parent.throwIfAborted();
        if (prior) return { ...prior, stale: true };
        throw error;
      } finally { if (lease) await deps.release(lease); }
    });
  }
  try {
    const issuers = await cached("tickers:v1", () => hour, async signal => {
      const json = await deps.fetch("https://www.sec.gov/files/company_tickers.json", signal);
      if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Invalid SEC ticker directory.");
      const map: Record<string, Issuer> = {};
      for (const value of Object.values(json)) {
        const row = value as { ticker?: string; cik_str?: number; title?: string };
        if (typeof row.ticker === "string" && Number.isInteger(row.cik_str) && row.cik_str! > 0 && typeof row.title === "string") map[normalize(row.ticker)] = { cik: String(row.cik_str).padStart(10, "0"), name: row.title };
      }
      if (!Object.keys(map).length) throw new Error("Invalid SEC ticker directory.");
      return map;
    });
    const issuer = (issuers.value as Record<string, Issuer>)[normalize(trade.symbol)];
    if (!issuer) return { ...result, status: issuers.stale ? "unavailable" : "unknown-ticker", fetchedAt: issuers.fetchedAt, stale: issuers.stale, retryable: issuers.stale, message: issuers.stale ? "SEC ticker lookup is temporarily unavailable. Retry shortly." : "No SEC issuer matched this ticker. Historical or renamed tickers may be unavailable." };
    result.issuer = issuer;
    const facts = await cached(`facts:v1:${issuer.cik}`, value => parseFundamentalQuarters(value as FundamentalFacts, cutoff).length ? mode === "latest" ? 15 * 60_000 : 24 * hour : hour,
      async signal => extractFundamentalFacts(await deps.fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${issuer.cik}.json`, signal)));
    const quarters = parseFundamentalQuarters(facts.value as FundamentalFacts, cutoff);
    const supported = Object.values(facts.value as FundamentalFacts).some(f => f.length);
    const stale = facts.stale || issuers.stale;
    return { ...result, quarters, fetchedAt: facts.fetchedAt, stale, retryable: stale, status: quarters.length ? "ready" : supported ? "empty" : "unsupported",
      message: stale ? "SEC could not be reached. Showing previously retrieved filings; retry shortly." : quarters.length ? null : supported ? "No eligible quarters were filed before this entry date." : "No supported USD revenue or net-income facts were found in SEC 10-Q/10-K filings." };
  } catch {
    signal.throwIfAborted();
    return { ...result, status: "unavailable", retryable: true, message: "SEC fundamentals are temporarily unavailable. Retry shortly." };
  }
}
