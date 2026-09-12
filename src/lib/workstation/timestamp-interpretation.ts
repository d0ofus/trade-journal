/** Wall-clock interpretation only; never called by ingestion or accounting. */
export const TIME_INTERPRETATION_VERSION = 1;
export type TimeInterpretationStatus = "converted" | "explicit" | "ambiguous" | "invalid" | "unsupported";
export type InterpretedTimestamp = { status: TimeInterpretationStatus; utc: number | null; stored: number | null; raw: string };
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(time: number, zone: string): number[] {
  let f = formatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); formatters.set(zone, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(time * 1000)).map(p => [p.type, p.value]));
  return ["year", "month", "day", "hour", "minute", "second"].map(k => Number(p[k]));
}
const epoch = (p: number[]) => Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) / 1000;
export function interpretBrokerTimestamp(rawInput: string, timezone = "America/New_York"): InterpretedTimestamp {
  const raw = rawInput.trim(), fail = (status: TimeInterpretationStatus): InterpretedTimestamp => ({ status, utc: null, stored: null, raw });
  if (!["America/New_York", "UTC"].includes(timezone)) return fail("unsupported");
  const compact = /^(\d{4})(\d{2})(\d{2});(\d{2})(\d{2})(\d{2})$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
  if (!compact && !iso) return fail("unsupported");
  const p = (compact ?? iso)!.slice(1, 7).map(Number), wall = epoch(p);
  if (p[0] < 1900 || p[0] > 2200 || parts(wall, "UTC").some((v, i) => v !== p[i])) return fail("invalid");
  if (iso?.[7]) {
    const utc = Date.parse(raw.replace(" ", "T")) / 1000;
    return Number.isFinite(utc) ? { status: "explicit", raw, utc, stored: utc } : fail("invalid");
  }
  // Examine possible offsets, then round-trip. Zero matches = DST gap; two = DST fold.
  // Never select a candidate using prices or the machine's local timezone.
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h += 6) { const t = wall + h * 3600; offsets.add(epoch(parts(t, timezone)) - t); }
  const candidates = [...offsets].map(offset => wall - offset).filter(t => parts(t, timezone).every((v, i) => v === p[i]));
  return { raw, stored: wall, utc: candidates.length === 1 ? candidates[0] : null, status: candidates.length === 1 ? "converted" : candidates.length ? "ambiguous" : "invalid" };
}
export function brokerTimeLabel(time: number, zone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(time * 1000));
}
