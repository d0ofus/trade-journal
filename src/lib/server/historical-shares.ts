import { claimCacheLease } from "./workstation-cache-store";
import { waitForHistory } from "@/lib/workstation/shared-requests";

export type ShareFact = { val: number; end: string; filed: string; accn: string; start?: string };
export function selectShareFact(facts: ShareFact[], asOf: string): ShareFact | null {
  // Filings dated on the reference session are conservatively excluded: the
  // concept API doesn't establish whether they were public before the close.
  const eligible = facts.filter(f => !f.start && f.end <= asOf && f.filed < asOf && Number.isFinite(f.val) && f.val > 0);
  eligible.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const first = eligible[0];
  if (!first || eligible.some(f => f.end === first.end && f.filed === first.filed && f.val !== first.val)) return null;
  return first;
}
async function secJson(url: string, signal: AbortSignal) {
  const deadline = Date.now() + 12000;
  while (!(await claimCacheLease("rate:sec", 500))) { if (Date.now() >= deadline) throw new Error("SEC request queued"); await waitForHistory(525, signal); }
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), next: { revalidate: 86400 }, headers: { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "TradeJournal/1.0 (https://github.com/d0ofus/trade-journal)", Accept: "application/json" } });
  if (!response.ok) throw new Error("Historical shares unavailable");
  return response.json();
}
export async function historicalShares(symbol: string, asOf: string, signal: AbortSignal) {
  const tickers = await secJson("https://www.sec.gov/files/company_tickers.json", signal) as Record<string, { ticker: string; cik_str: number }>;
  const entries = Object.values(tickers), matches = entries.filter(t => t.ticker.toUpperCase() === symbol.replace(/\./g, "-").toUpperCase());
  if (matches.length !== 1 || entries.some(t => t.cik_str === matches[0].cik_str && t.ticker !== matches[0].ticker)) return null;
  const cik = String(matches[0].cik_str).padStart(10, "0");
  const source = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/dei/EntityCommonStockSharesOutstanding.json`;
  const data = await secJson(source, signal) as { units?: { shares?: ShareFact[] } };
  const fact = selectShareFact(data.units?.shares ?? [], asOf);
  return fact ? { ...fact, source } : null;
}
