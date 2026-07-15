import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { closedTradeChartLayoutPayloadSchema } from "@/lib/charts/closed-trade-chart-layout-schema";
import { prisma } from "@/lib/prisma";
import { lockClosedTradeForReview } from "@/lib/server/closed-trade-review-lock";
import { rejectE2eNonDemoClosedTrade } from "@/lib/server/e2e-demo-write-guard";

type Params = Promise<{ groupKey: string }>;

function parsePanels(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeLayout(layout: {
  id: string;
  closedTradeGroupKey: string;
  layoutMode: string;
  panelsJson: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  const parsed = closedTradeChartLayoutPayloadSchema.safeParse({
    layoutMode: layout.layoutMode,
    panels: parsePanels(layout.panelsJson),
    version: layout.version,
  });
  if (!parsed.success) return null;

  return {
    id: layout.id,
    groupKey: layout.closedTradeGroupKey,
    layoutMode: parsed.data.layoutMode,
    panels: parsed.data.panels,
    version: layout.version,
    createdAt: layout.createdAt.toISOString(),
    updatedAt: layout.updatedAt.toISOString(),
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function GET(_req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  const layout = await prisma.closedTradeChartLayout.findUnique({
    where: { closedTradeGroupKey: decodedGroupKey },
  });

  return NextResponse.json({ layout: layout ? serializeLayout(layout) : null });
}

export async function PUT(req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = closedTradeChartLayoutPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const closedTrade = await prisma.closedTrade.findUnique({
    where: { groupKey: decodedGroupKey },
    select: { groupKey: true, isStale: true, account: { select: { ibkrAccount: true } } },
  });
  if (!closedTrade) return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
  const demoWriteError = rejectE2eNonDemoClosedTrade(closedTrade.account.ibkrAccount);
  if (demoWriteError) return demoWriteError;
  if (closedTrade.isStale) return NextResponse.json({ error: "Cannot edit a stale closed trade." }, { status: 409 });

  const version = parsed.data.version;
  const existing = await prisma.closedTradeChartLayout.findUnique({
    where: { closedTradeGroupKey: decodedGroupKey },
    select: { version: true },
  });

  let result:
    | { stale: true }
    | { missing: true }
    | { conflict: true; currentVersion: number }
    | { conflict: false; layout: NonNullable<Awaited<ReturnType<typeof prisma.closedTradeChartLayout.findUnique>>> };

  if (existing) {
    if (!version) {
      return NextResponse.json({ error: "Layout version is required.", currentVersion: existing.version }, { status: 409 });
    }

    result = await prisma.$transaction(
      async (tx) => {
        const lockedClosedTrade = await lockClosedTradeForReview(tx, decodedGroupKey);
        if (!lockedClosedTrade) return { missing: true as const };
        if (lockedClosedTrade.isStale) return { stale: true as const };

        const claimed = await tx.closedTradeChartLayout.updateMany({
          where: { closedTradeGroupKey: decodedGroupKey, version },
          data: {
            layoutMode: parsed.data.layoutMode,
            panelsJson: JSON.stringify(parsed.data.panels),
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) {
          const current = await tx.closedTradeChartLayout.findUnique({
            where: { closedTradeGroupKey: decodedGroupKey },
            select: { version: true },
          });
          return { conflict: true as const, currentVersion: current?.version ?? existing.version };
        }

        return {
          conflict: false as const,
          layout: await tx.closedTradeChartLayout.findUniqueOrThrow({
            where: { closedTradeGroupKey: decodedGroupKey },
          }),
        };
      },
      { maxWait: 10000, timeout: 20000 },
    );

    if ("missing" in result) {
      return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
    }
    if ("stale" in result) {
      return NextResponse.json({ error: "Cannot edit a stale closed trade." }, { status: 409 });
    }
    if (result.conflict) {
      return NextResponse.json(
        { error: "Layout changed in another tab.", currentVersion: result.currentVersion },
        { status: 409 },
      );
    }
  } else {
    const expectedVersion = version ?? 1;
    if (expectedVersion !== 1) {
      return NextResponse.json({ error: "Layout changed in another tab.", currentVersion: 1 }, { status: 409 });
    }

    try {
      result = await prisma.$transaction(
        async (tx) => {
          const lockedClosedTrade = await lockClosedTradeForReview(tx, decodedGroupKey);
          if (!lockedClosedTrade) return { missing: true as const };
          if (lockedClosedTrade.isStale) return { stale: true as const };

          return {
            conflict: false as const,
            layout: await tx.closedTradeChartLayout.create({
              data: {
                closedTradeGroupKey: decodedGroupKey,
                layoutMode: parsed.data.layoutMode,
                panelsJson: JSON.stringify(parsed.data.panels),
                version: 2,
              },
            }),
          };
        },
        { maxWait: 10000, timeout: 20000 },
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const current = await prisma.closedTradeChartLayout.findUnique({
        where: { closedTradeGroupKey: decodedGroupKey },
        select: { version: true },
      });
      return NextResponse.json({ error: "Layout changed in another tab.", currentVersion: current?.version ?? 1 }, { status: 409 });
    }

    if ("missing" in result) {
      return NextResponse.json({ error: "Closed trade not found." }, { status: 404 });
    }
    if ("stale" in result) {
      return NextResponse.json({ error: "Cannot edit a stale closed trade." }, { status: 409 });
    }
  }

  return NextResponse.json({ layout: serializeLayout(result.layout) });
}
