import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ groupKey: string }>;

const pointSchema = z.object({
  time: z.number().finite(),
  price: z.number().finite(),
});

const annotationSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  panelId: z.string().max(80).nullable().optional(),
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  timeframe: z.string().max(12).nullable().optional(),
  scope: z.enum(["TRADE", "SYMBOL", "GLOBAL_SYMBOL"]).optional().default("TRADE"),
  type: z.string().min(1).max(40),
  points: z.array(pointSchema).max(4).optional().default([]),
  price: z.number().finite().nullable().optional(),
  text: z.string().max(500).nullable().optional(),
  style: z.record(z.string(), z.unknown()).optional().default({}),
});

const annotationsPayloadSchema = z.object({
  annotations: z.array(annotationSchema).max(500),
});

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeAnnotation(annotation: {
  id: string;
  closedTradeGroupKey: string;
  panelId: string | null;
  symbol: string;
  timeframe: string | null;
  scope: string;
  type: string;
  pointsJson: string;
  price: number | null;
  text: string | null;
  styleJson: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: annotation.id,
    groupKey: annotation.closedTradeGroupKey,
    panelId: annotation.panelId,
    symbol: annotation.symbol,
    timeframe: annotation.timeframe,
    scope: annotation.scope,
    type: annotation.type,
    points: parseJson(annotation.pointsJson, []),
    price: annotation.price,
    text: annotation.text,
    style: parseJson(annotation.styleJson, {}),
    createdAt: annotation.createdAt.toISOString(),
    updatedAt: annotation.updatedAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  const annotations = await prisma.closedTradeAnnotation.findMany({
    where: { closedTradeGroupKey: decodedGroupKey },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ annotations: annotations.map(serializeAnnotation) });
}

export async function PUT(req: NextRequest, props: { params: Params }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { groupKey } = await props.params;
  const decodedGroupKey = decodeURIComponent(groupKey);
  const body = await req.json();
  const parsed = annotationsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.closedTrade.findUniqueOrThrow({
    where: { groupKey: decodedGroupKey },
    select: { groupKey: true },
  });

  const annotations = await prisma.$transaction(async (tx) => {
    await tx.closedTradeAnnotation.deleteMany({
      where: { closedTradeGroupKey: decodedGroupKey },
    });

    if (parsed.data.annotations.length > 0) {
      await tx.closedTradeAnnotation.createMany({
        data: parsed.data.annotations.map((annotation) => ({
          id: annotation.id,
          closedTradeGroupKey: decodedGroupKey,
          panelId: annotation.panelId ?? null,
          symbol: annotation.symbol,
          timeframe: annotation.timeframe ?? null,
          scope: annotation.scope,
          type: annotation.type,
          pointsJson: JSON.stringify(annotation.points),
          price: annotation.price ?? null,
          text: annotation.text ?? null,
          styleJson: JSON.stringify(annotation.style),
        })),
      });
    }

    return tx.closedTradeAnnotation.findMany({
      where: { closedTradeGroupKey: decodedGroupKey },
      orderBy: { createdAt: "asc" },
    });
  });

  return NextResponse.json({ annotations: annotations.map(serializeAnnotation) });
}
