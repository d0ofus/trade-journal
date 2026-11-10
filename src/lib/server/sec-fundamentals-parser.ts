import type { AccountingStandard, FundamentalMetric, FundamentalQuarter, FundamentalSource } from "@/lib/workstation/fundamentals";

export const FUNDAMENTAL_TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet", "Revenue", "RevenueFromContractsWithCustomers"],
  netIncome: ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
} as const;
export const supportedSecForm = (form: string) => /^(?:10-[QK]|20-F|40-F|6-K|8-K)(?:\/A)?$/.test(form);
export type SecFact = {
  val: number; start: string; end: string; filed: string; accn: string; form: string; fy?: number; fp?: string;
  currency?: string; taxonomy?: AccountingStandard; incomeBasis?: "owners" | "consolidated";
  source?: FundamentalSource; reportingCurrency?: boolean;
  fiscalAnnual?: boolean;
};
export type FundamentalFacts = Record<string, SecFact[]>;
const day = 86_400_000;
const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / day + 1;
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const quarter = (f: SecFact) => days(f.start, f.end) >= 75 && days(f.start, f.end) <= 110;
const annual = (f: SecFact) => days(f.start, f.end) >= 330 && days(f.start, f.end) <= 400 && (/^(?:10-K|20-F|40-F)(?:\/A)?$/.test(f.form) || f.fp === "FY" || f.fiscalAnnual === true);
const sourceRank = (f: SecFact) => f.source?.kind === "statement" ? 1 : f.source?.kind === "xbrl" ? 2 : 3;
const newer = (a: SecFact, b: SecFact) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn) || sourceRank(a) - sourceRank(b);
export function validSecFact(f: SecFact) {
  return Number.isFinite(f.val) && validDate(f.start) && validDate(f.end) && validDate(f.filed) && f.start <= f.end && f.end <= f.filed && /^\d{10}-\d{2}-\d{6}$/.test(f.accn) && supportedSecForm(f.form);
}
export function extractFundamentalFacts(input: unknown): FundamentalFacts {
  if (!input || typeof input !== "object" || !("facts" in input)) throw new Error("Invalid SEC Company Facts response.");
  const json = input as { facts?: Record<string, Record<string, { units?: Record<string, unknown[]> }>> };
  const result: FundamentalFacts = Object.fromEntries(Object.values(FUNDAMENTAL_TAGS).flat().map(tag => [tag, []]));
  for (const taxonomy of ["us-gaap", "ifrs-full"] as const) for (const tag of Object.keys(result)) {
    for (const [currency, values] of Object.entries(json.facts?.[taxonomy]?.[tag]?.units ?? {})) {
      if (!/^[A-Z]{3}$/.test(currency) || !Array.isArray(values)) continue;
      for (const value of values) {
        if (!value || typeof value !== "object") continue;
        const f = value as SecFact;
        if (!validSecFact(f)) continue;
        result[tag].push({ val: f.val, start: f.start, end: f.end, filed: f.filed, accn: f.accn, form: f.form, currency, taxonomy,
          ...(Number.isInteger(f.fy) ? { fy: f.fy } : {}), ...(typeof f.fp === "string" ? { fp: f.fp } : {}),
          ...(Object.values(FUNDAMENTAL_TAGS.netIncome).some(t => t === tag) ? { incomeBasis: tag === "ProfitLoss" ? "consolidated" as const : "owners" as const } : {}) });
      }
    }
  }
  return result;
}
export function mergeFundamentalFacts(...inputs: FundamentalFacts[]): FundamentalFacts {
  const result: FundamentalFacts = {};
  for (const input of inputs) for (const [tag, facts] of Object.entries(input)) (result[tag] ??= []).push(...facts);
  return result;
}
export function eligibleFundamentalFacts(facts: FundamentalFacts, cutoff: string | null) {
  return Object.values(facts).flat().filter(f => !cutoff || f.filed < cutoff && f.end < cutoff);
}
/** Primary statements win; comparative coverage distinguishes convenience translations. */
export function fundamentalCurrency(facts: FundamentalFacts, cutoff: string | null): string | null {
  const eligible = eligibleFundamentalFacts(facts, cutoff).filter(f => f.reportingCurrency !== false);
  const currencies = [...new Set(eligible.map(f => f.currency ?? "USD"))];
  if (!currencies.length) return null;
  if (currencies.length === 1) return currencies[0];
  const latest = eligible.map(f => f.filed).sort().at(-1);
  const scored = currencies.map(currency => {
    const rows = eligible.filter(f => (f.currency ?? "USD") === currency);
    return { currency, primary: rows.filter(f => f.reportingCurrency).map(f => f.filed).sort().at(-1) ?? "", periods: new Set(rows.filter(f => f.filed === latest).map(f => `${f.start}:${f.end}`)).size };
  }).sort((a, b) => b.primary.localeCompare(a.primary) || b.periods - a.periods);
  return scored[0].primary !== scored[1].primary || scored[0].periods > scored[1].periods ? scored[0].currency : null;
}
function source(f: SecFact, tag: string): FundamentalSource {
  return f.source ?? { filed: f.filed, accession: f.accn, form: f.form, tag, ...(f.taxonomy ? { taxonomy: f.taxonomy, kind: "companyfacts" as const } : {}) };
}
function compatible(a: FundamentalMetric, b: FundamentalMetric) {
  return (a.currency ?? "USD") === (b.currency ?? "USD") && a.accountingStandard === b.accountingStandard && a.incomeBasis === b.incomeBasis;
}
export function parseFundamentalQuarters(facts: FundamentalFacts, cutoff: string | null, currency = fundamentalCurrency(facts, cutoff), limit = 8): FundamentalQuarter[] {
  if (!currency) return [];
  const eligible = Object.fromEntries(Object.entries(facts).map(([tag, values]) => [tag, values.filter(f => (!cutoff || f.filed < cutoff && f.end < cutoff) && (f.currency ?? "USD") === currency)]));
  const all = Object.values(eligible).flat(), reportEnds = new Map<string, string>();
  for (const f of all) { const k = `${f.accn}:${f.filed}`, end = reportEnds.get(k); if (!end || f.end > end) reportEnds.set(k, f.end); }
  const fiscalYear = (f: SecFact) => {
    const reportEnd = reportEnds.get(`${f.accn}:${f.filed}`)!;
    if (f.fy == null || Math.abs(f.fy - Number(reportEnd.slice(0, 4))) > 1) return Number(f.end.slice(0, 4));
    return f.fy - Math.round((Date.parse(reportEnd) - Date.parse(f.end)) / (365.2425 * day));
  };
  const annuals = [...new Set(all.filter(annual).map(f => f.end))].sort().map(end => ({ end, year: fiscalYear(all.filter(f => f.end === end && annual(f)).sort(newer).at(-1)!) }));
  function period(end: string): { year: number; q: number } | null {
    const following = annuals.find(a => a.end >= end && Date.parse(a.end) - Date.parse(end) < 330 * day);
    if (following) { const distance = Math.round((Date.parse(following.end) - Date.parse(end)) / (91.3125 * day)); if (distance >= 0 && distance <= 3) return { year: following.year, q: 4 - distance }; }
    const prior = annuals.filter(a => a.end < end).at(-1);
    if (prior) { const distance = Math.round((Date.parse(end) - Date.parse(prior.end)) / (91.3125 * day)); if (distance >= 1 && distance <= 4) return { year: prior.year + 1, q: distance }; }
    const original = all.filter(f => f.end === end && /^Q[1-4]$/.test(f.fp ?? "") && f.fy).sort(newer)[0];
    return original ? { year: fiscalYear(original), q: Number(original.fp!.slice(1)) } : null;
  }
  type Point = { metric: FundamentalMetric; start: string; end: string; year: number; q: number; fact: SecFact; rank: number };
  const key = (year: number, q: number) => `${year}-Q${q}`;
  function metric(tags: readonly string[]): Map<string, Point> {
    const result = new Map<string, Point>();
    type Input = { fact: SecFact; metric: FundamentalMetric; rank: number };
    const inputs: Input[] = tags.flatMap((tag, rank) => (eligible[tag] ?? []).map(f => ({ fact: f, rank, metric: {
      value: f.val, derived: false, sources: [source(f, tag)], ...(f.currency ? { currency: f.currency } : {}), ...(f.taxonomy ? { accountingStandard: f.taxonomy } : {}), ...(f.incomeBasis ? { incomeBasis: f.incomeBasis } : {}),
    } })));
    const versions = new Map<string, Input>();
    for (const input of inputs) {
      const { fact: f, metric: m } = input, k = `${f.start}:${f.end}:${m.accountingStandard}:${m.incomeBasis}`;
      const old = versions.get(k);
      if (!old || newer(f, old.fact) > 0 || newer(f, old.fact) === 0 && input.rank < old.rank) versions.set(k, input);
    }
    const selected = [...versions.values()];
    function add(input: Input) {
      const f = input.fact, p = period(f.end); if (!p || !quarter(f)) return;
      const k = key(p.year, p.q), old = result.get(k);
      const owners = Number(input.metric.incomeBasis === "owners") - Number(old?.metric.incomeBasis === "owners");
      if (!old || owners > 0 || owners === 0 && (Number(!input.metric.derived) > Number(!old.metric.derived) || input.metric.derived === old.metric.derived && (newer(f, old.fact) > 0 || newer(f, old.fact) === 0 && input.rank < old.rank))) result.set(k, { ...p, start: f.start, end: f.end, fact: f, metric: input.metric, rank: input.rank });
    }
    selected.forEach(add);
    function subtract(whole: Input, parts: Input[], start: string, end: string) {
      if (!parts.every(part => compatible(whole.metric, part.metric))) return;
      const sources = [whole, ...parts].flatMap(i => i.metric.sources);
      if (sources.length > 4) return;
      const newest = [whole, ...parts].sort((a, b) => newer(a.fact, b.fact)).at(-1)!;
      add({ rank: whole.rank, fact: { ...newest.fact, start, end, val: whole.metric.value - parts.reduce((s, p) => s + p.metric.value, 0) }, metric: { ...whole.metric, value: whole.metric.value - parts.reduce((s, p) => s + p.metric.value, 0), sources, derived: true } });
    }
    for (const whole of selected) for (const part of selected) {
      if (whole === part || days(whole.fact.start, whole.fact.end) <= days(part.fact.start, part.fact.end)) continue;
      if (whole.fact.start === part.fact.start) subtract(whole, [part], new Date(Date.parse(part.fact.end) + day).toISOString().slice(0, 10), whole.fact.end);
      if (whole.fact.end === part.fact.end) subtract(whole, [part], whole.fact.start, new Date(Date.parse(part.fact.start) - day).toISOString().slice(0, 10));
    }
    for (const whole of selected.filter(i => annual(i.fact))) {
      const p = period(whole.fact.end); if (!p) continue;
      const preceding = [1, 2, 3].map(q => result.get(key(p.year, q)));
      if (preceding.some(q => !q)) continue;
      const parts = preceding as Point[];
      if (Math.abs(Date.parse(parts[0].start) - Date.parse(whole.fact.start)) > 7 * day || parts.some((q, i) => i > 0 && Math.abs(Date.parse(q.start) - Date.parse(parts[i - 1].end) - day) > 7 * day)) continue;
      subtract(whole, parts.map(p => ({ fact: p.fact, metric: p.metric, rank: p.rank })), new Date(Date.parse(parts[2].end) + day).toISOString().slice(0, 10), whole.fact.end);
    }
    return result;
  }
  const revenue = metric(FUNDAMENTAL_TAGS.revenue), income = metric(FUNDAMENTAL_TAGS.netIncome);
  const rows: FundamentalQuarter[] = [...new Set([...revenue.keys(), ...income.keys()])].map(k => {
    const r = revenue.get(k), n = income.get(k), p = (r ?? n)!;
    return { fiscalYear: p.year, fiscalQuarter: p.q, periodEnd: p.end, revenue: r?.metric ?? null, netIncome: n?.end === p.end ? n.metric : null, revenueYoY: null, revenueQoQ: null, netIncomeYoY: null, netIncomeQoQ: null };
  }).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const byKey = new Map(rows.map(q => [key(q.fiscalYear, q.fiscalQuarter), q]));
  const growth = (now?: FundamentalMetric | null, before?: FundamentalMetric | null) => !now || !before || before.value === 0 || !compatible(now, before) ? null : Number(((now.value - before.value) / Math.abs(before.value) * 100).toFixed(4));
  for (const row of rows) {
    const prev = byKey.get(key(row.fiscalQuarter === 1 ? row.fiscalYear - 1 : row.fiscalYear, row.fiscalQuarter === 1 ? 4 : row.fiscalQuarter - 1)), year = byKey.get(key(row.fiscalYear - 1, row.fiscalQuarter));
    row.revenueYoY = growth(row.revenue, year?.revenue); row.revenueQoQ = growth(row.revenue, prev?.revenue);
    row.netIncomeYoY = growth(row.netIncome, year?.netIncome); row.netIncomeQoQ = growth(row.netIncome, prev?.netIncome);
  }
  return rows.slice(-limit);
}
