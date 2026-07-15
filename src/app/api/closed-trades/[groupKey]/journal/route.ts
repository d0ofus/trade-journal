import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";
import { ClosedTradeJournalBridgeError, createJournalEntryFromClosedTrade } from "@/lib/server/journal";

type Params = Promise<{ groupKey: string }>;

const journalBridgePayloadSchema = z.object({
  expectedReviewUpdatedAt: z.string().datetime().nullable(),
});

async function readJournalBridgePayload(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { provided: false as const };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }) };
  }

  const parsed = journalBridgePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return { response: NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }) };
  }

  return { provided: true as const, expectedReviewUpdatedAt: parsed.data.expectedReviewUpdatedAt };
}

export async function POST(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  const closedTrade = await prisma.closedTrade.findUnique({
    where: { groupKey: decodedGroupKey },
    select: {
      groupKey: true,
      isStale: true,
      account: { select: { ibkrAccount: true } },
    },
  });
  if (!closedTrade) {
    return NextResponse.json({ code: "CLOSED_TRADE_NOT_FOUND", error: "Closed trade not found." }, { status: 404 });
  }

  const demoWriteError = rejectE2eNonDemoClosedTrade(closedTrade.account.ibkrAccount);
  if (demoWriteError) return demoWriteError;
  const existingLink = await prisma.journalLink.findFirst({
    where: {
      linkType: "REVIEW_SOURCE",
      targetType: "CLOSED_TRADE",
      targetId: decodedGroupKey,
    },
    select: { journalEntryId: true },
    orderBy: { createdAt: "asc" },
  });
  if (closedTrade.isStale && !existingLink) {
    return NextResponse.json(
      { code: "STALE_CLOSED_TRADE", error: "Cannot create a journal review for a stale closed trade.", isStale: true },
      { status: 409 },
    );
  }

  const payload = await readJournalBridgePayload(req);
  if ("response" in payload) return payload.response;
  if (!existingLink && !payload.provided) {
    return NextResponse.json(
      {
        code: "CLOSED_TRADE_REVIEW_CHANGED",
        error: "Closed-trade review version is required. Reload before creating a journal review.",
      },
      { status: 409 },
    );
  }

  try {
    const result = await createJournalEntryFromClosedTrade(
      decodedGroupKey,
      payload.provided ? { expectedReviewUpdatedAt: payload.expectedReviewUpdatedAt } : {},
    );
    return NextResponse.json(
      { entry: result.entry, journalEntryId: result.entry.id, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ClosedTradeJournalBridgeError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.currentReviewUpdatedAt !== undefined ? { currentReviewUpdatedAt: error.currentReviewUpdatedAt } : {}),
        },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create journal review." }, { status: 500 });
  }
}
