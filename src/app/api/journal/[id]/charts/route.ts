import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journalChartPayloadSchema } from "@/lib/journal/schema";
import { mapChartPayloadToData } from "@/lib/server/journal";
import { storeJournalScreenshot } from "@/lib/server/journal-storage";

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
  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = journalChartPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { screenshotDataUrl, markers, ...rest } = parsed.data;
    await prisma.journalEntry.findUniqueOrThrow({ where: { id }, select: { id: true } });
    const data = mapChartPayloadToData(rest) as Record<string, unknown>;
    const chart = await prisma.journalChart.create({
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

    return NextResponse.json({ chart: serializeChart(updated) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save journal chart." }, { status: 500 });
  }
}
