import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  JOURNAL_TAG_CATEGORIES,
  normalizeJournalTags,
  type JournalTagCategoryValue,
} from "@/lib/journal/schema";

type JournalTagBuckets = Partial<Record<JournalTagCategoryValue, string[]>>;

const journalInclude = {
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
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
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
  symbol?: string | null;
  limit?: number | null;
}) {
  const where: Prisma.JournalEntryWhereInput = {};
  const q = filters.q?.trim();
  const tag = filters.tag?.trim().replace(/^#+/, "").toLowerCase();
  const category = JOURNAL_TAG_CATEGORIES.includes(filters.category as JournalTagCategoryValue)
    ? (filters.category as JournalTagCategoryValue)
    : undefined;
  const limit = Math.max(1, Math.min(100, Number(filters.limit ?? 50)));

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
  rating?: number | null;
  tags?: JournalTagBuckets;
  [key: string]: unknown;
}): JournalEntryMutationInput {
  return {
    ...payload,
    ideaDate: dateFromInput(payload.ideaDate),
    rating: payload.rating ?? null,
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
