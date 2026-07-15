import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";
import { vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createJournalEntry,
  createJournalPlaybook,
  createJournalReview,
  deleteJournalEntry,
  JournalMissingVersionError,
  JournalStaleWriteError,
  updateJournalEntry,
  updateJournalPlaybook,
  updateJournalReview,
  syncJournalRuleChecks,
} from "@/lib/server/journal";

const storageMocks = vi.hoisted(() => ({
  storeJournalScreenshot: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(() => Promise.resolve({ user: { email: "demo@example.test" } })),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/server/journal-storage", () => ({
  storeJournalScreenshot: storageMocks.storeJournalScreenshot,
}));

function uniqueName(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function waitForTimestampTick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function chartPatchRequest(entryId: string, chartId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/journal/${entryId}/charts/${chartId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function chartSnapshotRequest(entryId: string, chartId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/journal/${entryId}/charts/${chartId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("journal stale-save protection", () => {
  const dbIt = process.env.DATABASE_URL ? it : it.skip;

  dbIt("requires version tokens before helper-level entry, delete, playbook, and review updates", async () => {
    const symbol = uniqueName("JMV").slice(0, 12).toUpperCase();
    const deleteSymbol = uniqueName("JMD").slice(0, 12).toUpperCase();
    const playbookName = uniqueName("Missing Version Playbook");
    const entry = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
      thesis: "original thesis",
    });
    const deleteEntry = await createJournalEntry({
      symbol: deleteSymbol,
      ideaDate: new Date("2026-01-03T00:00:00.000Z"),
      thesis: "delete guard thesis",
    });
    const playbook = await createJournalPlaybook({
      name: playbookName,
      description: "original description",
      rules: [{ text: "Original rule", sortOrder: 0 }],
    });
    const review = await createJournalReview({
      period: "WEEKLY",
      startDate: "2026-01-05",
      endDate: "2026-01-11",
      summary: "original summary",
      actions: [{ label: "Original action" }],
    });

    try {
      await expect(updateJournalEntry(entry.id, { thesis: "unguarded thesis" }))
        .rejects.toBeInstanceOf(JournalMissingVersionError);
      await expect(deleteJournalEntry(deleteEntry.id)).rejects.toBeInstanceOf(JournalMissingVersionError);
      await expect(updateJournalPlaybook(playbook.id, {
        description: "unguarded description",
        rules: [],
      })).rejects.toBeInstanceOf(JournalMissingVersionError);
      await expect(updateJournalReview(review.id, {
        summary: "unguarded summary",
        actions: [],
      })).rejects.toBeInstanceOf(JournalMissingVersionError);
      await expect(syncJournalRuleChecks(entry.id, [
        { playbookRuleId: playbook.rules[0].id, status: "PASS", notes: "unguarded checklist" },
      ])).rejects.toBeInstanceOf(JournalMissingVersionError);

      const [currentEntry, currentDeleteEntry, currentPlaybook, currentActions] = await Promise.all([
        prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } }),
        prisma.journalEntry.findUniqueOrThrow({ where: { id: deleteEntry.id } }),
        prisma.journalPlaybook.findUniqueOrThrow({
          where: { id: playbook.id },
          include: { rules: true },
        }),
        prisma.journalReviewAction.findMany({ where: { reviewId: review.id } }),
      ]);

      expect(currentEntry.thesis).toBe("original thesis");
      expect(currentDeleteEntry.thesis).toBe("delete guard thesis");
      expect(currentPlaybook.description).toBe("original description");
      expect(currentPlaybook.rules.map((rule) => rule.text)).toEqual(["Original rule"]);
      expect(currentActions.map((action) => action.label)).toEqual(["Original action"]);
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: { in: [entry.id, deleteEntry.id] } } });
      await prisma.journalPlaybook.deleteMany({ where: { id: playbook.id } });
      await prisma.journalReview.deleteMany({ where: { id: review.id } });
    }
  });

  dbIt("rejects stale entry updates without replacing tags or notion relations", async () => {
    const symbol = uniqueName("JST").slice(0, 12).toUpperCase();
    const originalTag = uniqueName("original-tag");
    const staleTag = uniqueName("stale-tag");

    const created = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
      tags: { LESSON: [originalTag] },
      notionRelations: { ACCOUNT: ["Backtest"] },
    });

    try {
      await waitForTimestampTick();
      await updateJournalEntry(created.id, {
        thesis: "fresh edit",
        expectedUpdatedAt: created.updatedAt,
      });

      await expect(
        updateJournalEntry(created.id, {
          thesis: "stale edit",
          tags: { LESSON: [staleTag] },
          notionRelations: { ACCOUNT: ["Live"] },
          expectedUpdatedAt: created.updatedAt,
        }),
      ).rejects.toBeInstanceOf(JournalStaleWriteError);

      const current = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          tags: { include: { tag: true } },
          notionRelations: { include: { relationTag: true } },
        },
      });

      expect(current.thesis).toBe("fresh edit");
      expect(current.tags.map((row) => row.tag.name)).toEqual([originalTag]);
      expect(current.notionRelations.map((row) => row.relationTag.name)).toEqual(["Backtest"]);
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: created.id } });
      await prisma.tag.deleteMany({ where: { name: { in: [originalTag, staleTag] } } });
    }
  });

  dbIt("rejects stale entry deletes without cascading charts, tags, or checklist rows", async () => {
    const symbol = uniqueName("JSD").slice(0, 12).toUpperCase();
    const originalTag = uniqueName("delete-guard-tag");
    const playbook = await createJournalPlaybook({
      name: uniqueName("Delete CAS Playbook"),
      rules: [{ text: "Protect destructive journal actions", sortOrder: 0 }],
    });
    const created = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
      playbookId: playbook.id,
      thesis: "original delete guard thesis",
      tags: { LESSON: [originalTag] },
    });
    await prisma.journalChart.create({
      data: {
        journalEntryId: created.id,
        symbol,
        timeframe: "5min",
        purpose: "REVIEW",
        caption: "Chart should survive stale delete",
      },
    });

    try {
      const withChecklist = await syncJournalRuleChecks(
        created.id,
        [{ playbookRuleId: playbook.rules[0].id, status: "PASS", notes: "Keep checklist" }],
        { expectedUpdatedAt: created.updatedAt },
      );

      await waitForTimestampTick();
      await updateJournalEntry(created.id, {
        thesis: "fresh edit before stale delete",
        expectedUpdatedAt: withChecklist.updatedAt,
      });

      await expect(
        deleteJournalEntry(created.id, { expectedUpdatedAt: withChecklist.updatedAt }),
      ).rejects.toBeInstanceOf(JournalStaleWriteError);

      const current = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          charts: true,
          tags: { include: { tag: true } },
          ruleChecks: true,
        },
      });

      expect(current.thesis).toBe("fresh edit before stale delete");
      expect(current.charts.map((chart) => chart.caption)).toEqual(["Chart should survive stale delete"]);
      expect(current.tags.map((row) => row.tag.name)).toEqual([originalTag]);
      expect(current.ruleChecks.map((row) => row.notes)).toEqual(["Keep checklist"]);
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: created.id } });
      await prisma.journalPlaybook.deleteMany({ where: { id: playbook.id } });
      await prisma.tag.deleteMany({ where: { name: originalTag } });
    }
  });

  dbIt("rejects stale playbook updates without deleting omitted rules", async () => {
    const playbookName = uniqueName("Journal CAS Playbook");
    const created = await createJournalPlaybook({
      name: playbookName,
      rules: [
        { text: "Rule one", sortOrder: 0 },
        { text: "Rule two", sortOrder: 1 },
      ],
    });

    try {
      await waitForTimestampTick();
      await updateJournalPlaybook(created.id, {
        description: "fresh edit",
        expectedUpdatedAt: created.updatedAt,
      });

      await expect(
        updateJournalPlaybook(created.id, {
          name: playbookName,
          rules: [{ id: created.rules[0].id, text: "Only one stale rule", sortOrder: 0 }],
          expectedUpdatedAt: created.updatedAt,
        }),
      ).rejects.toBeInstanceOf(JournalStaleWriteError);

      const currentRules = await prisma.journalPlaybookRule.findMany({
        where: { playbookId: created.id },
        orderBy: { sortOrder: "asc" },
      });

      expect(currentRules.map((rule) => rule.text)).toEqual(["Rule one", "Rule two"]);
    } finally {
      await prisma.journalPlaybook.deleteMany({ where: { id: created.id } });
    }
  });

  dbIt("rejects stale review updates without replacing actions", async () => {
    const created = await createJournalReview({
      period: "WEEKLY",
      startDate: "2026-01-05",
      endDate: "2026-01-11",
      summary: "Initial review",
      actions: [
        { label: "Keep action one" },
        { label: "Keep action two" },
      ],
    });

    try {
      await waitForTimestampTick();
      await updateJournalReview(created.id, {
        summary: "fresh edit",
        expectedUpdatedAt: created.updatedAt,
      });

      await expect(
        updateJournalReview(created.id, {
          summary: "stale edit",
          actions: [{ label: "Stale replacement" }],
          expectedUpdatedAt: created.updatedAt,
        }),
      ).rejects.toBeInstanceOf(JournalStaleWriteError);

      const currentActions = await prisma.journalReviewAction.findMany({
        where: { reviewId: created.id },
        orderBy: { createdAt: "asc" },
      });

      expect(currentActions.map((action) => action.label)).toEqual(["Keep action one", "Keep action two"]);
    } finally {
      await prisma.journalReview.deleteMany({ where: { id: created.id } });
    }
  });

  dbIt("rejects stale chart route updates without replacing persisted markers", async () => {
    const symbol = uniqueName("JSC").slice(0, 12).toUpperCase();
    const created = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
    });
    const chart = await prisma.journalChart.create({
      data: {
        journalEntryId: created.id,
        symbol,
        timeframe: "5min",
        purpose: "REVIEW",
        caption: "Original chart",
        markers: {
          create: {
            markerType: "IDEAL_ENTRY",
            time: new Date("2026-01-02T13:35:00.000Z"),
            price: 101.2,
            label: "original marker",
          },
        },
      },
      include: { markers: true },
    });

    try {
      const { PATCH } = await import("@/app/api/journal/[id]/charts/[chartId]/route");

      await waitForTimestampTick();
      const freshResponse = await PATCH(
        chartPatchRequest(created.id, chart.id, {
          caption: "Fresh chart caption",
          expectedUpdatedAt: chart.updatedAt.toISOString(),
        }),
        { params: Promise.resolve({ id: created.id, chartId: chart.id }) },
      );
      expect(freshResponse.status).toBe(200);

      await waitForTimestampTick();
      const staleResponse = await PATCH(
        chartPatchRequest(created.id, chart.id, {
          caption: "Stale chart caption",
          expectedUpdatedAt: chart.updatedAt.toISOString(),
          markers: [
            {
              markerType: "TARGET",
              time: "2026-01-02T15:00:00.000Z",
              price: 105.5,
              label: "stale replacement marker",
            },
          ],
        }),
        { params: Promise.resolve({ id: created.id, chartId: chart.id }) },
      );
      const staleBody = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(staleBody).toMatchObject({
        error: "Journal chart changed in another tab. Refresh before saving again.",
      });
      expect(typeof staleBody.currentUpdatedAt).toBe("string");

      const current = await prisma.journalChart.findUniqueOrThrow({
        where: { id: chart.id },
        include: { markers: true },
      });

      expect(current.caption).toBe("Fresh chart caption");
      expect(current.markers).toHaveLength(1);
      expect(current.markers[0].label).toBe("original marker");
      expect(current.markers[0].markerType).toBe("IDEAL_ENTRY");
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: created.id } });
    }
  });

  dbIt("rejects stale chart snapshot route updates without replacing persisted screenshot metadata", async () => {
    const symbol = uniqueName("JSS").slice(0, 12).toUpperCase();
    const created = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
    });
    const chart = await prisma.journalChart.create({
      data: {
        journalEntryId: created.id,
        symbol,
        timeframe: "5min",
        purpose: "REVIEW",
        caption: "Original chart",
        screenshotKey: "stored/original.png",
        screenshotUrl: "/stored/original.png",
        tradingViewLayoutJson: "{\"layout\":\"original\"}",
        width: 800,
        height: 450,
        mimeType: "image/png",
      },
    });

    try {
      const { POST } = await import("@/app/api/journal/[id]/charts/[chartId]/snapshot/route");
      storageMocks.storeJournalScreenshot.mockReset();
      storageMocks.storeJournalScreenshot
        .mockResolvedValueOnce({
          key: "stored/fresh.png",
          url: "/stored/fresh.png",
          width: 1280,
          height: 720,
          mimeType: "image/png",
        })
        .mockResolvedValueOnce({
          key: "stored/stale.png",
          url: "/stored/stale.png",
          width: 640,
          height: 360,
          mimeType: "image/png",
        });

      await waitForTimestampTick();
      const freshResponse = await POST(
        chartSnapshotRequest(created.id, chart.id, {
          screenshotDataUrl: "data:image/png;base64,AAAA",
          width: 1280,
          height: 720,
          tradingViewLayoutJson: "{\"layout\":\"fresh\"}",
          expectedUpdatedAt: chart.updatedAt.toISOString(),
        }),
        { params: Promise.resolve({ id: created.id, chartId: chart.id }) },
      );
      expect(freshResponse.status).toBe(200);

      await waitForTimestampTick();
      const staleResponse = await POST(
        chartSnapshotRequest(created.id, chart.id, {
          screenshotDataUrl: "data:image/png;base64,BBBB",
          width: 640,
          height: 360,
          tradingViewLayoutJson: "{\"layout\":\"stale\"}",
          expectedUpdatedAt: chart.updatedAt.toISOString(),
        }),
        { params: Promise.resolve({ id: created.id, chartId: chart.id }) },
      );
      const staleBody = await staleResponse.json();

      expect(staleResponse.status).toBe(409);
      expect(staleBody).toMatchObject({
        error: "Journal chart changed in another tab. Refresh before saving again.",
      });
      expect(storageMocks.storeJournalScreenshot).toHaveBeenCalledTimes(1);

      const current = await prisma.journalChart.findUniqueOrThrow({ where: { id: chart.id } });
      expect(current.screenshotKey).toBe("stored/fresh.png");
      expect(current.screenshotUrl).toBe("/stored/fresh.png");
      expect(current.width).toBe(1280);
      expect(current.height).toBe(720);
      expect(current.tradingViewLayoutJson).toBe("{\"layout\":\"fresh\"}");
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: created.id } });
    }
  });

  dbIt("rejects stale rule-check updates without replacing checklist rows", async () => {
    const symbol = uniqueName("JRC").slice(0, 12).toUpperCase();
    const playbook = await createJournalPlaybook({
      name: uniqueName("Rule Check CAS Playbook"),
      rules: [
        { text: "Only buy from a clear base", sortOrder: 0 },
        { text: "Protect the stop", sortOrder: 1 },
      ],
    });
    const created = await createJournalEntry({
      symbol,
      ideaDate: new Date("2026-01-02T00:00:00.000Z"),
      playbookId: playbook.id,
    });
    const firstRuleId = playbook.rules[0].id;
    const secondRuleId = playbook.rules[1].id;

    try {
      await waitForTimestampTick();
      const fresh = await syncJournalRuleChecks(
        created.id,
        [{ playbookRuleId: firstRuleId, status: "PASS", notes: "Fresh checklist note" }],
        { expectedUpdatedAt: created.updatedAt },
      );
      expect(new Date(fresh.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());

      await expect(
        syncJournalRuleChecks(
          created.id,
          [
            { playbookRuleId: firstRuleId, status: "FAIL", notes: "Stale checklist replacement" },
            { playbookRuleId: secondRuleId, status: "FAIL", notes: "Stale checklist creation" },
          ],
          { expectedUpdatedAt: created.updatedAt },
        ),
      ).rejects.toBeInstanceOf(JournalStaleWriteError);

      const current = await prisma.journalEntryRuleCheck.findUniqueOrThrow({
        where: {
          journalEntryId_playbookRuleId: {
            journalEntryId: created.id,
            playbookRuleId: firstRuleId,
          },
        },
      });
      const staleCreated = await prisma.journalEntryRuleCheck.findUnique({
        where: {
          journalEntryId_playbookRuleId: {
            journalEntryId: created.id,
            playbookRuleId: secondRuleId,
          },
        },
      });

      expect(current.status).toBe("PASS");
      expect(current.notes).toBe("Fresh checklist note");
      expect(staleCreated).toBeNull();
    } finally {
      await prisma.journalEntry.deleteMany({ where: { id: created.id } });
      await prisma.journalPlaybook.deleteMany({ where: { id: playbook.id } });
    }
  });
});
