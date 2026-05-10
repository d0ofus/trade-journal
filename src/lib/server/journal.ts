import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  JOURNAL_TAG_CATEGORIES,
  normalizeJournalTags,
  type JournalTagCategoryValue,
} from "@/lib/journal/schema";
import { computeJournalAnalytics } from "@/lib/journal/analytics";

type JournalTagBuckets = Partial<Record<JournalTagCategoryValue, string[]>>;

const journalInclude = {
  playbook: {
    include: {
      rules: {
        orderBy: { sortOrder: "asc" as const },
      },
    },
  },
  charts: {
    include: {
      markers: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
  tags: {
    include: {
      tag: true,
    },
  },
  contextSnapshots: {
    orderBy: { createdAt: "desc" as const },
    take: 3,
  },
  links: {
    orderBy: { createdAt: "desc" as const },
  },
  ruleChecks: {
    include: {
      playbookRule: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.JournalEntryInclude;

export type JournalEntryWithRelations = Prisma.JournalEntryGetPayload<{
  include: typeof journalInclude;
}>;

function dateFromInput(value?: string | null) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function nullableDateFromInput(value?: string | null) {
  if (value === null) return null;
  return dateFromInput(value);
}

export function normalizeTagBuckets(input?: JournalTagBuckets): Record<JournalTagCategoryValue, string[]> {
  return Object.fromEntries(
    JOURNAL_TAG_CATEGORIES.map((category) => [category, normalizeJournalTags(input?.[category])]),
  ) as Record<JournalTagCategoryValue, string[]>;
}

export function serializeJournalEntry(entry: JournalEntryWithRelations) {
  const tags = Object.fromEntries(JOURNAL_TAG_CATEGORIES.map((category) => [category, [] as string[]])) as Record<
    JournalTagCategoryValue,
    string[]
  >;

  for (const row of entry.tags) {
    tags[row.category].push(row.tag.name);
  }

  for (const category of JOURNAL_TAG_CATEGORIES) {
    tags[category].sort((left, right) => left.localeCompare(right));
  }

  return {
    ...entry,
    ideaDate: entry.ideaDate.toISOString(),
    actualTriggerAt: entry.actualTriggerAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    playbook: entry.playbook
      ? {
          ...entry.playbook,
          createdAt: entry.playbook.createdAt.toISOString(),
          updatedAt: entry.playbook.updatedAt.toISOString(),
          rules: entry.playbook.rules.map((rule) => ({
            ...rule,
            createdAt: rule.createdAt.toISOString(),
            updatedAt: rule.updatedAt.toISOString(),
          })),
        }
      : null,
    tags,
    charts: entry.charts.map((chart) => ({
      ...chart,
      rangeStart: chart.rangeStart?.toISOString() ?? null,
      rangeEnd: chart.rangeEnd?.toISOString() ?? null,
      createdAt: chart.createdAt.toISOString(),
      updatedAt: chart.updatedAt.toISOString(),
      markers: chart.markers.map((marker) => ({
        ...marker,
        time: marker.time?.toISOString() ?? null,
        createdAt: marker.createdAt.toISOString(),
      })),
    })),
    contextSnapshots: entry.contextSnapshots.map((snapshot) => ({
      ...snapshot,
      createdAt: snapshot.createdAt.toISOString(),
    })),
    links: entry.links.map((link) => ({
      ...link,
      createdAt: link.createdAt.toISOString(),
    })),
    ruleChecks: entry.ruleChecks.map((check) => ({
      ...check,
      createdAt: check.createdAt.toISOString(),
      updatedAt: check.updatedAt.toISOString(),
      playbookRule: check.playbookRule
        ? {
            ...check.playbookRule,
            createdAt: check.playbookRule.createdAt.toISOString(),
            updatedAt: check.playbookRule.updatedAt.toISOString(),
          }
        : null,
    })),
  };
}

async function syncJournalTags(tx: Prisma.TransactionClient, journalEntryId: string, tagBuckets: JournalTagBuckets) {
  const normalized = normalizeTagBuckets(tagBuckets);
  await tx.journalEntryTag.deleteMany({ where: { journalEntryId } });

  const rows: Array<{ journalEntryId: string; tagId: string; category: JournalTagCategoryValue }> = [];
  for (const category of JOURNAL_TAG_CATEGORIES) {
    for (const tagName of normalized[category]) {
      const tag = await tx.tag.upsert({
        where: { name: tagName },
        update: {},
        create: { name: tagName },
        select: { id: true },
      });
      rows.push({ journalEntryId, tagId: tag.id, category });
    }
  }

  if (rows.length > 0) {
    await tx.journalEntryTag.createMany({ data: rows, skipDuplicates: true });
  }
}

export async function listJournalEntries(filters: {
  q?: string | null;
  tag?: string | null;
  category?: string | null;
  status?: string | null;
  macroSentiment?: string | null;
  outcomeStatus?: string | null;
  marketRegime?: string | null;
  playbookId?: string | null;
  chartFilter?: string | null;
  symbol?: string | null;
  limit?: number | null;
}) {
  const where: Prisma.JournalEntryWhereInput = {};
  const q = filters.q?.trim();
  const tag = filters.tag?.trim().replace(/^#+/, "").toLowerCase();
  const category = JOURNAL_TAG_CATEGORIES.includes(filters.category as JournalTagCategoryValue)
    ? (filters.category as JournalTagCategoryValue)
    : undefined;
  const limit = Math.max(1, Math.min(1000, Number(filters.limit ?? 50)));

  if (q) {
    where.OR = [
      { symbol: { contains: q, mode: "insensitive" } },
      { setup: { contains: q, mode: "insensitive" } },
      { thesis: { contains: q, mode: "insensitive" } },
      { lessonLearned: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filters.symbol) where.symbol = { equals: filters.symbol.trim().toUpperCase() };
  if (filters.status) where.status = filters.status as Prisma.EnumJournalStatusFilter["equals"];
  if (filters.macroSentiment) {
    where.macroSentiment = filters.macroSentiment as Prisma.EnumMacroSentimentFilter["equals"];
  }
  if (filters.outcomeStatus) where.outcomeStatus = filters.outcomeStatus as Prisma.EnumJournalOutcomeStatusFilter["equals"];
  if (filters.marketRegime) where.marketRegime = filters.marketRegime as Prisma.EnumJournalMarketRegimeFilter["equals"];
  if (filters.playbookId) where.playbookId = filters.playbookId;
  if (filters.chartFilter === "WITH_CHARTS") where.charts = { some: {} };
  if (filters.chartFilter === "WITHOUT_CHARTS") where.charts = { none: {} };
  if (tag) {
    where.tags = {
      some: {
        category,
        tag: { name: { equals: tag } },
      },
    };
  }

  const rows = await prisma.journalEntry.findMany({
    where,
    include: journalInclude,
    orderBy: [{ ideaDate: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map(serializeJournalEntry);
}

export async function getJournalEntry(id: string) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: journalInclude,
  });
  return entry ? serializeJournalEntry(entry) : null;
}

type JournalEntryMutationInput = Record<string, unknown> & { tags?: JournalTagBuckets };

export async function createJournalEntry(input: JournalEntryMutationInput) {
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.journalEntry.create({
      data: {
        symbol: input.symbol as string,
        ideaDate: (input.ideaDate as Date | undefined) ?? new Date(),
        direction: input.direction as Prisma.JournalEntryUncheckedCreateInput["direction"],
        status: input.status as Prisma.JournalEntryUncheckedCreateInput["status"],
        playbookId: input.playbookId as string | null | undefined,
        setup: input.setup as string | null | undefined,
        timeframe: input.timeframe as string,
        macroSentiment: input.macroSentiment as Prisma.JournalEntryUncheckedCreateInput["macroSentiment"],
        thesis: input.thesis as string,
        trigger: input.trigger as string,
        riskPlan: input.riskPlan as string,
        idealExecutionPlan: input.idealExecutionPlan as string,
        missedReason: input.missedReason as string,
        marketContext: input.marketContext as string,
        peerContext: input.peerContext as string,
        rating: input.rating as number | null | undefined,
        lessonLearned: input.lessonLearned as string,
        plannedEntry: input.plannedEntry as number | null | undefined,
        plannedStop: input.plannedStop as number | null | undefined,
        plannedTarget1: input.plannedTarget1 as number | null | undefined,
        plannedTarget2: input.plannedTarget2 as number | null | undefined,
        plannedTarget3: input.plannedTarget3 as number | null | undefined,
        invalidationLevel: input.invalidationLevel as number | null | undefined,
        expectedR: input.expectedR as number | null | undefined,
        actualTriggerAt: input.actualTriggerAt as Date | null | undefined,
        followThroughDays: input.followThroughDays as number | null | undefined,
        mfeR: input.mfeR as number | null | undefined,
        maeR: input.maeR as number | null | undefined,
        bestExitR: input.bestExitR as number | null | undefined,
        outcomeStatus: input.outcomeStatus as Prisma.JournalEntryUncheckedCreateInput["outcomeStatus"],
        outcomeNotes: input.outcomeNotes as string,
        confidenceScore: input.confidenceScore as number | null | undefined,
        planClarityScore: input.planClarityScore as number | null | undefined,
        preparationScore: input.preparationScore as number | null | undefined,
        patienceScore: input.patienceScore as number | null | undefined,
        ruleAdherenceScore: input.ruleAdherenceScore as number | null | undefined,
        emotionalState: input.emotionalState as string | null | undefined,
        wouldTakeAgain: input.wouldTakeAgain as boolean | null | undefined,
        marketRegime: input.marketRegime as Prisma.JournalEntryUncheckedCreateInput["marketRegime"],
        spyTrend: input.spyTrend as Prisma.JournalEntryUncheckedCreateInput["spyTrend"],
        qqqTrend: input.qqqTrend as Prisma.JournalEntryUncheckedCreateInput["qqqTrend"],
        iwmTrend: input.iwmTrend as Prisma.JournalEntryUncheckedCreateInput["iwmTrend"],
        sectorTrend: input.sectorTrend as Prisma.JournalEntryUncheckedCreateInput["sectorTrend"],
        sectorEtf: input.sectorEtf as string | null | undefined,
        breadthNotes: input.breadthNotes as string,
        catalystNotes: input.catalystNotes as string,
        relativeStrengthNotes: input.relativeStrengthNotes as string,
      },
      select: { id: true },
    });
    await syncJournalTags(tx, created.id, input.tags ?? {});
    return tx.journalEntry.findUniqueOrThrow({ where: { id: created.id }, include: journalInclude });
  });

  return serializeJournalEntry(entry);
}

export async function updateJournalEntry(
  id: string,
  input: JournalEntryMutationInput,
) {
  const entry = await prisma.$transaction(async (tx) => {
    await tx.journalEntry.update({
      where: { id },
      data: {
        symbol: input.symbol as string | undefined,
        ideaDate: input.ideaDate as Date | undefined,
        direction: input.direction as Prisma.JournalEntryUncheckedUpdateInput["direction"],
        status: input.status as Prisma.JournalEntryUncheckedUpdateInput["status"],
        playbookId: input.playbookId as string | null | undefined,
        setup: input.setup as string | null | undefined,
        timeframe: input.timeframe as string | undefined,
        macroSentiment: input.macroSentiment as Prisma.JournalEntryUncheckedUpdateInput["macroSentiment"],
        thesis: input.thesis as string | undefined,
        trigger: input.trigger as string | undefined,
        riskPlan: input.riskPlan as string | undefined,
        idealExecutionPlan: input.idealExecutionPlan as string | undefined,
        missedReason: input.missedReason as string | undefined,
        marketContext: input.marketContext as string | undefined,
        peerContext: input.peerContext as string | undefined,
        rating: input.rating as number | null | undefined,
        lessonLearned: input.lessonLearned as string | undefined,
        plannedEntry: input.plannedEntry as number | null | undefined,
        plannedStop: input.plannedStop as number | null | undefined,
        plannedTarget1: input.plannedTarget1 as number | null | undefined,
        plannedTarget2: input.plannedTarget2 as number | null | undefined,
        plannedTarget3: input.plannedTarget3 as number | null | undefined,
        invalidationLevel: input.invalidationLevel as number | null | undefined,
        expectedR: input.expectedR as number | null | undefined,
        actualTriggerAt: input.actualTriggerAt as Date | null | undefined,
        followThroughDays: input.followThroughDays as number | null | undefined,
        mfeR: input.mfeR as number | null | undefined,
        maeR: input.maeR as number | null | undefined,
        bestExitR: input.bestExitR as number | null | undefined,
        outcomeStatus: input.outcomeStatus as Prisma.JournalEntryUncheckedUpdateInput["outcomeStatus"],
        outcomeNotes: input.outcomeNotes as string | undefined,
        confidenceScore: input.confidenceScore as number | null | undefined,
        planClarityScore: input.planClarityScore as number | null | undefined,
        preparationScore: input.preparationScore as number | null | undefined,
        patienceScore: input.patienceScore as number | null | undefined,
        ruleAdherenceScore: input.ruleAdherenceScore as number | null | undefined,
        emotionalState: input.emotionalState as string | null | undefined,
        wouldTakeAgain: input.wouldTakeAgain as boolean | null | undefined,
        marketRegime: input.marketRegime as Prisma.JournalEntryUncheckedUpdateInput["marketRegime"],
        spyTrend: input.spyTrend as Prisma.JournalEntryUncheckedUpdateInput["spyTrend"],
        qqqTrend: input.qqqTrend as Prisma.JournalEntryUncheckedUpdateInput["qqqTrend"],
        iwmTrend: input.iwmTrend as Prisma.JournalEntryUncheckedUpdateInput["iwmTrend"],
        sectorTrend: input.sectorTrend as Prisma.JournalEntryUncheckedUpdateInput["sectorTrend"],
        sectorEtf: input.sectorEtf as string | null | undefined,
        breadthNotes: input.breadthNotes as string | undefined,
        catalystNotes: input.catalystNotes as string | undefined,
        relativeStrengthNotes: input.relativeStrengthNotes as string | undefined,
      },
      select: { id: true },
    });
    if (input.tags) await syncJournalTags(tx, id, input.tags);
    return tx.journalEntry.findUniqueOrThrow({ where: { id }, include: journalInclude });
  });
  return serializeJournalEntry(entry);
}

export async function deleteJournalEntry(id: string) {
  await prisma.journalEntry.delete({ where: { id } });
}

export function mapJournalPayloadToData(payload: {
  ideaDate?: string;
  actualTriggerAt?: string | null;
  rating?: number | null;
  tags?: JournalTagBuckets;
  [key: string]: unknown;
}): JournalEntryMutationInput {
  const data: JournalEntryMutationInput = {
    ...payload,
    ideaDate: dateFromInput(payload.ideaDate),
    actualTriggerAt: nullableDateFromInput(payload.actualTriggerAt),
  };
  if (Object.prototype.hasOwnProperty.call(payload, "rating")) {
    data.rating = payload.rating ?? null;
  }
  return {
    ...data,
  };
}

export function mapChartPayloadToData(payload: {
  rangeStart?: string | null;
  rangeEnd?: string | null;
  [key: string]: unknown;
}) {
  return {
    ...payload,
    rangeStart: nullableDateFromInput(payload.rangeStart),
    rangeEnd: nullableDateFromInput(payload.rangeEnd),
  };
}

export async function listJournalTags() {
  const rows = await prisma.journalEntryTag.groupBy({
    by: ["tagId", "category"],
    _count: { tagId: true },
    orderBy: { _count: { tagId: "desc" } },
  });
  const tags = await prisma.tag.findMany({
    where: { id: { in: rows.map((row) => row.tagId) } },
    select: { id: true, name: true },
  });
  const tagById = new Map(tags.map((tag) => [tag.id, tag.name]));
  return rows.map((row) => ({
    tagId: row.tagId,
    name: tagById.get(row.tagId) ?? row.tagId,
    category: row.category,
    count: row._count.tagId,
  }));
}

const playbookInclude = {
  rules: {
    orderBy: { sortOrder: "asc" as const },
  },
  _count: {
    select: { entries: true },
  },
} satisfies Prisma.JournalPlaybookInclude;

function serializePlaybook(playbook: Prisma.JournalPlaybookGetPayload<{ include: typeof playbookInclude }>) {
  return {
    ...playbook,
    createdAt: playbook.createdAt.toISOString(),
    updatedAt: playbook.updatedAt.toISOString(),
    rules: playbook.rules.map((rule) => ({
      ...rule,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    })),
  };
}

export async function listJournalPlaybooks(options?: { includeArchived?: boolean }) {
  const rows = await prisma.journalPlaybook.findMany({
    where: options?.includeArchived ? undefined : { archived: false },
    include: playbookInclude,
    orderBy: [{ archived: "asc" }, { name: "asc" }],
  });
  return rows.map(serializePlaybook);
}

async function syncPlaybookRules(
  tx: Prisma.TransactionClient,
  playbookId: string,
  rules: Array<{ id?: string; text: string; category?: string; required?: boolean; sortOrder?: number }>,
) {
  const existing = await tx.journalPlaybookRule.findMany({ where: { playbookId }, select: { id: true } });
  const submittedIds = new Set(rules.flatMap((rule) => (rule.id ? [rule.id] : [])));
  const deletableIds = existing.map((rule) => rule.id).filter((id) => !submittedIds.has(id));
  if (deletableIds.length > 0) {
    await tx.journalPlaybookRule.deleteMany({ where: { id: { in: deletableIds }, playbookId } });
  }

  for (const [index, rule] of rules.entries()) {
    const data = {
      text: rule.text,
      category: rule.category ?? "SETUP",
      required: rule.required ?? true,
      sortOrder: rule.sortOrder ?? index,
    };
    if (rule.id && existing.some((candidate) => candidate.id === rule.id)) {
      await tx.journalPlaybookRule.update({ where: { id: rule.id }, data });
    } else {
      await tx.journalPlaybookRule.create({ data: { ...data, playbookId } });
    }
  }
}

type JournalPlaybookMutationInput = Record<string, unknown> & {
  rules?: Array<{ id?: string; text: string; category?: string; required?: boolean; sortOrder?: number }>;
};

export async function createJournalPlaybook(input: JournalPlaybookMutationInput) {
  const playbook = await prisma.$transaction(async (tx) => {
    const created = await tx.journalPlaybook.create({
      data: {
        name: String(input.name),
        setupType: input.setupType as string | null | undefined,
        description: input.description as string | undefined,
        idealConditions: input.idealConditions as string | undefined,
        invalidationRules: input.invalidationRules as string | undefined,
        marketRegimeFit: input.marketRegimeFit as string | undefined,
        archived: input.archived as boolean | undefined,
      },
      select: { id: true },
    });
    await syncPlaybookRules(tx, created.id, input.rules ?? []);
    return tx.journalPlaybook.findUniqueOrThrow({ where: { id: created.id }, include: playbookInclude });
  });
  return serializePlaybook(playbook);
}

export async function updateJournalPlaybook(id: string, input: JournalPlaybookMutationInput) {
  const playbook = await prisma.$transaction(async (tx) => {
    await tx.journalPlaybook.update({
      where: { id },
      data: {
        name: input.name as string | undefined,
        setupType: input.setupType as string | null | undefined,
        description: input.description as string | undefined,
        idealConditions: input.idealConditions as string | undefined,
        invalidationRules: input.invalidationRules as string | undefined,
        marketRegimeFit: input.marketRegimeFit as string | undefined,
        archived: input.archived as boolean | undefined,
      },
      select: { id: true },
    });
    if (input.rules) await syncPlaybookRules(tx, id, input.rules);
    return tx.journalPlaybook.findUniqueOrThrow({ where: { id }, include: playbookInclude });
  });
  return serializePlaybook(playbook);
}

export async function deleteJournalPlaybook(id: string) {
  await prisma.journalPlaybook.delete({ where: { id } });
}

export async function syncJournalRuleChecks(
  journalEntryId: string,
  checks: Array<{ playbookRuleId: string; status: "PASS" | "FAIL" | "NA"; notes?: string }>,
) {
  await prisma.journalEntry.findUniqueOrThrow({ where: { id: journalEntryId }, select: { id: true } });
  await prisma.$transaction(
    checks.map((check) =>
      prisma.journalEntryRuleCheck.upsert({
        where: {
          journalEntryId_playbookRuleId: {
            journalEntryId,
            playbookRuleId: check.playbookRuleId,
          },
        },
        update: {
          status: check.status,
          notes: check.notes ?? "",
        },
        create: {
          journalEntryId,
          playbookRuleId: check.playbookRuleId,
          status: check.status,
          notes: check.notes ?? "",
        },
      }),
    ),
  );
  return getJournalEntry(journalEntryId);
}

const reviewInclude = {
  actions: {
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.JournalReviewInclude;

function serializeReview(review: Prisma.JournalReviewGetPayload<{ include: typeof reviewInclude }>) {
  return {
    ...review,
    startDate: review.startDate.toISOString(),
    endDate: review.endDate.toISOString(),
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    actions: review.actions.map((action) => ({
      ...action,
      dueDate: action.dueDate?.toISOString() ?? null,
      createdAt: action.createdAt.toISOString(),
      updatedAt: action.updatedAt.toISOString(),
    })),
  };
}

type JournalReviewMutationInput = Record<string, unknown> & {
  actions?: Array<{
    label: string;
    status?: "OPEN" | "DONE" | "ARCHIVED";
    journalEntryId?: string | null;
    playbookId?: string | null;
    dueDate?: string | null;
  }>;
};

function reviewData(input: JournalReviewMutationInput) {
  return {
    period: input.period as Prisma.JournalReviewUncheckedCreateInput["period"],
    startDate: dateFromInput(input.startDate as string | undefined),
    endDate: dateFromInput(input.endDate as string | undefined),
    summary: input.summary as string | undefined,
    bestIdea: input.bestIdea as string | undefined,
    bestIdeaEntryId: input.bestIdeaEntryId as string | null | undefined,
    worstMiss: input.worstMiss as string | undefined,
    worstMissEntryId: input.worstMissEntryId as string | null | undefined,
    recurringLesson: input.recurringLesson as string | undefined,
    nextFocus: input.nextFocus as string | undefined,
  };
}

function actionRows(reviewId: string, actions: NonNullable<JournalReviewMutationInput["actions"]>) {
  return actions.map((action) => ({
    reviewId,
    label: action.label,
    status: action.status ?? "OPEN",
    journalEntryId: action.journalEntryId ?? null,
    playbookId: action.playbookId ?? null,
    dueDate: nullableDateFromInput(action.dueDate),
  }));
}

export async function listJournalReviews() {
  const rows = await prisma.journalReview.findMany({
    include: reviewInclude,
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map(serializeReview);
}

export async function createJournalReview(input: JournalReviewMutationInput) {
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.journalReview.create({
      data: reviewData(input) as Prisma.JournalReviewUncheckedCreateInput,
      select: { id: true },
    });
    if (input.actions?.length) {
      await tx.journalReviewAction.createMany({ data: actionRows(created.id, input.actions) });
    }
    return tx.journalReview.findUniqueOrThrow({ where: { id: created.id }, include: reviewInclude });
  });
  return serializeReview(review);
}

export async function updateJournalReview(id: string, input: JournalReviewMutationInput) {
  const review = await prisma.$transaction(async (tx) => {
    await tx.journalReview.update({
      where: { id },
      data: reviewData(input) as Prisma.JournalReviewUncheckedUpdateInput,
      select: { id: true },
    });
    if (input.actions) {
      await tx.journalReviewAction.deleteMany({ where: { reviewId: id } });
      if (input.actions.length > 0) {
        await tx.journalReviewAction.createMany({ data: actionRows(id, input.actions) });
      }
    }
    return tx.journalReview.findUniqueOrThrow({ where: { id }, include: reviewInclude });
  });
  return serializeReview(review);
}

export async function deleteJournalReview(id: string) {
  await prisma.journalReview.delete({ where: { id } });
}

export async function getJournalAnalytics() {
  const [entries, tags] = await Promise.all([
    listJournalEntries({ limit: 1000 }),
    listJournalTags(),
  ]);
  return computeJournalAnalytics(entries, tags);
}
