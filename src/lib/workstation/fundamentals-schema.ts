import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const source = z.object({ filed: date, accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), form: z.string().max(10), tag: z.string().max(100), taxonomy: z.string().max(100).optional(), kind: z.enum(["companyfacts", "xbrl", "statement"]).optional(), document: z.string().regex(/^[a-zA-Z0-9_.-]+\.(?:html?|xml)$/i).max(250).optional(), label: z.string().max(200).optional() }).strict();
const metric = z.object({ value: z.number().finite(), sources: z.array(source).min(1).max(4), derived: z.boolean(), currency: currency.optional(), accountingStandard: z.enum(["us-gaap", "ifrs-full"]).optional(), incomeBasis: z.enum(["owners", "consolidated"]).optional() }).strict().nullable();
const growth = z.number().finite().nullable();
export const fundamentalsCaptureSchema = z.object({
  symbol: z.string().max(40), mode: z.enum(["before-entry", "latest"]), cutoff: date.nullable(),
  issuer: z.object({ cik: z.string().regex(/^\d{10}$/), name: z.string().max(500) }).strict().nullable(),
  fetchedAt: z.string().datetime().nullable(), capturedAt: z.string().datetime(), stale: z.boolean(),
  currency: currency.optional(), coverage: z.enum(["complete", "partial", "no-quarterly-data", "unsupported-format"]).optional(),
  seriesVisibility: z.object({ revenue: z.boolean(), netIncome: z.boolean(), revenueYoY: z.boolean(), revenueQoQ: z.boolean(), netIncomeYoY: z.boolean(), netIncomeQoQ: z.boolean() }).strict().optional(),
  quarters: z.array(z.object({ fiscalYear: z.number().int().min(1900).max(2200), fiscalQuarter: z.number().int().min(1).max(4), periodEnd: date, revenue: metric, netIncome: metric, revenueYoY: growth, revenueQoQ: growth, netIncomeYoY: growth, netIncomeQoQ: growth }).strict()).min(1).max(8),
}).strict().superRefine((value, ctx) => {
  if (value.quarters.some(q => [q.revenue, q.netIncome].some(m => m?.currency && m.currency !== (value.currency ?? "USD")))) ctx.addIssue({ code: "custom", message: "Captured figures must use the chart's reporting currency." });
  if (value.mode === "before-entry" && (!value.cutoff || value.quarters.some(q => q.periodEnd >= value.cutoff! || [q.revenue, q.netIncome].some(m => m?.sources.some(s => s.filed >= value.cutoff!))))) ctx.addIssue({ code: "custom", message: "Historical fundamentals must precede the entry date." });
});
