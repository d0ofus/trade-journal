import { z } from "zod";
import { beforeEntryBoundary, beforeEntryCandles, firstExecution } from "./before-entry";
import { completedCandles } from "./math";
import { executionTimeResolved } from "./execution-time-provenance";
import type { HistoryRange } from "./history";
import { intervals, seconds, type Candle, type Interval, type Trade } from "./types";

export const MAX_PEER_BATCH = 8;
export const peerMemberSchema = z.object({ ticker: z.string().min(1).max(40), name: z.string().nullable().optional(), exchange: z.string().nullable().optional() });
export const peerGroupSchema = z.object({ id: z.string().min(1).max(200), name: z.string().max(300), priority: z.number().default(0), isActive: z.boolean(), members: z.array(peerMemberSchema).max(20000) });
export type PeerMember = z.infer<typeof peerMemberSchema>;
export type PeerGroup = z.infer<typeof peerGroupSchema>;
export const peerContextSchema = z.object({ peerGroupsUrl: z.string().optional(), detail: z.object({ groups: z.array(peerGroupSchema) }).nullable(), errors: z.array(z.string()).optional() });
export function selectPeerGroup(groups: PeerGroup[], savedId?: string) {
  const active = groups.filter(g => g.isActive).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { groups: active, selected: active.find(g => g.id === savedId) ?? active[0], changed: !!savedId && !active.some(g => g.id === savedId) };
}
export function peerMembers(group: PeerGroup | undefined, primary: string, search = ""): PeerMember[] {
  const unique = new Map<string, PeerMember>();
  for (const member of group?.members ?? []) {
    const ticker = member.ticker.trim().toUpperCase();
    if (ticker !== primary.toUpperCase() && `${ticker} ${member.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) unique.set(ticker, { ...member, ticker });
  }
  return [...unique.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}
/** Never silently substitute a US security for a same-ticker foreign listing. */
export function peerSymbolIssue(member: PeerMember): string | null {
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(member.ticker)) return "This symbol format is not supported by Alpaca US equities.";
  const exchange = member.exchange?.trim().toUpperCase();
  if (exchange && !["NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM", "NYSE", "NYSEARCA", "NYSE ARCA", "NYSE AMERICAN", "NYSEAMERICAN", "AMEX", "ARCA", "BATS", "CBOE", "IEX", "OTC", "OTCQX", "OTCQB", "PINK", "US", "XNYS", "XNAS", "XASE", "ARCX", "BZX"].includes(exchange)) return `${member.exchange} is not a supported US exchange. No substitute ticker was loaded.`;
  return null;
}
export function peerEntryTime(trade: Trade): number | null {
  const first = firstExecution(trade);
  return first && executionTimeResolved(first) && !["pending", "stale", "unresolved"].includes(first.provenance?.interpretationStatus ?? "") ? first.time : null;
}
export type PeerView = { replayAt?: number; range: HistoryRange; interval: Interval; session: "regular" | "extended"; adjustment: "raw" | "split"; beforeEntry: boolean };
export function peerChartData(source: Candle[], trade: Trade, view: PeerView) {
  const session = { timezone: "America/New_York", calendar: "exchange" as const, marketHours: view.session, ...(view.interval === "1h" && view.session === "regular" ? { aggregation: "session-open-5m-v1" } : {}) };
  const completed = completedCandles(source, view.interval, view.replayAt ?? null, session);
  const candles = view.beforeEntry ? beforeEntryBoundary(trade, view.interval, session) === null ? [] : beforeEntryCandles(completed, trade, view.interval, session) : completed;
  return { candles, session };
}
export const peerCandleQuerySchema = z.object({
  symbols: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.\-]{0,19}$/)).min(1).max(MAX_PEER_BATCH).transform(v => [...new Set(v)]),
  timeframe: z.enum(intervals), session: z.enum(["regular", "extended"]), adjustment: z.enum(["raw", "split"]),
  from: z.number().int().positive(), to: z.number().int().positive(),
}).refine(v => v.to > v.from && v.to - v.from <= 20 * 366 * 86400 && v.to < 8640000000000, "Invalid peer date range");
export type PeerCandleQuery = z.infer<typeof peerCandleQuerySchema>;
export type PeerSeries = { symbol: string; candles: Candle[]; status: "ready" | "empty" | "error"; error?: string; source: string; identity: string; range: HistoryRange; adjustment: "raw" | "split"; feed: string; retryAfter?: number };
export type PeerCandleResponse = { series: PeerSeries[] };
export type PeerCapture = { replayAt?: number; source: "peer-comparison"; symbols: string[]; groupId: string; groupName: string; interval: Interval; session: "regular" | "extended"; adjustment: "raw" | "split"; ranges: Record<string, HistoryRange>; capturedAt: string; beforeEntry: boolean; entryTime: number | null };
export function peerReplayRange(range: HistoryRange, replayAt?: number): HistoryRange {
  if (replayAt === undefined || range.to <= replayAt) return range;
  const width = Math.max(1, range.to - range.from);
  return { from: Math.max(1, replayAt - width), to: replayAt };
}
export function peerWarmupRange(view: PeerView, periods: number): HistoryRange {
  const bars = Math.max(1, Math.min(500, periods));
  const padding = view.interval === "1d" || view.interval === "1wk" ? Math.ceil(bars * seconds[view.interval] * 1.7) : Math.ceil((bars * seconds[view.interval] / 23400 + 5) * 86400);
  const range = peerReplayRange(view.range, view.replayAt);
  return { from: Math.max(1, Math.floor(range.from - padding)), to: Math.ceil(Math.min(range.to + seconds[view.interval], view.replayAt ?? Infinity)) };
}
export function peerVirtualWindow(count: number, columns: number, scrollTop: number, height: number, rowHeight = 340) {
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight));
  const endRow = Math.min(Math.ceil(count / columns), Math.ceil((scrollTop + height) / rowHeight) + 1);
  return { start: startRow * columns, end: Math.min(count, endRow * columns), top: startRow * rowHeight, height: Math.ceil(count / columns) * rowHeight };
}
