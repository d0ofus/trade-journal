import {
  parseUtcDateOnly,
  utcAddMonths,
  utcDateKey,
  utcStartOfDay,
  utcStartOfYear,
} from "@/lib/server/utc-date-range";

export type DashboardPreset = "all" | "ytd" | "3m" | "6m" | "custom";

function parseDateParam(value: string | undefined) {
  if (!value) return undefined;

  try {
    return utcDateKey(parseUtcDateOnly(value));
  } catch {
    return undefined;
  }
}

export function resolveDashboardRange(
  searchParams: Record<string, string | string[] | undefined>,
  now = new Date(),
) {
  const today = utcStartOfDay(now);
  const todayIso = utcDateKey(today);
  const fromInput = parseDateParam(typeof searchParams.from === "string" ? searchParams.from : undefined);
  const toInput = parseDateParam(typeof searchParams.to === "string" ? searchParams.to : undefined);
  const presetInput = typeof searchParams.preset === "string" ? searchParams.preset : undefined;

  let preset: DashboardPreset = "all";
  if (presetInput === "ytd" || presetInput === "3m" || presetInput === "6m" || presetInput === "custom" || presetInput === "all") {
    preset = presetInput;
  } else if (fromInput || toInput) {
    preset = "custom";
  }

  if (preset === "ytd") {
    return {
      preset,
      from: utcDateKey(utcStartOfYear(today)),
      to: todayIso,
      label: "Year-To-Date",
    };
  }
  if (preset === "3m") {
    return {
      preset,
      from: utcDateKey(utcAddMonths(today, -3)),
      to: todayIso,
      label: "Past 3 Months",
    };
  }
  if (preset === "6m") {
    return {
      preset,
      from: utcDateKey(utcAddMonths(today, -6)),
      to: todayIso,
      label: "Past 6 Months",
    };
  }
  if (preset === "custom") {
    return {
      preset,
      from: fromInput,
      to: toInput,
      label: "Custom Range",
    };
  }
  return {
    preset: "all" as const,
    from: undefined,
    to: undefined,
    label: "All Time",
  };
}
