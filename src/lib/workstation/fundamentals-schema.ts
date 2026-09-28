import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const source = z.object({ filed: date, accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), form: z.string().max(10), tag: z.string().max(100) }).strict();
const metric = z.object({ value: z.number().finite(), sources: z.array(source).min(1).max(4), derived: z.boolean() }).strict().nullable();
const growth = z.number().finite().nullable();
export const fundamentalsCaptureSchema = z.object({
  symbol: z.string().max(40), mode: z.enum(["before-entry", "latest"]), cutoff: date.nullable(),
  issuer: z.object({ cik: z.string().regex(/^\d{10}$/), name: z.string().max(500) }).strict().nullable(),
  fetchedAt: z.string().datetime().nullable(), capturedAt: z.string().datetime(), stale: z.boolean(),
  quarters: z.array(z.object({ fiscalYear: z.number().int().min(1900).max(2200), fiscalQuarter: z.number().int().min(1).max(4), periodEnd: date, revenue: metric, netIncome: metric, revenueYoY: growth, revenueQoQ: growth, netIncomeYoY: growth, netIncomeQoQ: growth }).strict()).min(1).max(8),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "before-entry" && (!value.cutoff || value.quarters.some(q => q.periodEnd >= value.cutoff! || [q.revenue, q.netIncome].some(m => m?.sources.some(s => s.filed >= value.cutoff!))))) ctx.addIssue({ code: "custom", message: "Historical fundamentals must precede the entry date." });
});
