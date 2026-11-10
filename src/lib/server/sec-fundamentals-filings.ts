import { readFundamentalDocument, type FilingContext } from "./sec-fundamentals-document";
import { eligibleFundamentalFacts, fundamentalCurrency, mergeFundamentalFacts, parseFundamentalQuarters, supportedSecForm, type FundamentalFacts } from "./sec-fundamentals-parser";

type Cached = { value: unknown; fetchedAt: string; stale: boolean };
export type FilingDependencies = {
  json: (url: string, signal: AbortSignal) => Promise<unknown>;
  text: (url: string, signal: AbortSignal) => Promise<string>;
  cached: (key: string, age: number, read: (signal: AbortSignal) => Promise<unknown>) => Promise<Cached>;
};
type Filing = { accn: string; filed: string; form: string; document: string };
type Columns = { accessionNumber?: string[]; filingDate?: string[]; form?: string[]; primaryDocument?: string[] };
const unsupportedDocument = (error: unknown) => !!error && typeof error === "object" && "status" in error && [404, 413].includes(Number(error.status));
function documentUrls(paths: string[], base: string, primary: string): string[] {
  return [...new Set(paths.flatMap(path => {
    try { const url = new URL(path, base); url.hash = ""; return url.href.startsWith(base) && !url.search && /^[\w.-]+\.(?:html?|xml)$/i.test(url.pathname.split("/").at(-1)!) && !/_(?:cal|def|lab|pre)\.xml$/.test(url.pathname) && url.href !== base + primary && !/-index\.html?$/.test(url.pathname) ? [url.href] : []; } catch { return []; }
  }))];
}
function filings(input: Columns): Filing[] {
  return (input.form ?? []).flatMap((form, i) => {
    const accn = input.accessionNumber?.[i], filed = input.filingDate?.[i], document = input.primaryDocument?.[i];
    return supportedSecForm(form) && accn && /^\d{10}-\d{2}-\d{6}$/.test(accn) && filed && /^\d{4}-\d{2}-\d{2}$/.test(filed) && document && /^[\w.-]+\.(?:html?|xml)$/i.test(document) ? [{ accn, filed, form, document }] : [];
  });
}
export function hasCompleteFundamentalCoverage(facts: FundamentalFacts, cutoff: string | null): boolean {
  const rows = parseFundamentalQuarters(facts, cutoff);
  if (rows.length < 8 || rows.some(q => !q.revenue || !q.netIncome)) return false;
  if (rows.some((q, i) => i > 0 && q.fiscalYear * 4 + q.fiscalQuarter !== rows[i - 1].fiscalYear * 4 + rows[i - 1].fiscalQuarter + 1)) return false;
  const end = rows.at(-1)!.periodEnd, limit = cutoff ?? new Date().toISOString().slice(0, 10);
  // Allow normal reporting lag; a populated but outdated series also needs fallback.
  return Date.parse(limit) - Date.parse(end) <= 185 * 86400000;
}
export function needsFundamentalFilingCheck(facts: FundamentalFacts, cutoff: string | null): boolean {
  if (!hasCompleteFundamentalCoverage(facts, cutoff)) return true;
  const last = parseFundamentalQuarters(facts, cutoff).at(-1)!;
  // Once another quarter could have ended, check recent filings even if the
  // structured feed still contains eight apparently complete older quarters.
  return Date.parse(cutoff ?? new Date().toISOString().slice(0, 10)) - Date.parse(last.periodEnd) >= 75 * 86400000;
}

export async function loadFundamentalFilings(cik: string, initial: FundamentalFacts, cutoff: string | null, signal: AbortSignal, deps: FilingDependencies) {
  let facts = initial, stale = false, incomplete = false, ambiguous = false, unsupported = false, financial = false, scanned = 0;
  let retrievalError: string | null = null;
  let fetchedAt: string | null = null;
  const initiallyComplete = hasCompleteFundamentalCoverage(initial, cutoff), lastPeriod = parseFundamentalQuarters(initial, cutoff).at(-1)?.periodEnd;
  const knownAccessions = new Set(eligibleFundamentalFacts(initial, cutoff).map(f => f.accn));
  const boundary = cutoff ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const from = new Date(`${boundary}T00:00:00Z`); from.setUTCMonth(from.getUTCMonth() - 36); const since = from.toISOString().slice(0, 10);
  const oldestRelevant = eligibleFundamentalFacts(initial, cutoff).filter(f => (Date.parse(f.end) - Date.parse(f.start)) / 86400000 >= 329).sort((a, b) => b.end.localeCompare(a.end))[0];
  const eligible = eligibleFundamentalFacts(initial, cutoff), standard = eligible.slice().sort((a, b) => b.filed.localeCompare(a.filed)).find(f => f.taxonomy)?.taxonomy;
  const defaults = { currency: fundamentalCurrency(initial, cutoff) ?? undefined, standard, fiscalYearEnd: oldestRelevant?.end.slice(5).replace("-", "") };
  // Inferred context must not leak from a later request into a historical one.
  const basis = `${defaults.currency ?? "unknown"}:${defaults.standard ?? "unknown"}:${defaults.fiscalYearEnd ?? "unknown"}`;
  try {
    const listing = await deps.cached(`submissions:v2:${cik}`, 15 * 60_000, s => deps.json(`https://data.sec.gov/submissions/CIK${cik}.json`, s));
    fetchedAt = listing.fetchedAt; stale ||= listing.stale;
    const submission = listing.value as { filings?: { recent?: Columns; files?: { name: string; filingFrom: string; filingTo: string }[] } };
    if (!submission.filings?.recent?.form) throw new Error("Invalid SEC submissions.");
    let candidates = filings(submission.filings.recent);
    for (const file of submission.filings.files ?? []) {
      if (file.filingTo < since || file.filingFrom >= boundary || !/^CIK\d{10}-submissions-\d+\.json$/.test(file.name)) continue;
      const old = await deps.cached(`submissions:v2:${file.name}`, 24 * 3600000, s => deps.json(`https://data.sec.gov/submissions/${file.name}`, s));
      stale ||= old.stale; candidates.push(...filings(old.value as Columns));
    }
    candidates = [...new Map(candidates.filter(f => f.filed < boundary && f.filed >= since && (!initiallyComplete || f.filed > lastPeriod! && !knownAccessions.has(f.accn))).map(f => [f.accn, f])).values()].sort((a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn));
    // Every issuer uses the same discovery and document readers. Accessions are immutable.
    for (const filing of candidates) {
      signal.throwIfAborted();
      let entry: Cached;
      let completed: FundamentalFacts = {}, completedFinancial = false, completedAmbiguous = false;
      try { entry = await deps.cached(`filing:v2:${cik}:${filing.accn}:${basis}`, 365 * 86400000, async s => {
        const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accn.replaceAll("-", "")}/`;
        const context: FilingContext = { ...filing, ...defaults };
        async function readDocument(document: string) {
          const cached = await deps.cached(`document:v2:${cik}:${filing.accn}:${document}:${basis}`, 365 * 86400000, async documentSignal => {
            const html = await deps.text(base + document, AbortSignal.any([s, documentSignal]));
            const parsed = readFundamentalDocument(html, { ...context, document });
            const content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
            return { ...parsed, earnings: /financial results|(?:quarter|annual|half.year|interim).{0,50}(?:results|financial)|results.{0,50}(?:quarter|year|months)|2\.02|financial statements|statements of (?:income|operations)/i.test(content), hasExhibits: /exhibits?[^<]{0,30}99\./i.test(html) };
          });
          const parsed = cached.value as ReturnType<typeof readFundamentalDocument> & { earnings: boolean; hasExhibits: boolean };
          completed = mergeFundamentalFacts(completed, parsed.facts); completedFinancial ||= parsed.financial; completedAmbiguous ||= parsed.ambiguous; stale ||= cached.stale;
          return parsed;
        }
        let primary: Awaited<ReturnType<typeof readDocument>>, unsupported = false;
        try { primary = await readDocument(filing.document); }
        catch (error) {
          if (!unsupportedDocument(error)) throw error;
          unsupported = true;
          primary = { facts: {}, links: [], financial: false, ambiguous: false, earnings: true, hasExhibits: false };
        }
        let found = primary.facts, financial = primary.financial, ambiguous = primary.ambiguous;
        const { earnings, hasExhibits } = primary;
        if (!earnings && !financial && !hasExhibits) return { facts: found, financial, ambiguous, unsupported };
        let urls = documentUrls(primary.links, base, filing.document);
        // 40-F and 8-K statements may only be listed as attachments in the index.
        if (!urls.length) {
          const index = await deps.json(base + "index.json", s) as { directory?: { item?: { name?: string }[] } };
          urls = documentUrls((index.directory?.item ?? []).flatMap(item => item.name ? [item.name] : []), base, filing.document);
        }
        for (const url of urls) {
          try {
            const parsed = await readDocument(url.split("/").at(-1)!);
            found = mergeFundamentalFacts(found, parsed.facts); financial ||= parsed.financial; ambiguous ||= parsed.ambiguous;
          } catch (error) { if (!unsupportedDocument(error)) throw error; unsupported = true; }
        }
        unsupported = earnings && !Object.values(found).some(f => f.length);
        return { facts: found, financial, ambiguous, unsupported };
      }); } catch (error) {
        facts = mergeFundamentalFacts(facts, completed); financial ||= completedFinancial; ambiguous ||= completedAmbiguous;
        if (!unsupportedDocument(error)) throw error;
        unsupported = true; scanned++; continue;
      }
      const parsed = entry.value as { facts: FundamentalFacts; financial: boolean; ambiguous: boolean; unsupported: boolean };
      facts = mergeFundamentalFacts(facts, parsed.facts); stale ||= entry.stale; financial ||= parsed.financial; ambiguous ||= parsed.ambiguous; unsupported ||= parsed.unsupported; scanned++;
      if (!initiallyComplete && hasCompleteFundamentalCoverage(facts, cutoff)) break;
    }
  } catch (error) {
    if (signal.aborted && signal.reason?.name !== "TimeoutError") throw signal.reason;
    incomplete = true; retrievalError = error instanceof Error ? error.message : "SEC retrieval failed.";
  }
  return { facts, stale, incomplete, ambiguous, unsupported, financial, scanned, fetchedAt, retrievalError };
}
