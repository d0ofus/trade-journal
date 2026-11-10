import { emptyFundamentals, fundamentalsCutoff, type FundamentalsMode, type FundamentalsSnapshot } from "@/lib/workstation/fundamentals";
import { SharedRequests, waitForHistory } from "@/lib/workstation/shared-requests";
import type { Trade } from "@/lib/workstation/types";
import { shareEligibility } from "@/lib/workstation/share-eligibility";
import { extractFundamentalFacts, fundamentalCurrency, eligibleFundamentalFacts, parseFundamentalQuarters, type FundamentalFacts } from "./sec-fundamentals-parser";
import { hasCompleteFundamentalCoverage, needsFundamentalFilingCheck, loadFundamentalFilings } from "./sec-fundamentals-filings";
import { readSecCache, writeSecCache, type SecCacheEntry } from "./sec-fundamentals-cache";
import { claimCacheLease, releaseCacheLease, type CacheLease } from "./workstation-cache-store";
import { secJson, secText, SecRequestError } from "./sec-client";

type Dependencies = {
  read: typeof readSecCache; write: typeof writeSecCache; fetch: typeof secJson;
  text?: typeof secText;
  claim: (key: string, ms: number) => Promise<CacheLease | null>; release: typeof releaseCacheLease;
};
const defaults: Dependencies = { read: readSecCache, write: writeSecCache, fetch: secJson, text: secText, claim: claimCacheLease, release: releaseCacheLease };
const requests = new SharedRequests<SecCacheEntry & { stale: boolean }>();
const hour = 3_600_000;
const normalize = (symbol: string) => symbol.trim().toUpperCase().replace(/\./g, "-");
type Issuer = { cik: string; name: string };

export async function loadTradeFundamentals(trade: Trade, mode: FundamentalsMode, signal: AbortSignal, deps: Dependencies = defaults): Promise<FundamentalsSnapshot> {
  const cutoff = mode === "before-entry" ? fundamentalsCutoff(trade) : null;
  const result = emptyFundamentals(trade.symbol, mode, cutoff);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(105_000)]);
  if (mode === "before-entry" && !cutoff) return { ...result, status: "unresolved-date", message: "Resolve the entry execution date to view fundamentals before entry." };
  const shareBasis = shareEligibility(trade);
  if (!shareBasis || shareBasis === "etf") return { ...result, status: "unsupported", message: "SEC company fundamentals are available for stocks with identifiable financial statements." };
  async function cached(key: string, maxAge: (value: unknown) => number, fetchValue: (signal: AbortSignal) => Promise<unknown>) {
    const prior = await deps.read(key);
    if (prior && Date.now() - Date.parse(prior.fetchedAt) < maxAge(prior.value)) return { ...prior, stale: false };
    // The freshness requirement is part of the key; the actual provider work is
    // coordinated by a distributed lease shared across modes and server instances.
    return requests.run(`${key}:${mode}`, deadline, async parent => {
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
    const facts = await cached(`facts:v2:${issuer.cik}`, value => parseFundamentalQuarters(value as FundamentalFacts, cutoff).length ? mode === "latest" ? 15 * 60_000 : 24 * hour : hour,
      async signal => {
        try { return extractFundamentalFacts(await deps.fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${issuer.cik}.json`, signal)); }
        catch (error) { if (error instanceof SecRequestError && error.status === 404) return extractFundamentalFacts({ facts: {} }); throw error; }
      });
    const fallback = deps.text && needsFundamentalFilingCheck(facts.value as FundamentalFacts, cutoff)
      ? await loadFundamentalFilings(issuer.cik, facts.value as FundamentalFacts, cutoff, deadline, { json: deps.fetch, text: deps.text, cached: (key, age, read) => cached(key, () => age, read) }) : null;
    const combined = fallback?.facts ?? facts.value as FundamentalFacts, currency = fundamentalCurrency(combined, cutoff);
    const quarters = parseFundamentalQuarters(combined, cutoff, currency);
    const supported = Object.values(combined).some(f => f.length), eligible = eligibleFundamentalFacts(combined, cutoff).length;
    const stale = facts.stale || issuers.stale || !!fallback?.stale;
    const partial = !!fallback && (!hasCompleteFundamentalCoverage(combined, cutoff) || fallback.incomplete);
    const coverage = quarters.length ? partial ? "partial" : "complete" : fallback?.unsupported || fallback?.ambiguous || eligible && !currency ? "unsupported-format" : "no-quarterly-data";
    return { ...result, quarters, ...(currency ? { currency } : {}), coverage, fetchedAt: fallback?.fetchedAt ?? facts.fetchedAt, stale, retryable: stale || !!fallback?.incomplete, status: quarters.length ? "ready" : fallback?.incomplete ? "unavailable" : supported ? "empty" : "unsupported",
      message: stale ? "SEC could not be reached. Showing previously retrieved filings; retry shortly." : fallback?.incomplete ? "SEC retrieval is incomplete. Available quarters are shown; retry to continue." : quarters.length ? partial ? "Some quarterly results could not be extracted from SEC filings. Available quarters are shown." : null : coverage === "unsupported-format" ? "SEC filings were found, but their financial tables or reporting currency could not be identified reliably. PDF-only and scanned statements are not supported." : eligible ? "SEC financial results were found, but separate quarterly figures are not disclosed or could not be established safely." : supported ? "No eligible quarters were filed before this entry date." : "No supported revenue or net-income facts could be extracted from SEC filings." };
  } catch {
    signal.throwIfAborted();
    return { ...result, status: "unavailable", retryable: true, message: "SEC fundamentals are temporarily unavailable. Retry shortly." };
  }
}
