import { NextResponse } from "next/server";
import { calculateJournalOutcomeFromCandles } from "@/lib/journal/outcome";
import { prisma } from "@/lib/prisma";
import { loadCandlesForSymbol, parseCandleTimeframe } from "@/lib/server/market-candles";

function rangeForEntry(entry: { ideaDate: Date; reviewDueAt: Date | null; followThroughDays: number | null; timeframe: string }) {
  const fallbackDays = entry.followThroughDays ?? (entry.timeframe === "1W" ? 60 : entry.timeframe === "1D" ? 20 : 5);
  const end = entry.reviewDueAt ?? new Date(entry.ideaDate.getTime() + fallbackDays * 24 * 60 * 60 * 1000);
  return {
    from: Math.floor(entry.ideaDate.getTime() / 1000),
    to: Math.floor(Math.max(end.getTime(), Date.now()) / 1000),
  };
}

export async function POST() {
  const entries = await prisma.journalEntry.findMany({
    where: { outcomeStatus: { in: ["UNREVIEWED", "STILL_DEVELOPING", "TRIGGERED"] } },
    take: 100,
    orderBy: [{ reviewDueAt: "asc" }, { ideaDate: "desc" }],
  });

  const results = [];
  for (const entry of entries) {
    const loaded = await loadCandlesForSymbol({
      symbol: entry.symbol,
      timeframe: parseCandleTimeframe(entry.timeframe),
      range: rangeForEntry(entry),
      limit: 5000,
    });
    if (!loaded) {
      results.push({ id: entry.id, symbol: entry.symbol, ok: false, error: "No candle data found." });
      continue;
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
    if (!calculation.outcomeStatus) {
      results.push({ id: entry.id, symbol: entry.symbol, ok: false, calculation });
      continue;
    }
    await prisma.journalEntry.update({
      where: { id: entry.id },
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
    results.push({ id: entry.id, symbol: entry.symbol, ok: true, outcomeStatus: calculation.outcomeStatus });
  }

  return NextResponse.json({ processed: results.length, results });
}
