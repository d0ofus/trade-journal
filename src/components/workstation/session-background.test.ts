import { describe, expect, it, vi } from "vitest";
import { extendedSessionBands, hasExtendedSession, SessionBackground, sessionBoundaryColumn } from "./session-background";
import type { Candle, CandleSession } from "@/lib/workstation/types";
const session: CandleSession = { timezone: "America/New_York", calendar: "exchange", marketHours: "extended" };
const time = (iso: string) => Date.parse(iso) / 1000;
const bar = (iso: string): Candle => ({ time: time(iso), open: 10, high: 12, low: 8, close: 11, volume: 100 });
describe("extended session backgrounds", () => {
  it("leaves regular, coarse, empty and unsupported calendars alone", () => {
    expect(hasExtendedSession("5m", session)).toBe(true);
    for (const interval of ["1d", "1wk"] as const) expect(hasExtendedSession(interval, session)).toBe(false);
    expect(hasExtendedSession("1h", { ...session, marketHours: "regular" })).toBe(false);
    expect(hasExtendedSession("5m", { ...session, timezone: "UTC" })).toBe(false);
    expect(hasExtendedSession("5m")).toBe(false);
    expect(extendedSessionBands([], "5m", 0, -1)).toEqual([]);
  });
  it.each([["2026-01-07", "14", "21"], ["2026-07-07", "13", "20"]])("honors New York open/close in %s", (date, openHour, closeHour) => {
    const data = [bar(`${date}T${openHour}:25:00Z`), bar(`${date}T${openHour}:30:00Z`), bar(`${date}T${Number(closeHour)-1}:55:00Z`), bar(`${date}T${closeHour}:00:00Z`)];
    expect(extendedSessionBands(data, "5m", 0, 3)).toEqual([{ from: -.5, to: .5 }, { from: 2.5, to: 3.5 }]);
  });
  it("splits a mixed hourly candle and collapses missing time to the next column", () => {
    const data = [bar("2026-01-07T14:00:00Z"), bar("2026-01-07T15:00:00Z"), bar("2026-01-07T20:00:00Z"), bar("2026-01-07T21:00:00Z")];
    expect(sessionBoundaryColumn(data, time("2026-01-07T14:30:00Z"), "1h")).toBe(0);
    expect(sessionBoundaryColumn(data, time("2026-01-07T18:30:00Z"), "1h")).toBe(1.5);
    expect(extendedSessionBands(data, "1h", 0, 3)).toEqual([{ from: -.5, to: 0 }, { from: 2.5, to: 3.5 }]);
  });
  it("respects an early close and full holiday", () => {
    const early = [bar("2026-11-27T17:55:00Z"), bar("2026-11-27T18:00:00Z")];
    expect(extendedSessionBands(early, "5m", 0, 1)).toEqual([{ from: .5, to: 1.5 }]);
    expect(extendedSessionBands([bar("2026-11-26T15:00:00Z")], "5m", 0, 0)).toEqual([{ from: -.5, to: .5 }]);
  });
  it("clips to visible/rendered bars, including replay and history prepends", () => {
    const data = [bar("2026-01-07T14:25:00Z"), bar("2026-01-07T14:30:00Z"), bar("2026-01-07T21:00:00Z")];
    expect(extendedSessionBands(data, "5m", 1, 1)).toEqual([]);
    expect(extendedSessionBands(data.slice(0, 2), "5m", 0, 1)).toEqual([{ from: -.5, to: .5 }]);
    expect(extendedSessionBands([bar("2026-01-07T14:20:00Z"), ...data], "5m", 0, 3)).toEqual([{ from: -.5, to: 1.5 }, { from: 2.5, to: 3.5 }]);
  });
  it("reuses session geometry across unchanged draws and cleans up on detach", () => {
    const primitive = new SessionBackground(), fillRect = vi.fn(), context = { fillStyle: "", fillRect };
    const range = { from: 0, to: 1 };
    const chart = { timeScale: () => ({ getVisibleLogicalRange: () => range, logicalToCoordinate: (value: number) => Number.isInteger(value) ? 10 + value * 10 : 0 }) };
    primitive.attached({ chart } as never);
    primitive.setData([bar("2026-01-07T14:25:00Z"), bar("2026-01-07T14:30:00Z")], "5m", session, false);
    const view = primitive.paneViews()[0], renderer = view.renderer()!;
    const target = { useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => callback({ context, bitmapSize: { width: 100, height: 50 }, horizontalPixelRatio: 2 }) };
    const formats = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    renderer.draw(target as never);
    const count = formats.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    expect(fillRect).toHaveBeenLastCalledWith(10, 0, 20, 50);
    renderer.draw(target as never);
    expect(formats).toHaveBeenCalledTimes(count);
    primitive.setTheme(true); renderer.draw(target as never);
    expect(context.fillStyle).toBe("#f2f5fa");
    expect(view.zOrder?.()).toBe("bottom");
    primitive.detached(); fillRect.mockClear(); renderer.draw(target as never);
    expect(fillRect).not.toHaveBeenCalled();
    formats.mockRestore();
  });
  it("invalidates cached geometry when history is prepended or replay removes candles", () => {
    const primitive = new SessionBackground(), fillRect = vi.fn();
    primitive.attached({ chart: { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 1 }), logicalToCoordinate: (value: number) => Number.isInteger(value) ? 10 + value * 10 : 0 }) } } as never);
    const data = [bar("2026-01-07T14:25:00Z"), bar("2026-01-07T14:30:00Z")];
    const target = { useBitmapCoordinateSpace: (callback: (scope: unknown) => void) => callback({ context: { fillRect }, bitmapSize: { width: 100, height: 50 }, horizontalPixelRatio: 1 }) };
    primitive.setData(data, "5m", session, false);
    const renderer = primitive.paneViews()[0].renderer()!;
    renderer.draw(target as never);
    expect(fillRect).toHaveBeenLastCalledWith(5, 0, 10, 50);
    primitive.setData([bar("2026-01-07T14:20:00Z"), ...data], "5m", session, false);
    renderer.draw(target as never);
    expect(fillRect).toHaveBeenLastCalledWith(5, 0, 20, 50);
    primitive.setData([data[1]], "5m", session, false); fillRect.mockClear();
    renderer.draw(target as never);
    expect(fillRect).not.toHaveBeenCalled();
    primitive.setData([], "5m", session, false); renderer.draw(target as never);
    expect(fillRect).not.toHaveBeenCalled();
  });
});
