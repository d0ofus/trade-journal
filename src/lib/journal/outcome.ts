import type { Candle } from "@/lib/server/market-candles";

type OutcomeEntry = {
  symbol: string;
  direction: "LONG" | "SHORT";
  timeframe: string;
  ideaDate: string | Date;
  plannedEntry?: number | null;
  plannedStop?: number | null;
  plannedTarget1?: number | null;
  invalidationLevel?: number | null;
  expectedR?: number | null;
  followThroughDays?: number | null;
};

export type JournalOutcomeCalculation = {
  status: "INSUFFICIENT_PLAN" | "NEVER_TRIGGERED" | "WORKED_WITHOUT_ME" | "FAILED" | "TRIGGERED" | "STILL_DEVELOPING";
  outcomeStatus?: "NEVER_TRIGGERED" | "WORKED_WITHOUT_ME" | "FAILED" | "TRIGGERED" | "STILL_DEVELOPING";
  actualTriggerAt: string | null;
  mfeR: number | null;
  maeR: number | null;
  bestExitR: number | null;
  riskUnit: number | null;
  triggerPrice: number | null;
  triggerCandleTime: number | null;
  successThresholdR: number | null;
  candleCount: number;
  reason: string;
};

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function defaultFollowThroughDays(timeframe: string) {
  if (timeframe === "1W") return 60;
  if (timeframe === "1D") return 20;
  return 5;
}

function isoFromUnix(time: number) {
  return new Date(time * 1000).toISOString();
}

function roundR(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function calculateJournalOutcomeFromCandles(
  entry: OutcomeEntry,
  candles: Candle[],
  now = new Date(),
): JournalOutcomeCalculation {
  const plannedEntry = entry.plannedEntry;
  const plannedStop = entry.plannedStop;
  if (typeof plannedEntry !== "number" || typeof plannedStop !== "number" || plannedEntry === plannedStop) {
    return {
      status: "INSUFFICIENT_PLAN",
      actualTriggerAt: null,
      mfeR: null,
      maeR: null,
      bestExitR: null,
      riskUnit: null,
      triggerPrice: null,
      triggerCandleTime: null,
      successThresholdR: null,
      candleCount: candles.length,
      reason: "Planned entry and stop are required before automated outcome calculation.",
    };
  }

  const riskUnit = Math.abs(plannedEntry - plannedStop);
  const ideaDate = toDate(entry.ideaDate);
  const followDays = entry.followThroughDays ?? defaultFollowThroughDays(entry.timeframe);
  const windowEnd = new Date(ideaDate.getTime() + followDays * 24 * 60 * 60 * 1000);
  const relevantCandles = candles
    .filter((candle) => candle.time * 1000 >= ideaDate.getTime())
    .filter((candle) => candle.time * 1000 <= windowEnd.getTime());

  const triggerIndex = relevantCandles.findIndex((candle) =>
    entry.direction === "LONG" ? candle.high >= plannedEntry : candle.low <= plannedEntry,
  );

  if (triggerIndex < 0) {
    const stillDeveloping = now.getTime() < windowEnd.getTime();
    return {
      status: stillDeveloping ? "STILL_DEVELOPING" : "NEVER_TRIGGERED",
      outcomeStatus: stillDeveloping ? "STILL_DEVELOPING" : "NEVER_TRIGGERED",
      actualTriggerAt: null,
      mfeR: null,
      maeR: null,
      bestExitR: null,
      riskUnit,
      triggerPrice: plannedEntry,
      triggerCandleTime: null,
      successThresholdR: null,
      candleCount: relevantCandles.length,
      reason: stillDeveloping ? "No trigger yet inside the active follow-through window." : "No trigger occurred inside the follow-through window.",
    };
  }

  const afterTrigger = relevantCandles.slice(triggerIndex);
  let maxFavorableR = Number.NEGATIVE_INFINITY;
  let maxAdverseR = 0;
  let resolvedStatus: JournalOutcomeCalculation["outcomeStatus"] = "TRIGGERED";
  const targetR =
    typeof entry.plannedTarget1 === "number"
      ? entry.direction === "LONG"
        ? (entry.plannedTarget1 - plannedEntry) / riskUnit
        : (plannedEntry - entry.plannedTarget1) / riskUnit
      : null;
  const successThresholdR = Math.max(0.01, entry.expectedR ?? targetR ?? 1);

  for (const candle of afterTrigger) {
    const favorableR =
      entry.direction === "LONG"
        ? (candle.high - plannedEntry) / riskUnit
        : (plannedEntry - candle.low) / riskUnit;
    const adverseR =
      entry.direction === "LONG"
        ? (plannedEntry - candle.low) / riskUnit
        : (candle.high - plannedEntry) / riskUnit;
    maxFavorableR = Math.max(maxFavorableR, favorableR);
    maxAdverseR = Math.max(maxAdverseR, adverseR);

    const stopLevel = entry.invalidationLevel ?? plannedStop;
    const stopHit = entry.direction === "LONG" ? candle.low <= stopLevel : candle.high >= stopLevel;
    const targetHit = favorableR >= successThresholdR;
    if (stopHit && resolvedStatus === "TRIGGERED") {
      resolvedStatus = "FAILED";
      break;
    }
    if (targetHit && resolvedStatus === "TRIGGERED") {
      resolvedStatus = "WORKED_WITHOUT_ME";
      break;
    }
  }

  if (resolvedStatus === "TRIGGERED" && now.getTime() < windowEnd.getTime()) {
    resolvedStatus = "STILL_DEVELOPING";
  }

  const triggerCandle = relevantCandles[triggerIndex];
  const mfeR = Number.isFinite(maxFavorableR) ? roundR(Math.max(0, maxFavorableR)) : null;
  const maeR = roundR(-Math.max(0, maxAdverseR));
  return {
    status: resolvedStatus,
    outcomeStatus: resolvedStatus,
    actualTriggerAt: isoFromUnix(triggerCandle.time),
    mfeR,
    maeR,
    bestExitR: mfeR,
    riskUnit,
    triggerPrice: plannedEntry,
    triggerCandleTime: triggerCandle.time,
    successThresholdR: roundR(successThresholdR),
    candleCount: relevantCandles.length,
    reason: `Calculated from ${afterTrigger.length} follow-through candle${afterTrigger.length === 1 ? "" : "s"}.`,
  };
}
