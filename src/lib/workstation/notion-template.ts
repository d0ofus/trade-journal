import { executionTimeResolved } from "./execution-time-provenance";
import { z } from "zod";
import { firstExecution } from "./before-entry";
import { richHtml, richPlain } from "./rich-text";
import type { Review, Trade } from "./types";
import { dynamicSectionKeySchema, templateLayoutSchema, type TemplateLayout } from "./template-layout-schema";

type Kind = "date" | "checkbox" | "relation" | "multi" | "select" | "text" | "number" | "takeaways" | "formula";
type Property = { key: string; label: string; kind: Kind; options?: string[]; single?: boolean };
export const notionProperties = [
  { key: "entryDate", label: "Entry Date", kind: "date" },
  { key: "exitMarked", label: "Exit?", kind: "checkbox" },
  { key: "typeOfReview", label: "Type of Review", kind: "relation", options: ["Sector Thematic"] },
  { key: "typeOfTrade", label: "Type of Trade", kind: "relation", single: true, options: ["Gapper"] },
  { key: "chartPattern", label: "Chart Pattern", kind: "relation", options: ["Gap and Go"] },
  { key: "confluences", label: "Confluences", kind: "relation", options: ["Sector Theme", "High Average Trading Volume", "Analyst Upgrades", "Strong Gap Up", "Strong RS Score", "Defined CP"] },
  { key: "characteristics", label: "Characteristics", kind: "relation", options: ["Sector Leader", "High Volume on the Day", "Breakout Close at Highs"] },
  { key: "takeaways", label: "Takeaways", kind: "takeaways" },
  { key: "stopLossPercent", label: "S/L %", kind: "formula" },
  { key: "idealExecutionOptions", label: "Ideal Execution", kind: "multi", options: ["Stop Buy Oda CP", "Match on Open"] },
  { key: "idealStopLossOptions", label: "Ideal Stop Loss", kind: "multi", options: ["Below Volume Profile", "Opening Range Low", "Current Day Low", "Prior Day Low"] },
  { key: "xFrom50Sma", label: "X from 50 SMA", kind: "number" },
  { key: "indexSupportive", label: "Index Supportive?", kind: "checkbox" },
  { key: "highAvat", label: "High AVAT?", kind: "checkbox" },
  { key: "newsImpact", label: "News Impact", kind: "relation", single: true, options: ["High"] },
  { key: "bestPeerTickers", label: "Best Peer Tickers", kind: "text" },
  { key: "breadthSupportive", label: "Breadth Supportive?", kind: "checkbox" },
  { key: "indexContext", label: "Index Context", kind: "multi", options: ["IWM supportive", "Sector ETF supportive", "SPY supportive", "QQQ supportive"] },
  { key: "leaderLaggard", label: "Leader / Laggard", kind: "select", options: ["Leader"] },
  { key: "marketRegime", label: "Market Regime", kind: "select", options: ["Rotation"] },
  { key: "peerConfirmation", label: "Peer Confirmation", kind: "select", options: ["Strong"] },
  { key: "peersMovingTogether", label: "Peers Moving Together?", kind: "checkbox" },
  { key: "riskAppetite", label: "Risk Appetite", kind: "select", options: ["High"] },
  { key: "sectorProxy", label: "Sector ETF / Proxy", kind: "text" },
  { key: "sectorParticipation", label: "Sector Participation", kind: "select", options: ["Broad Sector Move"] },
  { key: "setupQuality", label: "Setup Quality", kind: "select", options: ["B"] },
  { key: "themeBreadthNotes", label: "Theme Breadth Notes", kind: "text" },
  { key: "themeStrength", label: "Theme Strength", kind: "select", options: ["Strong"] },
  { key: "tradability", label: "Tradability", kind: "select", options: ["Tradable but difficult"] },
] as const satisfies readonly Property[];
export const chartSections = [
  ["entry", "Entry Screen"], ["postBreak", "Post-Break Screen"], ["exit", "Exit Screen"], ["peers", "Peers"], ["index", "Index"], ["other", "Other Key Charts"],
] as const;
export const analysisSections = [["technicalPositive", "Technicals · +ve"], ["technicalNegative", "Technicals · −ve"], ["idealExecution", "Ideal Execution"], ["fundamentals", "Fundamentals"], ["noteworthyPositive", "Noteworthy · +ve"], ["noteworthyNegative", "Noteworthy · −ve"]] as const;
export type PropertyKey = typeof notionProperties[number]["key"] | "plannedEntry" | "plannedStop";
export type NotionValue = string | number | boolean | string[] | null;
export type ChartSectionKey = typeof chartSections[number][0];
export const additionalReviewSections = [["properties", "Trade properties"], ...analysisSections, ["takeaways", "Takeaways"], ["previousReview", "Previous review fields"]] as const;
export const reviewSections = [...chartSections, ...additionalReviewSections] as const;
export type ReviewSectionKey = typeof reviewSections[number][0] | `notion:${string}`;
export type AdditionalReviewSectionKey = typeof additionalReviewSections[number][0];
export type NotionReview = { version: 1; properties: Partial<Record<PropertyKey, NotionValue>>; sections: Partial<Record<ChartSectionKey, { html: string; evidenceIds: string[] }>>; analysis: Partial<Record<typeof analysisSections[number][0], string>>; sectionEvidence?: Partial<Record<AdditionalReviewSectionKey, string[]>>; peerGroupId?: string; dynamicSections?: Record<string, { html: string; evidenceIds: string[] }>; layout?: TemplateLayout };
const html = z.string().max(20000).transform(richHtml);
const propertyShape: Record<string, z.ZodType> = {};
for (const p of notionProperties) {
  if (["date", "formula", "takeaways"].includes(p.kind)) continue;
  if (p.key === "themeBreadthNotes") { propertyShape[p.key] = html.optional(); continue; }
  propertyShape[p.key] = (p.kind === "checkbox" ? z.boolean() : p.kind === "number" ? z.number().finite().nullable() : p.kind === "relation" || p.kind === "multi" ? z.array(z.string().trim().min(1).max(160)).max("single" in p ? 1 : 80) : z.string().max(20000)).optional();
}
propertyShape.plannedEntry = z.number().finite().positive().nullable().optional();
propertyShape.plannedStop = z.number().finite().positive().nullable().optional();
export const notionReviewSchema = z.object({ version: z.literal(1), properties: z.object(propertyShape).strict(), sections: z.object(Object.fromEntries(chartSections.map(([key]) => [key, z.object({ html, evidenceIds: z.array(z.string().max(200)).max(30) }).strict().optional()]))).strict(), analysis: z.object(Object.fromEntries(analysisSections.map(([key]) => [key, html.optional()]))).strict(), sectionEvidence: z.object(Object.fromEntries(additionalReviewSections.map(([key]) => [key, z.array(z.string().min(1).max(200)).max(30).optional()]))).strict().optional(), peerGroupId: z.string().min(1).max(200).optional(), layout: templateLayoutSchema.optional(), dynamicSections: z.record(dynamicSectionKeySchema, z.object({ html, evidenceIds: z.array(z.string().min(1).max(200)).max(30) }).strict()).refine(value => Object.keys(value).length <= 1200).optional() }).strict().transform(v => v as NotionReview);
export const emptyNotionReview = (): NotionReview => ({ version: 1, properties: {}, sections: {}, analysis: {} });
export function stopLossPercent(n?: NotionReview): number | null {
  const entry = n?.properties.plannedEntry, stop = n?.properties.plannedStop;
  return typeof entry === "number" && entry > 0 && typeof stop === "number" && stop > 0 ? Math.abs(entry - stop) / entry * 100 : null;
}
export function propertyText(key: PropertyKey, trade: Trade, review: Review) {
  if (key === "entryDate") { const first = firstExecution(trade); const time = first && executionTimeResolved(first) && !["pending", "stale", "unresolved"].includes(first.provenance?.interpretationStatus ?? "") ? first.time : null; return time ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }).format(new Date(time * 1000)) : "Unavailable"; }
  if (key === "takeaways") return richPlain(review.takeaway);
  if (key === "stopLossPercent") { const value = stopLossPercent(review.notion); return value === null ? "" : `${value.toFixed(2)}%`; }
  const value = review.notion?.properties[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return key === "xFrom50Sma" && typeof value === "number" ? `${value}×` : richPlain(String(value));
}
