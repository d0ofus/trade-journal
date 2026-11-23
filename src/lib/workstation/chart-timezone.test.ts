import { describe, expect, it } from "vitest";
import { chartTimeFormatters, chartTimestamp, parseTimezoneInput, resolveChartTimezone, restoreChartTimezone, timezoneCapture, timezoneInputValue } from "./chart-timezone";
import type { CandleSession } from "./types";
import { defaultPreferences, emptyDocument } from "./types";
import { restoreChartDisplay } from "./chart-preferences";
import { workstationDocumentSchema } from "./schema";
import { tradeViewSchema, viewPreferences } from "./trade-view";

const at = (s: string) => Date.parse(s) / 1000;
const session: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "regular" };
const ny = resolveChartTimezone("exchange", session), utc = resolveChartTimezone("utc"), syd = resolveChartTimezone("system", undefined, "Australia/Sydney");
describe("isolated chart timezone presentation", () => {
  it("defaults to exchange and falls back explicitly without verified metadata", () => {
    for (const value of [undefined, null, "bad", {}, 1, "exchange"]) expect(restoreChartTimezone(value)).toBe("exchange");
    expect(restoreChartTimezone("system")).toBe("system"); expect(restoreChartTimezone("utc")).toBe("utc");
    expect(ny.zone).toBe("America/New_York"); expect(ny.fallback).toBe(false);
    for (const metadata of [undefined, { ...session, calendar: "utc" as const }, { ...session, timezone: "not/a-zone" }]) {
      expect(resolveChartTimezone("exchange", metadata)).toMatchObject({ zone: "UTC", fallback: true });
      expect(resolveChartTimezone("exchange", metadata).label).toContain("unavailable");
    }
    expect(resolveChartTimezone("system").fallback).toBe(true);
  });
  it("formats historical New York and Sydney daylight saving offsets", () => {
    expect(timezoneInputValue(at("2026-01-07T14:30:00Z"), ny)).toBe("2026-01-07T09:30:00");
    expect(timezoneInputValue(at("2026-07-07T13:30:00Z"), ny)).toBe("2026-07-07T09:30:00");
    expect(chartTimestamp(at("2026-01-07T14:30:00Z"), ny)).toContain("GMT-5");
    expect(chartTimestamp(at("2026-07-07T13:30:00Z"), ny)).toContain("GMT-4");
    expect(timezoneInputValue(at("2026-01-01T20:30:00Z"), syd)).toBe("2026-01-02T07:30:00");
    expect(timezoneInputValue(at("2026-07-01T20:30:00Z"), syd)).toBe("2026-07-02T06:30:00");
    expect(timezoneInputValue(at("2025-12-31T23:59:00Z"), syd)).toBe("2026-01-01T10:59:00");
  });
  it("round-trips real instants in all zones, including fractional-hour offsets", () => {
    for (const zone of [utc, ny, syd, resolveChartTimezone("system", undefined, "Asia/Kathmandu"), resolveChartTimezone("system", undefined, "Australia/Lord_Howe")]) for (const value of ["2026-01-07T14:30:17Z", "2026-07-07T13:30:31Z"]) {
      const time = at(value); expect(parseTimezoneInput(timezoneInputValue(time, zone), zone)).toEqual({ time });
    }
    expect(parseTimezoneInput("2026-07-07T09:30", ny)).toEqual({ time: at("2026-07-07T13:30:00Z") });
  });
  it("rejects DST gaps and repeated times without guessing an offset", () => {
    expect(parseTimezoneInput("2026-03-08T02:30:00", ny).error).toContain("does not exist");
    expect(parseTimezoneInput("2026-11-01T01:30:00", ny).error).toContain("occurs twice");
    expect(parseTimezoneInput("2026-10-04T02:30:00", syd).error).toContain("does not exist");
    expect(parseTimezoneInput("2026-04-05T02:30:00", syd).error).toContain("occurs twice");
    expect(parseTimezoneInput("2026-11-01T01:30:00", utc).time).toBe(at("2026-11-01T01:30:00Z"));
    for (const value of ["", "2026-02-30T12:00", "2026-01-07T24:30", "bad", "2026-01-01T00:00Z"]) expect(parseTimezoneInput(value, ny).error).toBeTruthy();
  });
  it("formats intraday native axes and crosshairs without changing timestamps", () => {
    const time = at("2026-09-10T13:30:00Z"), f = chartTimeFormatters(ny, "5m", session);
    expect(f.timeScale.tickMarkFormatter(time as never, 3)).toBe("09:30");
    expect(f.localization.timeFormatter(time as never)).toBe("2026-09-10 09:30:00");
    expect(time).toBe(at("2026-09-10T13:30:00Z"));
  });
  it.each([
    [ny, "2026-01-07T14:30:17Z", "2026-01-07 09:30:17"],
    [ny, "2026-07-07T13:30:31Z", "2026-07-07 09:30:31"],
    [utc, "2026-01-07T14:30:17Z", "2026-01-07 14:30:17"],
    [utc, "2026-07-07T13:30:31Z", "2026-07-07 13:30:31"],
    [syd, "2026-01-01T20:30:17Z", "2026-01-02 07:30:17"],
    [syd, "2026-07-01T20:30:31Z", "2026-07-02 06:30:31"],
  ])("shows only the selected local date and time in %j at %s", (zone, value, expected) => {
    for (const interval of ["5m", "10m", "15m", "1h"] as const) {
      expect(chartTimeFormatters(zone, interval, session).localization.timeFormatter(at(value) as never)).toBe(expected);
    }
  });
  it("preserves daily/weekly exchange dates and UTC date-only provider conventions", () => {
    for (const zone of [ny, syd, utc]) for (const interval of ["1d", "1wk"] as const) {
      expect(chartTimeFormatters(zone, interval, session).localization.timeFormatter(at("2026-09-10T04:00:00Z") as never)).toBe("2026-09-10");
      expect(chartTimeFormatters(zone, interval, { ...session, timezone: "UTC", calendar: "utc" }).localization.timeFormatter(at("2026-09-10T00:00:00Z") as never)).toBe("2026-09-10");
      expect(chartTimeFormatters(zone, interval).localization.timeFormatter({ year: 2026, month: 9, day: 10 })).toBe("2026-09-10");
      expect(chartTimeFormatters(zone, interval).localization.timeFormatter("2026-09-10")).toBe("2026-09-10");
    }
  });
  it("records resolved zones and explicit fallbacks at capture time", () => {
    expect(timezoneCapture({ "chart-1": ny, "chart-2": resolveChartTimezone("exchange") })).toEqual({ mode: "exchange", zones: { "chart-1": "America/New_York", "chart-2": "UTC" }, fallbacks: ["chart-2"] });
    const capture = timezoneCapture({ NVDA: syd }); expect(capture.zones.NVDA).toBe("Australia/Sydney");
    expect(timezoneCapture({ "chart-1": utc })).toEqual({ mode: "utc", zones: { "chart-1": "UTC" } });
  });
  it("retains timezone preferences independently of saved trade views", () => {
    expect(defaultPreferences().chartTimezone).toBe("exchange");
    for (const mode of ["exchange", "system", "utc"] as const) {
      const preferences = { ...defaultPreferences(), chartTimezone: mode };
      expect(restoreChartDisplay(JSON.parse(JSON.stringify(preferences))).chartTimezone).toBe(mode);
      const view = tradeViewSchema.parse({ version: 1, arrangement: "left", panels: [{ id: "chart-1", interval: "5m", session: "regular", range: { from: 1, to: 2 } }] });
      expect({ ...preferences, ...viewPreferences(view) }.chartTimezone).toBe(mode);
    }
    expect(restoreChartDisplay({ chartTimezone: "bad" as never }).chartTimezone).toBe("exchange");
  });
  it("round-trips optional capture metadata through document validation and portable JSON", () => {
    const doc = emptyDocument(), metadata = timezoneCapture({ "chart-1": syd });
    const legacy = { id: "image", name: "Legacy", image: "data:image/png;base64,aGVsbG8=", time: 1, revision: 0, timeframe: "5m" };
    doc.evidence = [legacy, { ...legacy, id: "new", chartTimezone: metadata }, { ...legacy, id: "peers", chartTimezone: metadata, peerCapture: { chartTimezone: metadata, source: "peer-comparison", symbols: ["NVDA"], groupId: "g", groupName: "Group", interval: "5m", session: "regular", adjustment: "split", ranges: { NVDA: { from: 1, to: 2 } }, capturedAt: "2026-09-10T14:00:00.000Z", beforeEntry: false, entryTime: 1 } }];
    const roundtrip = workstationDocumentSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(roundtrip.evidence[0].chartTimezone).toBeUndefined();
    expect(roundtrip.evidence[1].chartTimezone).toEqual(metadata);
    expect(roundtrip.evidence[2].peerCapture?.chartTimezone).toEqual(metadata);
    expect(workstationDocumentSchema.safeParse({ ...doc, evidence: [{ ...legacy, chartTimezone: { mode: "system", zones: { x: "bad" } } }] }).success).toBe(false);
  });
});
