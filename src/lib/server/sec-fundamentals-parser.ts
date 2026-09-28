import type { FundamentalMetric, FundamentalQuarter } from "@/lib/workstation/fundamentals";

// Adapted from market-overview's fundamentals-service: standard USD US-GAAP
// duration facts, tag precedence, FY minus Q1–Q3, and absolute-denominator growth.
export const FUNDAMENTAL_TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
} as const;
export type SecFact = { val: number; start: string; end: string; filed: string; accn: string; form: string; fy?: number; fp?: string };
export type FundamentalFacts = Record<string, SecFact[]>;
const day = 86_400_000;
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const duration = (f: SecFact) => (Date.parse(f.end) - Date.parse(f.start)) / day + 1;
const quarter = (f: SecFact) => duration(f) >= 75 && duration(f) <= 110;
const annual = (f: SecFact) => duration(f) >= 330 && duration(f) <= 400 && /^10-K(?:\/A)?$/.test(f.form) && f.fp === "FY";
const newer = (a: SecFact, b: SecFact) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn);

/** Store all supported filing versions, never only the final value of a quarter. */
export function extractFundamentalFacts(input: unknown): FundamentalFacts {
  if (!input || typeof input !== "object" || !("facts" in input)) throw new Error("Invalid SEC Company Facts response.");
  const json = input as { facts?: { "us-gaap"?: Record<string, { units?: { USD?: unknown[] } }> } };
  const result: FundamentalFacts = {};
  for (const tag of Object.values(FUNDAMENTAL_TAGS).flat()) {
    result[tag] = (json.facts?.["us-gaap"]?.[tag]?.units?.USD ?? []).flatMap(value => {
      if (!value || typeof value !== "object") return [];
      const f = value as SecFact;
      if (!Number.isFinite(f.val) || !validDate(f.start) || !validDate(f.end) || !validDate(f.filed) || f.start > f.end || f.end > f.filed || typeof f.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || !/^10-[QK](?:\/A)?$/.test(f.form)) return [];
      return [{ val: f.val, start: f.start, end: f.end, filed: f.filed, accn: f.accn, form: f.form, ...(Number.isInteger(f.fy) ? { fy: f.fy } : {}), ...(typeof f.fp === "string" ? { fp: f.fp } : {}) }];
    });
  }
  return result;
}

export function parseFundamentalQuarters(facts: FundamentalFacts, cutoff: string | null): FundamentalQuarter[] {
  // Filter every contributing fact before calendar construction or selection.
  const eligible = Object.fromEntries(Object.entries(facts).map(([tag, values]) => [tag, values.filter(f => !cutoff || f.filed < cutoff && f.end < cutoff)]));
  const all = Object.values(eligible).flat();
  const annuals = [...new Set(all.filter(annual).map(f => f.end))].sort().map(end => {
    const original = all.filter(f => f.end === end && annual(f)).sort(newer)[0];
    return { end, year: original.fy ?? Number(end.slice(0, 4)) };
  });
  function period(end: string): { year: number; q: number } | null {
    // Anchor to an actually disclosed year end; elapsed quarters retain gaps.
    const following = annuals.find(a => a.end >= end && Date.parse(a.end) - Date.parse(end) < 330 * day);
    if (following) {
      const distance = Math.round((Date.parse(following.end) - Date.parse(end)) / (91.3125 * day));
      if (distance >= 0 && distance <= 3) return { year: following.year, q: 4 - distance };
    }
    const prior = annuals.filter(a => a.end < end).at(-1);
    if (prior) {
      const distance = Math.round((Date.parse(end) - Date.parse(prior.end)) / (91.3125 * day));
      if (distance >= 1 && distance <= 4) return { year: prior.year + 1, q: distance };
    }
    // Newly reporting issuers can have quarters before their first annual filing.
    const original = all.filter(f => f.end === end && quarter(f) && /^Q[1-3]$/.test(f.fp ?? "") && f.fy).sort(newer)[0];
    return original ? { year: original.fy!, q: Number(original.fp!.slice(1)) } : null;
  }
  const calendar = new Map([...new Set(all.filter(f => quarter(f) || annual(f)).map(f => f.end))].flatMap(end => { const p = period(end); return p ? [[end, p] as const] : []; }));
  type Point = { metric: FundamentalMetric; end: string; year: number; q: number };
  const key = (year: number, q: number) => `${year}-Q${q}`;
  const point = (f: SecFact, tag: string): FundamentalMetric => ({ value: f.val, derived: false, sources: [{ filed: f.filed, accession: f.accn, form: f.form, tag }] });
  function metric(tags: readonly string[]): Map<string, Point> {
    const result = new Map<string, Point>();
    for (const tag of tags) {
      const direct = new Map<string, SecFact>(), yearly = new Map<string, SecFact>();
      for (const f of eligible[tag] ?? []) {
        const p = calendar.get(f.end); if (!p) continue;
        const target = annual(f) ? yearly : quarter(f) && (p.q === 4 ? /^10-K/.test(f.form) : /^10-Q/.test(f.form)) ? direct : null;
        if (!target) continue;
        const k = key(p.year, p.q), old = target.get(k);
        if (!old || newer(f, old) > 0) target.set(k, f);
      }
      for (const [k, f] of direct) {
        const p = calendar.get(f.end)!;
        if (!result.has(k)) result.set(k, { metric: point(f, tag), end: f.end, ...p });
      }
      for (const [k, f] of yearly) {
        if (result.has(k)) continue;
        const p = calendar.get(f.end)!;
        const preceding = [1, 2, 3].map(q => direct.get(key(p.year, q)));
        if (preceding.some(f => !f)) continue;
        const inputs = preceding as SecFact[];
        // A transition year or overlapping periods cannot be subtracted safely.
        if (Math.abs(Date.parse(inputs[0].start) - Date.parse(f.start)) > 7 * day || inputs.some((q, i) => i > 0 && Math.abs(Date.parse(q.start) - Date.parse(inputs[i - 1].end) - day) > 7 * day)) continue;
        result.set(k, { end: f.end, ...p, metric: { value: f.val - inputs.reduce((sum, q) => sum + q.val, 0), derived: true, sources: [f, ...inputs].flatMap(fact => point(fact, tag).sources) } });
      }
    }
    return result;
  }
  const revenue = metric(FUNDAMENTAL_TAGS.revenue), netIncome = metric(FUNDAMENTAL_TAGS.netIncome);
  const rows = [...new Set([...revenue.keys(), ...netIncome.keys()])].map(k => {
    const r = revenue.get(k), n = netIncome.get(k), p = (r ?? n)!;
    // Do not pair conflicting reporting periods solely because their FY/Q matches.
    return { fiscalYear: p.year, fiscalQuarter: p.q, periodEnd: p.end, revenue: r?.metric ?? null, netIncome: n?.end === p.end ? n.metric : null, revenueYoY: null, revenueQoQ: null, netIncomeYoY: null, netIncomeQoQ: null } as FundamentalQuarter;
  }).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const byKey = new Map(rows.map(q => [key(q.fiscalYear, q.fiscalQuarter), q]));
  const growth = (now?: FundamentalMetric | null, before?: FundamentalMetric | null) => !now || !before || before.value === 0 ? null : Number(((now.value - before.value) / Math.abs(before.value) * 100).toFixed(4));
  for (const row of rows) {
    const prev = byKey.get(key(row.fiscalQuarter === 1 ? row.fiscalYear - 1 : row.fiscalYear, row.fiscalQuarter === 1 ? 4 : row.fiscalQuarter - 1));
    const lastYear = byKey.get(key(row.fiscalYear - 1, row.fiscalQuarter));
    row.revenueYoY = growth(row.revenue, lastYear?.revenue); row.revenueQoQ = growth(row.revenue, prev?.revenue);
    row.netIncomeYoY = growth(row.netIncome, lastYear?.netIncome); row.netIncomeQoQ = growth(row.netIncome, prev?.netIncome);
  }
  return rows.slice(-8);
}
