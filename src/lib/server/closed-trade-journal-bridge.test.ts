import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { ClosedTradeJournalBridgeError, createJournalEntryFromClosedTrade } from "@/lib/server/journal";
import { lockClosedTradeForReview } from "@/lib/server/closed-trade-review-lock";

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createClosedTradeFixture(options: { isStale?: boolean; note?: Partial<{
  content: string;
  setup: string;
  thesis: string;
  entryReview: string;
  exitReview: string;
  mistake: string;
  lesson: string;
  followUp: string;
}> | null } = {}) {
  const suffix = uniqueSuffix();
  const accountCode = `BRIDGE-${suffix}`;
  const symbol = `BRG${suffix.replace(/[^a-z0-9]/gi, "").slice(-8)}`.toUpperCase();
  const groupKey = `closed-trade-journal-bridge-${suffix}`;
  const tagName = `bridge-tag-${suffix}`;
  const account = await prisma.account.create({
    data: { name: accountCode, ibkrAccount: accountCode, baseCurrency: "USD" },
  });
  const instrument = await prisma.instrument.create({
    data: { symbol, exchange: `X${suffix.slice(-10)}`, assetType: "STOCK", currency: "USD" },
  });
  const closedTrade = await prisma.closedTrade.create({
    data: {
      groupKey,
      accountId: account.id,
      instrumentId: instrument.id,
      symbol,
      direction: "LONG",
      openTime: new Date("2026-02-20T14:30:00.000Z"),
      closeTime: new Date("2026-02-20T15:45:00.000Z"),
      tradeDate: new Date("2026-02-20T00:00:00.000Z"),
      totalQuantity: 10,
      avgEntryPrice: 100,
      avgExitPrice: 110,
      grossRealizedPnl: 100,
      openingQuantity: 0,
      closingQuantity: 0,
      realizedPnl: 98,
      totalCommission: 2,
      isStale: options.isStale ?? false,
      staleAt: options.isStale ? new Date("2026-02-21T00:00:00.000Z") : null,
      staleReason: options.isStale ? "Test stale trade." : null,
    },
  });
  const tag = await prisma.tag.create({ data: { name: tagName } });
  await prisma.closedTradeTag.create({ data: { closedTradeGroupKey: groupKey, tagId: tag.id } });
  if (options.note !== null) {
    await prisma.closedTradeNote.create({
      data: {
        groupKey,
        content: options.note?.content ?? "Legacy note kept for context.",
        setup: options.note?.setup ?? "Opening drive",
        thesis: options.note?.thesis ?? "Strong demand after the first pullback.",
        entryReview: options.note?.entryReview ?? "Entry was patient.",
        exitReview: options.note?.exitReview ?? "Scaled out into strength.",
        mistake: options.note?.mistake ?? "Sized a little too late.",
        lesson: options.note?.lesson ?? "Wait for the retest.",
        followUp: options.note?.followUp ?? "Track the next opening drive.",
      },
    });
  }

  return { account, closedTrade, groupKey, instrument, tagName };
}

async function closedTradeReviewToken(groupKey: string) {
  const review = await prisma.closedTradeNote.findUnique({
    where: { groupKey },
    select: { updatedAt: true },
  });
  return review?.updatedAt.toISOString() ?? null;
}

async function cleanupClosedTradeFixture(input: {
  accountId: string;
  groupKey: string;
  instrumentId: string;
  tagName: string;
}) {
  await prisma.journalEntry.deleteMany({
    where: { links: { some: { targetType: "CLOSED_TRADE", targetId: input.groupKey } } },
  });
  await prisma.closedTradeTag.deleteMany({ where: { closedTradeGroupKey: input.groupKey } });
  await prisma.closedTradeNote.deleteMany({ where: { groupKey: input.groupKey } });
  await prisma.closedTrade.deleteMany({ where: { groupKey: input.groupKey } });
  await prisma.tag.deleteMany({ where: { name: input.tagName } });
  await prisma.instrument.deleteMany({ where: { id: input.instrumentId } });
  await prisma.account.deleteMany({ where: { id: input.accountId } });
}

describe("createJournalEntryFromClosedTrade", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  dbIt("copies a closed-trade review into an idempotently linked journal entry", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const first = await createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt });
      const second = await createJournalEntryFromClosedTrade(fixture.groupKey);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entry.id).toBe(first.entry.id);
      expect(first.entry).toMatchObject({
        symbol: fixture.closedTrade.symbol,
        tradeTitle: `${fixture.closedTrade.symbol} LONG closed trade review`,
        setup: "Opening drive",
        thesis: "Strong demand after the first pullback.",
        trigger: "Entry was patient.",
        idealExecutionPlan: "Scaled out into strength.",
        missedReason: "Sized a little too late.",
        lessonLearned: "Wait for the retest.",
      });
      expect(first.entry.tags.CUSTOM).toContain(fixture.tagName);
      expect(first.entry.links).toEqual([
        expect.objectContaining({
          linkType: "REVIEW_SOURCE",
          targetType: "CLOSED_TRADE",
          targetId: fixture.groupKey,
        }),
      ]);

      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(1);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("keeps legacy closed-trade note content out of structured thesis", async () => {
    const fixture = await createClosedTradeFixture({
      note: {
        content: "Legacy note should remain only in outcome notes.",
        thesis: "",
      },
    });

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const result = await createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt });

      expect(result.entry.thesis).toBe("");
      expect(result.entry.outcomeNotes).toContain("Legacy note should remain only in outcome notes.");
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("keeps one linked journal entry across concurrent bridge calls", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt })),
      );
      const entryIds = new Set(results.map((result) => result.entry.id));
      const linkedEntries = await prisma.journalLink.findMany({
        where: { linkType: "REVIEW_SOURCE", targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });

      expect(entryIds.size).toBe(1);
      expect(linkedEntries).toHaveLength(1);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  }, 20_000);

  dbIt("serializes journal creation with a concurrent closed-trade review save", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const changedAt = new Date(new Date(expectedReviewUpdatedAt ?? "").getTime() + 1000);
      let releaseReviewSave!: () => void;
      let reportLockAcquired!: () => void;
      const reviewSaveRelease = new Promise<void>((resolve) => {
        releaseReviewSave = resolve;
      });
      const lockAcquired = new Promise<void>((resolve) => {
        reportLockAcquired = resolve;
      });

      const reviewSave = prisma.$transaction(async (tx) => {
        await lockClosedTradeForReview(tx, fixture.groupKey);
        reportLockAcquired();
        await reviewSaveRelease;
        await tx.closedTradeNote.update({
          where: { groupKey: fixture.groupKey },
          data: { thesis: "Concurrent review save wins before bridge validation.", updatedAt: changedAt },
        });
      });

      await lockAcquired;
      const bridgeResult = createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt }).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      releaseReviewSave();
      await reviewSave;

      const result = await bridgeResult;
      expect(result.value).toBeNull();
      expect(result.error).toMatchObject({
        code: "CLOSED_TRADE_REVIEW_CHANGED",
        status: 409,
        currentReviewUpdatedAt: changedAt.toISOString(),
      } satisfies Partial<ClosedTradeJournalBridgeError>);
      await expect(prisma.journalLink.count({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      })).resolves.toBe(0);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  }, 20_000);

  dbIt("rejects stale closed trades without creating a journal link", async () => {
    const fixture = await createClosedTradeFixture({ isStale: true });

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      await expect(createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt })).rejects.toMatchObject({
        code: "STALE_CLOSED_TRADE",
        status: 409,
      } satisfies Partial<ClosedTradeJournalBridgeError>);

      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(0);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("opens an existing linked journal even after the closed trade becomes stale", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const first = await createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt });
      await prisma.closedTrade.update({
        where: { groupKey: fixture.groupKey },
        data: {
          isStale: true,
          staleAt: new Date("2026-02-21T00:00:00.000Z"),
          staleReason: "No longer present in the latest refresh.",
        },
      });

      const second = await createJournalEntryFromClosedTrade(fixture.groupKey);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.entry.id).toBe(first.entry.id);
      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(1);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("requires a review version before first-time journal creation", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      await expect(createJournalEntryFromClosedTrade(fixture.groupKey)).rejects.toMatchObject({
        code: "CLOSED_TRADE_REVIEW_CHANGED",
        status: 409,
      } satisfies Partial<ClosedTradeJournalBridgeError>);

      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(0);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("rejects first-time creation when the closed-trade review changed after the captured version", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const expectedReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      const changedAt = new Date(new Date(expectedReviewUpdatedAt ?? "").getTime() + 1000);
      await prisma.closedTradeNote.update({
        where: { groupKey: fixture.groupKey },
        data: {
          thesis: "Updated by another tab.",
          updatedAt: changedAt,
        },
      });

      await expect(createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt })).rejects.toMatchObject({
        code: "CLOSED_TRADE_REVIEW_CHANGED",
        status: 409,
        currentReviewUpdatedAt: changedAt.toISOString(),
      } satisfies Partial<ClosedTradeJournalBridgeError>);

      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(0);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("rejects first-time creation when no review was expected but one now exists", async () => {
    const fixture = await createClosedTradeFixture();

    try {
      const currentReviewUpdatedAt = await closedTradeReviewToken(fixture.groupKey);
      await expect(createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt: null })).rejects.toMatchObject({
        code: "CLOSED_TRADE_REVIEW_CHANGED",
        status: 409,
        currentReviewUpdatedAt,
      } satisfies Partial<ClosedTradeJournalBridgeError>);

      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(0);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });

  dbIt("creates a blank linked journal when no review exists and null was expected", async () => {
    const fixture = await createClosedTradeFixture({ note: null });

    try {
      const result = await createJournalEntryFromClosedTrade(fixture.groupKey, { expectedReviewUpdatedAt: null });

      expect(result.created).toBe(true);
      expect(result.entry.setup).toBeNull();
      expect(result.entry.thesis).toBe("");
      const linkedEntries = await prisma.journalLink.findMany({
        where: { targetType: "CLOSED_TRADE", targetId: fixture.groupKey },
      });
      expect(linkedEntries).toHaveLength(1);
    } finally {
      await cleanupClosedTradeFixture({
        accountId: fixture.account.id,
        groupKey: fixture.groupKey,
        instrumentId: fixture.instrument.id,
        tagName: fixture.tagName,
      });
    }
  });
});
