import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journalChartCreateSchema } from "@/lib/journal/schema";
import { claimJournalEntryVersion, JournalStaleWriteError, mapChartPayloadToData } from "@/lib/server/journal";
import { storeJournalScreenshot } from "@/lib/server/journal-storage";
import { requireApiSession } from "@/lib/server/api-auth";

type Params = Promise<{ id: string }>;
type ChartWithMarkers = Awaited<ReturnType<typeof prisma.journalChart.findFirstOrThrow>> & {
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
};

function markerDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeChart(chart: ChartWithMarkers) {
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

export async function POST(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = journalChartCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    if (!parsed.data.expectedUpdatedAt) {
      return NextResponse.json({ error: "expectedUpdatedAt is required for journal chart uploads." }, { status: 409 });
    }

    const { screenshotDataUrl, markers, expectedUpdatedAt, ...rest } = parsed.data;
    const data = mapChartPayloadToData(rest) as Record<string, unknown>;
    const { chart, entryUpdatedAt } = await prisma.$transaction(async (tx) => {
      const nextEntryUpdatedAt = await claimJournalEntryVersion(tx, id, { expectedUpdatedAt });

      const created = await tx.journalChart.create({
        data: {
          journalEntryId: id,
          symbol: data.symbol as string,
          timeframe: data.timeframe as string,
          purpose: data.purpose as "THESIS" | "TRIGGER" | "MARKET_CONTEXT" | "PEER_CONTEXT" | "FOLLOW_THROUGH" | "REVIEW" | "CUSTOM",
          compareSymbol: data.compareSymbol as string | null | undefined,
          rangeStart: data.rangeStart as Date | null | undefined,
          rangeEnd: data.rangeEnd as Date | null | undefined,
          tradingViewLayoutJson: data.tradingViewLayoutJson as string | null | undefined,
          caption: data.caption as string,
          width: data.width as number | null | undefined,
          height: data.height as number | null | undefined,
          mimeType: data.mimeType as string | null | undefined,
          markers: {
            create: markers.map((marker) => ({
              markerType: marker.markerType,
              time: markerDate(marker.time),
              price: marker.price ?? null,
              label: marker.label ?? null,
              metadataJson: marker.metadataJson ?? null,
            })),
          },
        },
        include: { markers: true },
      });

      return { chart: created, entryUpdatedAt: nextEntryUpdatedAt };
    });

    let updated = chart;
    if (screenshotDataUrl) {
      const stored = await storeJournalScreenshot({
        journalEntryId: id,
        chartId: chart.id,
        dataUrl: screenshotDataUrl,
        width: chart.width,
        height: chart.height,
      });
      updated = await prisma.journalChart.update({
        where: { id: chart.id },
        data: {
          screenshotKey: stored.key,
          screenshotUrl: stored.url,
          mimeType: stored.mimeType,
          width: stored.width,
          height: stored.height,
        },
        include: { markers: true },
      });
    }

    return NextResponse.json({ chart: serializeChart(updated), entryUpdatedAt: entryUpdatedAt.toISOString() }, { status: 201 });
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
