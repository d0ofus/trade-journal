import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journalSnapshotPayloadSchema } from "@/lib/journal/schema";
import { storeJournalScreenshot } from "@/lib/server/journal-storage";

type Params = Promise<{ id: string; chartId: string }>;

export async function POST(req: NextRequest, props: { params: Params }) {
  const { id, chartId } = await props.params;
  const body = await req.json();
  const parsed = journalSnapshotPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const chart = await prisma.journalChart.findFirst({
    where: { id: chartId, journalEntryId: id },
    select: { id: true },
  });
  if (!chart) return NextResponse.json({ error: "Journal chart not found." }, { status: 404 });

  const stored = await storeJournalScreenshot({
    journalEntryId: id,
    chartId,
    dataUrl: parsed.data.screenshotDataUrl,
    width: parsed.data.width,
    height: parsed.data.height,
  });

  const updated = await prisma.journalChart.update({
    where: { id: chartId },
    data: {
      screenshotKey: stored.key,
      screenshotUrl: stored.url,
      width: stored.width,
      height: stored.height,
      mimeType: stored.mimeType,
      tradingViewLayoutJson: parsed.data.tradingViewLayoutJson,
    },
    include: { markers: true },
  });

  return NextResponse.json({
    chart: {
      ...updated,
      rangeStart: updated.rangeStart?.toISOString() ?? null,
      rangeEnd: updated.rangeEnd?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      markers: updated.markers.map((marker) => ({
        ...marker,
        time: marker.time?.toISOString() ?? null,
        createdAt: marker.createdAt.toISOString(),
      })),
    },
  });
}
