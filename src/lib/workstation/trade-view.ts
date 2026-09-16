import { z } from "zod";
import { intervals, type WorkspacePreferences } from "./types";
import { restoreChartSizing } from "./chart-sizing";

const range = z.object({ from: z.number().finite().min(1), to: z.number().finite().max(32503680000) }).strict().refine(v => v.to > v.from, "Invalid chart range");
export const tradeViewSchema = z.object({
  version: z.literal(1),
  panels: z.array(z.object({ id: z.string().regex(/^chart-[1-4]$/), interval: z.enum(intervals), session: z.enum(["auto", "regular", "extended"]), range: range.nullable(), benchmark: z.enum(["off", "SPY", "QQQ"]).optional(), lastBenchmark: z.enum(["SPY", "QQQ"]).optional(), beforeEntry: z.boolean().optional() }).strict()).min(1).max(4).refine(p => new Set(p.map(v => v.id)).size === p.length),
  arrangement: z.enum(["left", "top"]),
  sizing: z.unknown().optional().transform(restoreChartSizing),
}).strict();
export type TradeView = z.infer<typeof tradeViewSchema>;
export type SavedTradeView = { revision: number; updatedAt: string | null; view: TradeView | null };
export const emptyTradeView = (): SavedTradeView => ({ revision: 0, updatedAt: null, view: null });
export function viewPreferences(view: TradeView): Partial<WorkspacePreferences> {
  return { panels: view.panels.map(({ id, interval, session, benchmark, lastBenchmark, beforeEntry }) => ({ id, interval, session, benchmark: benchmark ?? "off", lastBenchmark, beforeEntry: beforeEntry ?? false })), chartArrangement: view.arrangement, chartSizing: view.sizing };
}
