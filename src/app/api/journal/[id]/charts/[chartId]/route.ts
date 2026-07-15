import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journalChartPatchSchema } from "@/lib/journal/schema";
import { JournalStaleWriteError, mapChartPayloadToData } from "@/lib/server/journal";
import { requireApiSession } from "@/lib/server/api-auth";

type Params = Promise<{ id: string; chartId: string }>;

function markerDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeChart(chart: {
  id: string;
  journalEntryId: string;
  symbol: string;
  timeframe: string;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  tradingViewLayoutJson: string | null;
  screenshotKey: string | null;
  screenshotUrl: string | null;
  caption: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
  purpose: string;
  compareSymbol: string | null;
  createdAt: Date;
  updatedAt: Date;
  markers: Array<{
    id: string;
    chartId: string;
    markerType: string;
    time: Date | null;
    price: number | null;
    label: string | null;
    metadataJson: string | null;
    createdAt: Date;
  }>;
}) {
  return {
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
  };
}

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id, chartId } = await props.params;
  const body = await req.json();
  const parsed = journalChartPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.expectedUpdatedAt) {
    return NextResponse.json({ error: "expectedUpdatedAt is required for chart updates." }, { status: 409 });
  }

  const rest = { ...parsed.data };
  const markers = rest.markers;
  const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt);
  delete rest.markers;
  delete rest.screenshotDataUrl;
  delete rest.expectedUpdatedAt;
  const data = mapChartPayloadToData(rest) as Record<string, unknown>;

  try {
    const chart = await prisma.$transaction(async (tx) => {
      const updateData = {
          symbol: data.symbol as string | undefined,
          timeframe: data.timeframe as string | undefined,
          purpose: data.purpose as "THESIS" | "TRIGGER" | "MARKET_CONTEXT" | "PEER_CONTEXT" | "FOLLOW_THROUGH" | "REVIEW" | "CUSTOM" | undefined,
          compareSymbol: data.compareSymbol as string | null | undefined,
          rangeStart: data.rangeStart as Date | null | undefined,
          rangeEnd: data.rangeEnd as Date | null | undefined,
          tradingViewLayoutJson: data.tradingViewLayoutJson as string | null | undefined,
          caption: data.caption as string | undefined,
          width: data.width as number | null | undefined,
          height: data.height as number | null | undefined,
          mimeType: data.mimeType as string | null | undefined,
        };

      const updated = await tx.journalChart.updateMany({
        where: { id: chartId, journalEntryId: id, updatedAt: expectedUpdatedAt },
        data: updateData,
      });
      if (updated.count !== 1) {
        const current = await tx.journalChart.findFirst({
          where: { id: chartId, journalEntryId: id },
          select: { updatedAt: true },
        });
        throw new JournalStaleWriteError("Journal chart", current?.updatedAt ?? null);
      }

      if (markers) {
        await tx.journalChartMarker.deleteMany({ where: { chartId } });
        if (markers.length > 0) {
          await tx.journalChartMarker.createMany({
            data: markers.map((marker) => ({
              chartId,
              markerType: marker.markerType,
              time: markerDate(marker.time),
              price: marker.price ?? null,
              label: marker.label ?? null,
              metadataJson: marker.metadataJson ?? null,
            })),
          });
        }
      }
      return tx.journalChart.findUniqueOrThrow({ where: { id: chartId }, include: { markers: true } });
    });

    return NextResponse.json({ chart: serializeChart(chart) });
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save journal chart." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id, chartId } = await props.params;
  const chart = await prisma.journalChart.findFirst({ where: { id: chartId, journalEntryId: id }, select: { id: true } });
  if (!chart) return NextResponse.json({ error: "Journal chart not found." }, { status: 404 });
  await prisma.journalChart.delete({ where: { id: chartId } });
  return NextResponse.json({ ok: true });
}
