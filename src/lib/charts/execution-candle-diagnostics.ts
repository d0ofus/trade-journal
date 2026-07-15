import {
  alignExecutionToBarTime,
  inferBarIntervalSeconds,
  inferExecutionOffsetSeconds,
  priceDistanceFromCandle,
  type AlignmentCandle,
  type ExecutionAlignmentInput,
} from "@/lib/charts/execution-marker-alignment";

export type ExecutionCandleDiagnosticInput = ExecutionAlignmentInput & {
  id?: string;
};

export type ExecutionCandleDiagnostic = {
  execution: ExecutionCandleDiagnosticInput;
  candle: AlignmentCandle | null;
  alignedTime: number | null;
  distance: number;
};

export type ExecutionCandleDiagnostics = {
  offsetSeconds: number;
  checkedCount: number;
  outsideCount: number;
  missingCount: number;
  outside: ExecutionCandleDiagnostic[];
  missing: ExecutionCandleDiagnostic[];
};

export function getExecutionCandleDiagnostics(
  executions: ExecutionCandleDiagnosticInput[],
  candles: AlignmentCandle[],
): ExecutionCandleDiagnostics {
  if (executions.length === 0 || candles.length === 0) {
    return {
      offsetSeconds: 0,
      checkedCount: 0,
      outsideCount: 0,
      missingCount: executions.length,
      outside: [],
      missing: executions.map((execution) => ({ execution, candle: null, alignedTime: null, distance: 0 })),
    };
  }

  const intervalSeconds = inferBarIntervalSeconds(candles);
  const offsetSeconds = inferExecutionOffsetSeconds(executions, candles, intervalSeconds);
  const candleByTime = new Map(candles.map((candle) => [candle.time, candle]));
  const outside: ExecutionCandleDiagnostic[] = [];
  const missing: ExecutionCandleDiagnostic[] = [];
  let checkedCount = 0;

  for (const execution of executions) {
    const alignedTime = alignExecutionToBarTime(execution.executedAt, candles, offsetSeconds, intervalSeconds);
    const candle = alignedTime === null ? null : (candleByTime.get(alignedTime) ?? null);
    if (!candle) {
      missing.push({ execution, candle: null, alignedTime, distance: 0 });
      continue;
    }

    checkedCount += 1;
    const distance = priceDistanceFromCandle(execution.price, candle);
    if (distance > 0) {
      outside.push({ execution, candle, alignedTime, distance });
    }
  }

  return {
    offsetSeconds,
    checkedCount,
    outsideCount: outside.length,
    missingCount: missing.length,
    outside,
    missing,
  };
}

export function formatExecutionCandleDiagnosticWarning(diagnostics: ExecutionCandleDiagnostics) {
  const parts: string[] = [];
  if (diagnostics.outsideCount > 0) {
    parts.push(
      `${diagnostics.outsideCount} fill${diagnostics.outsideCount === 1 ? "" : "s"} outside execution candle`,
    );
  }
  if (diagnostics.missingCount > 0) {
    parts.push(`${diagnostics.missingCount} fill${diagnostics.missingCount === 1 ? " has" : "s have"} no matching candle`);
  }
  return parts.length > 0 ? `${parts.join("; ")}.` : "";
}
