import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { journalSnapshotPayloadSchema } from "@/lib/journal/schema";
import { JournalStaleWriteError } from "@/lib/server/journal";
import { storeJournalScreenshot } from "@/lib/server/journal-storage";
import { requireApiSession } from "@/lib/server/api-auth";

type Params = Promise<{ id: string; chartId: string }>;

export async function POST(req: NextRequest, props: { params: Params }) {
  const authError = await requireApiSession();
  if (authError) return authError;

  const { id, chartId } = await props.params;
  const body = await req.json();
  const parsed = journalSnapshotPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.expectedUpdatedAt) {
    return NextResponse.json({ error: "expectedUpdatedAt is required for chart snapshots." }, { status: 409 });
  }
  const expectedUpdatedAt = new Date(parsed.data.expectedUpdatedAt);

  const chart = await prisma.journalChart.findFirst({
    where: { id: chartId, journalEntryId: id },
    select: { id: true, updatedAt: true },
  });
  if (!chart) return NextResponse.json({ error: "Journal chart not found." }, { status: 404 });
  if (chart.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    return NextResponse.json(
      {
        error: "Journal chart changed in another tab. Refresh before saving again.",
        currentUpdatedAt: chart.updatedAt.toISOString(),
      },
      { status: 409 },
    );
  }

  const stored = await storeJournalScreenshot({
    journalEntryId: id,
    chartId,
    dataUrl: parsed.data.screenshotDataUrl,
    width: parsed.data.width,
    height: parsed.data.height,
  });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const updatedRows = await tx.journalChart.updateMany({
        where: { id: chartId, journalEntryId: id, updatedAt: expectedUpdatedAt },
        data: {
          screenshotKey: stored.key,
          screenshotUrl: stored.url,
          width: stored.width,
          height: stored.height,
          mimeType: stored.mimeType,
          tradingViewLayoutJson: parsed.data.tradingViewLayoutJson,
        },
      });
      if (updatedRows.count !== 1) {
        const current = await tx.journalChart.findFirst({
          where: { id: chartId, journalEntryId: id },
          select: { updatedAt: true },
        });
        throw new JournalStaleWriteError("Journal chart", current?.updatedAt ?? null);
      }

      return tx.journalChart.findUniqueOrThrow({
        where: { id: chartId },
        include: { markers: true },
      });
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
  } catch (error) {
    if (error instanceof JournalStaleWriteError) {
      return NextResponse.json(
        { error: error.message, currentUpdatedAt: error.currentUpdatedAt },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save chart snapshot." },
      { status: 500 },
    );
  }
}
