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

export const JOURNAL_OUTCOME_STATUSES = [
  "UNREVIEWED",
  "TRIGGERED",
  "NEVER_TRIGGERED",
  "WORKED_WITHOUT_ME",
  "FAILED",
  "STILL_DEVELOPING",
] as const;
export type JournalOutcomeStatusValue = (typeof JOURNAL_OUTCOME_STATUSES)[number];

export const JOURNAL_MARKET_REGIMES = ["UNKNOWN", "RISK_ON", "MIXED", "RISK_OFF"] as const;
export type JournalMarketRegimeValue = (typeof JOURNAL_MARKET_REGIMES)[number];

export const JOURNAL_TREND_STATES = ["UNKNOWN", "BULLISH", "NEUTRAL", "BEARISH"] as const;
export type JournalTrendStateValue = (typeof JOURNAL_TREND_STATES)[number];

export const JOURNAL_CHART_PURPOSES = [
  "THESIS",
  "TRIGGER",
  "MARKET_CONTEXT",
  "PEER_CONTEXT",
  "FOLLOW_THROUGH",
  "REVIEW",
  "CUSTOM",
] as const;
export type JournalChartPurposeValue = (typeof JOURNAL_CHART_PURPOSES)[number];

export const JOURNAL_RULE_CHECK_STATUSES = ["PASS", "FAIL", "NA"] as const;
export const JOURNAL_REVIEW_PERIODS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export const JOURNAL_ACTION_STATUSES = ["OPEN", "DONE", "ARCHIVED"] as const;
export const JOURNAL_SAVED_VIEW_TYPES = ["IDEAS", "VISUAL"] as const;
export const JOURNAL_NOTION_TRADE_STATUSES = ["Closed by T/P", "Closed by S/L", "Closed Manually", "Open"] as const;
export type JournalNotionTradeStatusValue = (typeof JOURNAL_NOTION_TRADE_STATUSES)[number];

export const JOURNAL_NOTION_IDEAL_EXECUTION_OPTIONS = ["Stop Buy Oda CP", "Match on Open"] as const;
export type JournalNotionIdealExecutionValue = (typeof JOURNAL_NOTION_IDEAL_EXECUTION_OPTIONS)[number];

export const JOURNAL_NOTION_IDEAL_STOP_LOSS_OPTIONS = [
  "Below Volume Profile",
  "Opening Range Low",
  "Current Day Low",
  "Prior Day Low",
] as const;
export type JournalNotionIdealStopLossValue = (typeof JOURNAL_NOTION_IDEAL_STOP_LOSS_OPTIONS)[number];

export const JOURNAL_NOTION_RELATION_KEYS = [
  "ACCOUNT",
  "TYPE_OF_REVIEW",
  "TYPE_OF_TRADE",
  "CHART_PATTERN",
  "CONFLUENCE",
  "CHARACTERISTIC",
  "NEWS_IMPACT",
  "NARRATIVE",
  "ORDER_TYPE",
  "BAIS",
  "PSYCHOLOGY",
  "MISTAKE",
  "ENTRY_PERFORMANCE",
  "WEEKLY_REPORT",
  "PARENT_ITEM",
  "SUB_ITEM",
] as const;
export type JournalNotionRelationKey = (typeof JOURNAL_NOTION_RELATION_KEYS)[number];

export const JOURNAL_NOTION_SINGLE_RELATION_KEYS = [
  "ACCOUNT",
  "TYPE_OF_TRADE",
  "NEWS_IMPACT",
  "NARRATIVE",
  "ORDER_TYPE",
  "BAIS",
  "PSYCHOLOGY",
  "ENTRY_PERFORMANCE",
  "WEEKLY_REPORT",
  "PARENT_ITEM",
] as const satisfies readonly JournalNotionRelationKey[];

export const JOURNAL_NOTION_RELATION_LABELS: Record<JournalNotionRelationKey, string> = {
  ACCOUNT: "Account",
  TYPE_OF_REVIEW: "Type of Review",
  TYPE_OF_TRADE: "Type of Trade",
  CHART_PATTERN: "Chart Pattern",
  CONFLUENCE: "Confluences",
  CHARACTERISTIC: "Characteristics",
  NEWS_IMPACT: "News Impact",
  NARRATIVE: "Narrative",
  ORDER_TYPE: "Order Type",
  BAIS: "Bias",
  PSYCHOLOGY: "Psychology",
  MISTAKE: "Mistakes",
  ENTRY_PERFORMANCE: "Entry Performance",
  WEEKLY_REPORT: "Weekly Report",
  PARENT_ITEM: "Parent item",
  SUB_ITEM: "Sub-item",
};

const optionalText = z.string().max(20000).optional().default("");
const optionalShortText = z.string().max(240).nullable().optional();
const optionalSymbol = z.string().max(20).transform((value) => value.trim().toUpperCase()).nullable().optional();
const optionalNumber = z.number().finite().nullable().optional();
const optionalScore = z.number().int().min(1).max(5).nullable().optional();
const optionalDateString = z.string().nullable().optional();
const optionalTitle = z.string().max(240).optional().default("");
const expectedUpdatedAt = z.string().datetime().optional();

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

export function normalizeJournalNotionRelationValue(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 160);
}

export function normalizeJournalNotionRelationSlug(value: string) {
  return normalizeJournalNotionRelationValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeJournalNotionRelationValues(values: string[] | undefined, maxValues = 80) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values ?? []) {
    const value = normalizeJournalNotionRelationValue(raw);
    const key = normalizeJournalNotionRelationSlug(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length >= maxValues) break;
  }
  return normalized;
}

export type JournalNotionRelations = Record<JournalNotionRelationKey, string[]>;

export function emptyJournalNotionRelations(): JournalNotionRelations {
  return Object.fromEntries(JOURNAL_NOTION_RELATION_KEYS.map((key) => [key, []])) as unknown as JournalNotionRelations;
}

export function normalizeJournalNotionRelations(input?: Partial<Record<JournalNotionRelationKey, string[]>>) {
  const single = new Set<JournalNotionRelationKey>(JOURNAL_NOTION_SINGLE_RELATION_KEYS);
  const result = emptyJournalNotionRelations();
  for (const key of JOURNAL_NOTION_RELATION_KEYS) {
    result[key] = normalizeJournalNotionRelationValues(input?.[key], single.has(key) ? 1 : 80);
  }
  return result;
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function deriveJournalNotionSystemFields(input: {
  id?: string | null;
  createdAt?: Date | string | null;
  ideaDate?: Date | string | null;
  entryEndAt?: Date | string | null;
  notionRelations?: Partial<Record<JournalNotionRelationKey, string[]>>;
  bestExitR?: number | null;
  mfeR?: number | null;
  outcomeStatus?: string | null;
}) {
  const start = dateValue(input.ideaDate);
  const end = dateValue(input.entryEndAt);
  const createdAt = dateValue(input.createdAt);
  const accounts = normalizeJournalNotionRelations(input.notionRelations).ACCOUNT;
  const rValue = typeof input.bestExitR === "number"
    ? input.bestExitR
    : typeof input.mfeR === "number"
      ? input.mfeR
      : null;

  let profitLoss: "Profit" | "Loss" | "Breakeven" | null = null;
  if (typeof rValue === "number") {
    profitLoss = rValue === 0 ? "Breakeven" : rValue > 0 ? "Profit" : "Loss";
  } else if (input.outcomeStatus === "FAILED") {
    profitLoss = "Loss";
  } else if (input.outcomeStatus === "TRIGGERED" || input.outcomeStatus === "WORKED_WITHOUT_ME") {
    profitLoss = "Profit";
  }

  return {
    id: input.id ?? null,
    createdTime: createdAt?.toISOString() ?? null,
    durationMinutes: start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : null,
    backtest: accounts.some((account) => normalizeJournalNotionRelationSlug(account) === "backtest"),
    profitLoss,
  };
}

const tagArraySchema = z.array(z.string().max(80)).optional().default([]);
const notionRelationMultiArraySchema = z.array(z.string().max(160)).max(80);
const notionRelationSingleArraySchema = z.array(z.string().max(160)).max(1);

export const journalNotionRelationsPayloadSchema = z.object({
  ACCOUNT: notionRelationSingleArraySchema.optional(),
  TYPE_OF_REVIEW: notionRelationMultiArraySchema.optional(),
  TYPE_OF_TRADE: notionRelationSingleArraySchema.optional(),
  CHART_PATTERN: notionRelationMultiArraySchema.optional(),
  CONFLUENCE: notionRelationMultiArraySchema.optional(),
  CHARACTERISTIC: notionRelationMultiArraySchema.optional(),
  NEWS_IMPACT: notionRelationSingleArraySchema.optional(),
  NARRATIVE: notionRelationSingleArraySchema.optional(),
  ORDER_TYPE: notionRelationSingleArraySchema.optional(),
  BAIS: notionRelationSingleArraySchema.optional(),
  PSYCHOLOGY: notionRelationSingleArraySchema.optional(),
  MISTAKE: notionRelationMultiArraySchema.optional(),
  ENTRY_PERFORMANCE: notionRelationSingleArraySchema.optional(),
  WEEKLY_REPORT: notionRelationSingleArraySchema.optional(),
  PARENT_ITEM: notionRelationSingleArraySchema.optional(),
  SUB_ITEM: notionRelationMultiArraySchema.optional(),
});

export const journalTagsPayloadSchema = z.object({
  SETUP: tagArraySchema,
  LESSON: tagArraySchema,
  MISTAKE: tagArraySchema,
  CONTEXT: tagArraySchema,
  CUSTOM: tagArraySchema,
}).partial();

export const journalEntryPayloadSchema = z.object({
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  tradeTitle: optionalTitle,
  ideaDate: z.string().min(1),
  entryEndAt: optionalDateString,
  direction: z.enum(["LONG", "SHORT"]).optional().default("LONG"),
  status: z.enum(["DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]).optional().default("DRAFT"),
  tradeStatus: z.enum(JOURNAL_NOTION_TRADE_STATUSES).nullable().optional(),
  playbookId: z.string().nullable().optional(),
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
  plannedEntry: optionalNumber,
  plannedStop: optionalNumber,
  plannedTarget1: optionalNumber,
  plannedTarget2: optionalNumber,
  plannedTarget3: optionalNumber,
  invalidationLevel: optionalNumber,
  expectedR: optionalNumber,
  exitMarked: z.boolean().optional().default(false),
  highAvat: z.boolean().optional().default(false),
  indexSupportive: z.boolean().optional().default(false),
  daysConsolidating: optionalNumber,
  daysFromT: optionalNumber,
  xFrom50Sma: optionalNumber,
  stopLossPercent: optionalNumber,
  riskPercent: optionalNumber,
  maxRiskReward: optionalNumber,
  idealExecutionOptions: z.array(z.enum(JOURNAL_NOTION_IDEAL_EXECUTION_OPTIONS)).optional().default([]),
  idealStopLossOptions: z.array(z.enum(JOURNAL_NOTION_IDEAL_STOP_LOSS_OPTIONS)).optional().default([]),
  actualTriggerAt: optionalDateString,
  followThroughDays: z.number().int().min(0).max(365).nullable().optional(),
  mfeR: optionalNumber,
  maeR: optionalNumber,
  bestExitR: optionalNumber,
  outcomeStatus: z.enum(JOURNAL_OUTCOME_STATUSES).optional().default("UNREVIEWED"),
  outcomeNotes: optionalText,
  confidenceScore: optionalScore,
  planClarityScore: optionalScore,
  preparationScore: optionalScore,
  patienceScore: optionalScore,
  ruleAdherenceScore: optionalScore,
  emotionalState: optionalShortText.nullable().optional(),
  wouldTakeAgain: z.boolean().nullable().optional(),
  marketRegime: z.enum(JOURNAL_MARKET_REGIMES).optional().default("UNKNOWN"),
  spyTrend: z.enum(JOURNAL_TREND_STATES).optional().default("UNKNOWN"),
  qqqTrend: z.enum(JOURNAL_TREND_STATES).optional().default("UNKNOWN"),
  iwmTrend: z.enum(JOURNAL_TREND_STATES).optional().default("UNKNOWN"),
  sectorTrend: z.enum(JOURNAL_TREND_STATES).optional().default("UNKNOWN"),
  sectorEtf: optionalSymbol,
  breadthNotes: optionalText,
  catalystNotes: optionalText,
  relativeStrengthNotes: optionalText,
  autoDraft: z.boolean().optional(),
  reviewDueAt: optionalDateString,
  outcomeCalculatedAt: optionalDateString,
  outcomeCalculationJson: z.string().max(200000).nullable().optional(),
  tags: journalTagsPayloadSchema.optional().default({}),
  notionRelations: journalNotionRelationsPayloadSchema.optional().default({}),
});

export const journalEntryPatchSchema = journalEntryPayloadSchema.partial().extend({
  tags: journalTagsPayloadSchema.optional(),
  expectedUpdatedAt,
});

export const journalEntryDeleteSchema = z.object({
  expectedUpdatedAt,
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
  purpose: z.enum(JOURNAL_CHART_PURPOSES).optional().default("CUSTOM"),
  compareSymbol: optionalSymbol,
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

export const journalChartCreateSchema = journalChartPayloadSchema.extend({
  expectedUpdatedAt,
});

export const journalChartPatchSchema = journalChartPayloadSchema.partial().extend({
  markers: z.array(chartMarkerPayloadSchema).optional(),
  expectedUpdatedAt,
});

export const journalSnapshotPayloadSchema = z.object({
  screenshotDataUrl: z.string().max(12_000_000),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
  tradingViewLayoutJson: z.string().max(200000).nullable().optional(),
  expectedUpdatedAt,
});

export const journalOutcomePatchSchema = journalEntryPatchSchema.pick({
  actualTriggerAt: true,
  followThroughDays: true,
  mfeR: true,
  maeR: true,
  bestExitR: true,
  outcomeStatus: true,
  outcomeNotes: true,
  wouldTakeAgain: true,
  expectedUpdatedAt: true,
});

export const journalPlaybookRulePayloadSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1).max(2000),
  category: z.string().max(80).optional().default("SETUP"),
  required: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(999).optional().default(0),
});

export const journalPlaybookPayloadSchema = z.object({
  name: z.string().min(1).max(160),
  setupType: optionalShortText.nullable().optional(),
  description: optionalText,
  idealConditions: optionalText,
  invalidationRules: optionalText,
  marketRegimeFit: optionalText,
  archived: z.boolean().optional().default(false),
  rules: z.array(journalPlaybookRulePayloadSchema).optional().default([]),
});

export const journalPlaybookPatchSchema = journalPlaybookPayloadSchema.partial().extend({
  rules: z.array(journalPlaybookRulePayloadSchema).optional(),
  expectedUpdatedAt,
});

export const journalRuleChecksPayloadSchema = z.object({
  checks: z.array(z.object({
    playbookRuleId: z.string().min(1),
    status: z.enum(JOURNAL_RULE_CHECK_STATUSES),
    notes: z.string().max(4000).optional().default(""),
  })),
  expectedUpdatedAt,
});

export const journalReviewActionPayloadSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(1000),
  status: z.enum(JOURNAL_ACTION_STATUSES).optional().default("OPEN"),
  journalEntryId: z.string().nullable().optional(),
  playbookId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

export const journalReviewPayloadSchema = z.object({
  period: z.enum(JOURNAL_REVIEW_PERIODS),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  summary: optionalText,
  bestIdea: optionalText,
  bestIdeaEntryId: z.string().nullable().optional(),
  worstMiss: optionalText,
  worstMissEntryId: z.string().nullable().optional(),
  recurringLesson: optionalText,
  nextFocus: optionalText,
  actions: z.array(journalReviewActionPayloadSchema).optional().default([]),
});

export const journalReviewPatchSchema = journalReviewPayloadSchema.partial().extend({
  actions: z.array(journalReviewActionPayloadSchema).optional(),
  expectedUpdatedAt,
});

export const journalDraftPayloadSchema = journalEntryPayloadSchema.pick({
  symbol: true,
  tradeTitle: true,
  ideaDate: true,
  entryEndAt: true,
  direction: true,
  timeframe: true,
  setup: true,
  macroSentiment: true,
  thesis: true,
  trigger: true,
  plannedEntry: true,
  plannedStop: true,
  plannedTarget1: true,
  tags: true,
  notionRelations: true,
}).partial({
  direction: true,
  timeframe: true,
  setup: true,
  macroSentiment: true,
  thesis: true,
  trigger: true,
  plannedEntry: true,
  plannedStop: true,
  plannedTarget1: true,
  tags: true,
  tradeTitle: true,
  entryEndAt: true,
  notionRelations: true,
}).extend({
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  ideaDate: z.string().optional().default(() => new Date().toISOString()),
});

export const journalOutcomeCalculatePayloadSchema = z.object({
  apply: z.boolean().optional().default(false),
  expectedUpdatedAt,
});

export const journalSavedViewPayloadSchema = z.object({
  name: z.string().min(1).max(120),
  viewType: z.enum(JOURNAL_SAVED_VIEW_TYPES),
  filtersJson: z.string().max(20000).optional().default("{}"),
  sortKey: z.string().max(80).nullable().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const journalSavedViewPatchSchema = journalSavedViewPayloadSchema.partial();

export const journalBulkPayloadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  addTags: journalTagsPayloadSchema.optional(),
  removeTags: journalTagsPayloadSchema.optional(),
  status: z.enum(["DRAFT", "WATCHING", "MISSED", "PASSED", "INVALIDATED", "PLAYBOOK", "ARCHIVED"]).nullable().optional(),
  outcomeStatus: z.enum(JOURNAL_OUTCOME_STATUSES).nullable().optional(),
  macroSentiment: z.enum(["BULLISH", "NEUTRAL", "BEARISH"]).nullable().optional(),
  marketRegime: z.enum(JOURNAL_MARKET_REGIMES).nullable().optional(),
  playbookId: z.string().nullable().optional(),
});

export const journalTagOperationSchema = z.object({
  category: z.enum(JOURNAL_TAG_CATEGORIES),
  from: z.string().min(1).max(80).optional(),
  to: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80).optional(),
  ids: z.array(z.string().min(1)).max(500).optional(),
});

export const journalPlaybookExamplePayloadSchema = z.object({
  journalEntryId: z.string().min(1),
  chartId: z.string().nullable().optional(),
  note: z.string().max(4000).optional().default(""),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
});
