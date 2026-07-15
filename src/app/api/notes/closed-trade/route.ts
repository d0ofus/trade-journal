import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockClosedTradeForReview } from "@/lib/server/closed-trade-review-lock";
import { requireApiSession } from "@/lib/server/api-auth";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";

const closedNoteSchema = z.object({
  groupKey: z.string().min(1).max(240),
  content: z.string().max(20000),
  setup: z.string().max(10000).optional().default(""),
  thesis: z.string().max(10000).optional().default(""),
  entryReview: z.string().max(10000).optional().default(""),
  exitReview: z.string().max(10000).optional().default(""),
  mistake: z.string().max(10000).optional().default(""),
  lesson: z.string().max(10000).optional().default(""),
  followUp: z.string().max(10000).optional().default(""),
  tags: z.array(z.string().min(1).max(60)).max(30).optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    (error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002")
  );
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];
}

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = closedNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const closedTrade = await prisma.closedTrade.findUnique({
    where: { groupKey: parsed.data.groupKey },
    select: { groupKey: true, isStale: true, account: { select: { ibkrAccount: true } } },
  });
  if (!closedTrade) {
    return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
  }
  const demoWriteError = rejectE2eNonDemoClosedTrade(closedTrade.account.ibkrAccount);
  if (demoWriteError) return demoWriteError;
  if (closedTrade.isStale) {
    return NextResponse.json({ code: "STALE_CLOSED_TRADE", error: "Cannot edit a stale closed trade.", isStale: true }, { status: 409 });
  }

  const tags = parsed.data.tags ? normalizeTags(parsed.data.tags) : null;

  const expectedUpdatedAt = parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null;

  let result:
    | { stale: true }
    | { missing: true }
    | { conflict: true; currentUpdatedAt: Date | null }
    | { conflict: false; note: { updatedAt: Date }; tags: string[] | null };

  try {
    result = await prisma.$transaction(
      async (tx) => {
        const lockedClosedTrade = await lockClosedTradeForReview(tx, parsed.data.groupKey);
        if (!lockedClosedTrade) return { missing: true as const };
        if (lockedClosedTrade.isStale) return { stale: true as const };

        const existingNote = await tx.closedTradeNote.findUnique({
          where: { groupKey: parsed.data.groupKey },
          select: { updatedAt: true },
        });

        let note;
        if (existingNote) {
          if (!expectedUpdatedAt) {
            return {
              conflict: true as const,
              currentUpdatedAt: existingNote.updatedAt,
            };
          }

          const claimed = await tx.closedTradeNote.updateMany({
            where: { groupKey: parsed.data.groupKey, updatedAt: expectedUpdatedAt },
            data: {
              content: parsed.data.content,
              setup: parsed.data.setup,
              thesis: parsed.data.thesis,
              entryReview: parsed.data.entryReview,
              exitReview: parsed.data.exitReview,
              mistake: parsed.data.mistake,
              lesson: parsed.data.lesson,
              followUp: parsed.data.followUp,
            },
          });
          if (claimed.count === 0) {
            const current = await tx.closedTradeNote.findUnique({
              where: { groupKey: parsed.data.groupKey },
              select: { updatedAt: true },
            });
            return {
              conflict: true as const,
              currentUpdatedAt: current?.updatedAt ?? existingNote.updatedAt,
            };
          }
          note = await tx.closedTradeNote.findUniqueOrThrow({
            where: { groupKey: parsed.data.groupKey },
          });
        } else {
          if (expectedUpdatedAt) {
            return {
              conflict: true as const,
              currentUpdatedAt: null,
            };
          }

          note = await tx.closedTradeNote.create({
            data: {
              groupKey: parsed.data.groupKey,
              content: parsed.data.content,
              setup: parsed.data.setup,
              thesis: parsed.data.thesis,
              entryReview: parsed.data.entryReview,
              exitReview: parsed.data.exitReview,
              mistake: parsed.data.mistake,
              lesson: parsed.data.lesson,
              followUp: parsed.data.followUp,
            },
          });
        }

        if (tags) {
          await tx.closedTradeTag.deleteMany({ where: { closedTradeGroupKey: parsed.data.groupKey } });
          for (const tagName of tags) {
            const tag = await tx.tag.upsert({
              where: { name: tagName },
              update: {},
              create: { name: tagName },
            });
            await tx.closedTradeTag.create({
              data: {
                closedTradeGroupKey: parsed.data.groupKey,
                tagId: tag.id,
              },
            });
          }
        }

        return { conflict: false as const, note, tags };
      },
      { maxWait: 10000, timeout: 20000 },
    );
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const current = await prisma.closedTradeNote.findUnique({
      where: { groupKey: parsed.data.groupKey },
      select: { updatedAt: true },
    });
    return NextResponse.json(
      {
        code: "CLOSED_TRADE_REVIEW_CONFLICT",
        error: "Closed-trade review changed in another tab.",
        currentUpdatedAt: current?.updatedAt.toISOString() ?? null,
      },
      { status: 409 },
    );
  }

  if ("missing" in result) {
    return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
  }

  if ("stale" in result) {
    return NextResponse.json({ code: "STALE_CLOSED_TRADE", error: "Cannot edit a stale closed trade.", isStale: true }, { status: 409 });
  }

  if ("conflict" in result && result.conflict) {
    return NextResponse.json(
      {
        code: "CLOSED_TRADE_REVIEW_CONFLICT",
        error: "Closed-trade review changed in another tab.",
        currentUpdatedAt: result.currentUpdatedAt?.toISOString() ?? null,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    ...(result.tags ? { tags: result.tags } : {}),
    updatedAt: result.note.updatedAt.toISOString(),
  });
}
