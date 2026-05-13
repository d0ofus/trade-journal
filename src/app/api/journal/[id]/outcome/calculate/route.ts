import { NextRequest, NextResponse } from "next/server";
import { journalOutcomeCalculatePayloadSchema } from "@/lib/journal/schema";
import { calculateJournalOutcomeFromCandles } from "@/lib/journal/outcome";
import { prisma } from "@/lib/prisma";
import { getJournalEntry } from "@/lib/server/journal";
import { loadCandlesForSymbol, parseCandleTimeframe } from "@/lib/server/market-candles";

type Params = Promise<{ id: string }>;

function rangeForEntry(entry: { ideaDate: Date; reviewDueAt: Date | null; followThroughDays: number | null; timeframe: string }) {
  const fallbackDays = entry.followThroughDays ?? (entry.timeframe === "1W" ? 60 : entry.timeframe === "1D" ? 20 : 5);
  const end = entry.reviewDueAt ?? new Date(entry.ideaDate.getTime() + fallbackDays * 24 * 60 * 60 * 1000);
  return {
    from: Math.floor(entry.ideaDate.getTime() / 1000),
    to: Math.floor(Math.max(end.getTime(), Date.now()) / 1000),
  };
}

export async function POST(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json().catch(() => ({}));
  const parsed = journalOutcomeCalculatePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
  const loaded = await loadCandlesForSymbol({
    symbol: entry.symbol,
    timeframe: parseCandleTimeframe(entry.timeframe),
    range: rangeForEntry(entry),
    limit: 5000,
  });
  if (!loaded) {
    return NextResponse.json({ error: "No candle data found for outcome calculation." }, { status: 404 });
  }

  const calculation = calculateJournalOutcomeFromCandles(
    {
      symbol: entry.symbol,
      direction: entry.direction,
      timeframe: entry.timeframe,
      ideaDate: entry.ideaDate,
      plannedEntry: entry.plannedEntry,
      plannedStop: entry.plannedStop,
      plannedTarget1: entry.plannedTarget1,
      invalidationLevel: entry.invalidationLevel,
      expectedR: entry.expectedR,
      followThroughDays: entry.followThroughDays,
    },
    loaded.candles,
  );

  if (!parsed.data.apply || !calculation.outcomeStatus) {
    return NextResponse.json({ calculation });
  }

  await prisma.journalEntry.update({
    where: { id },
    data: {
      actualTriggerAt: calculation.actualTriggerAt ? new Date(calculation.actualTriggerAt) : null,
      mfeR: calculation.mfeR,
      maeR: calculation.maeR,
      bestExitR: calculation.bestExitR,
      outcomeStatus: calculation.outcomeStatus,
      outcomeCalculatedAt: new Date(),
      outcomeCalculationJson: JSON.stringify(calculation),
      outcomeNotes: calculation.reason,
    },
  });
  const updated = await getJournalEntry(id);
  return NextResponse.json({ calculation, entry: updated });
}
