import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ groupKey: string }>;

const panelSchema = z.object({
  id: z.string().min(1).max(80),
  symbol: z.string().min(1).max(20).transform((value) => value.trim().toUpperCase()),
  timeframe: z.string().min(1).max(12),
  compareSymbol: z.string().max(20).nullable().optional(),
  rangePreset: z.string().max(40).optional(),
  visibleFrom: z.number().finite().nullable().optional(),
  visibleTo: z.number().finite().nullable().optional(),
});

const layoutSchema = z.object({
  layoutMode: z.enum(["single", "two-vertical", "two-horizontal", "three-vertical", "three-horizontal", "one-plus-two"]),
  panels: z.array(panelSchema).min(1).max(3),
});

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
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: layout.id,
    groupKey: layout.closedTradeGroupKey,
    layoutMode: layout.layoutMode,
    panels: parsePanels(layout.panelsJson),
    createdAt: layout.createdAt.toISOString(),
    updatedAt: layout.updatedAt.toISOString(),
  };
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
  const body = await req.json();
  const parsed = layoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.closedTrade.findUniqueOrThrow({
    where: { groupKey: decodedGroupKey },
    select: { groupKey: true },
  });

  const layout = await prisma.closedTradeChartLayout.upsert({
    where: { closedTradeGroupKey: decodedGroupKey },
    update: {
      layoutMode: parsed.data.layoutMode,
      panelsJson: JSON.stringify(parsed.data.panels),
    },
    create: {
      closedTradeGroupKey: decodedGroupKey,
      layoutMode: parsed.data.layoutMode,
      panelsJson: JSON.stringify(parsed.data.panels),
    },
  });

  return NextResponse.json({ layout: serializeLayout(layout) });
}
