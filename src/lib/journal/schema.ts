import { z } from "zod";

export const JOURNAL_TIMEFRAMES = ["1W", "1D", "1H", "15min", "10min", "5min"] as const;
export type JournalTimeframe = (typeof JOURNAL_TIMEFRAMES)[number];

export const JOURNAL_TAG_CATEGORIES = ["SETUP", "LESSON", "MISTAKE", "CONTEXT", "CUSTOM"] as const;
export type JournalTagCategoryValue = (typeof JOURNAL_TAG_CATEGORIES)[number];

export const JOURNAL_MARKER_TYPES = [
  "IDEAL_ENTRY",
  "STOP",
  "TARGET",
  "IDEAL_EXIT",
  "MISSED_TRIGGER",
  "DECISION_POINT",
] as const;

const optionalText = z.string().max(20000).optional().default("");
const optionalShortText = z.string().max(240).optional();

export function normalizeJournalTagName(value: string) {
  return value
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeJournalTags(values: string[] | undefined) {
  return Array.from(
    new Set((values ?? []).map(normalizeJournalTagName).filter((value) => value.length > 0)),
  );
}

const tagArraySchema = z.array(z.string().max(80)).optional().default([]);

export const journalTagsPayloadSchema = z.object({
  SETUP: tagArraySchema,
  LESSON: tagArraySchema,
  MISTAKE: tagArraySchema,
  CONTEXT: tagArraySchema,
  CUSTOM: tagArraySchema,
}).partial();

export const journalEntryPayloadSchema = z.object({
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  ideaDate: z.string().min(1),
  direction: z.enum(["LONG", "SHORT"]).optional().default("LONG"),
  status: z.enum(["DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]).optional().default("DRAFT"),
  setup: optionalShortText,
  timeframe: z.enum(JOURNAL_TIMEFRAMES).optional().default("1D"),
  macroSentiment: z.enum(["BULLISH", "NEUTRAL", "BEARISH"]).optional().default("NEUTRAL"),
  thesis: optionalText,
  trigger: optionalText,
  riskPlan: optionalText,
  idealExecutionPlan: optionalText,
  missedReason: optionalText,
  marketContext: optionalText,
  peerContext: optionalText,
  rating: z.number().int().min(1).max(5).nullable().optional(),
  lessonLearned: optionalText,
  tags: journalTagsPayloadSchema.optional().default({}),
});

export const journalEntryPatchSchema = journalEntryPayloadSchema.partial().extend({
  tags: journalTagsPayloadSchema.optional(),
});

export const chartMarkerPayloadSchema = z.object({
  markerType: z.enum(JOURNAL_MARKER_TYPES),
  time: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  label: z.string().max(180).nullable().optional(),
  metadataJson: z.string().max(10000).nullable().optional(),
});

export const journalChartPayloadSchema = z.object({
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  timeframe: z.enum(JOURNAL_TIMEFRAMES).optional().default("1D"),
  rangeStart: z.string().nullable().optional(),
  rangeEnd: z.string().nullable().optional(),
  tradingViewLayoutJson: z.string().max(200000).nullable().optional(),
  screenshotDataUrl: z.string().max(12_000_000).nullable().optional(),
  caption: z.string().max(4000).optional().default(""),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
  markers: z.array(chartMarkerPayloadSchema).optional().default([]),
});

export const journalChartPatchSchema = journalChartPayloadSchema.partial().extend({
  markers: z.array(chartMarkerPayloadSchema).optional(),
});

export const journalSnapshotPayloadSchema = z.object({
  screenshotDataUrl: z.string().max(12_000_000),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
  tradingViewLayoutJson: z.string().max(200000).nullable().optional(),
});
