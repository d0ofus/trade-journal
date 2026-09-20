import { describe, expect, it, vi } from "vitest";
import { createOhlcLegend } from "./ohlc-legend";
import type { Candle } from "@/lib/workstation/types";

const candle = (time: number, close = 12): Candle => ({ time, open: 10, high: 15, low: 5, close, volume: 100 });

function legend(withPercent = false) {
  const writes = vi.fn();
  const fields = ["open", "high", "low", "close"].map(() => {
    let text = "";
    return {
      parentElement: { hidden: true }, className: "",
      get textContent() { return text; },
      set textContent(value: string) { text = value; writes(value); },
    };
  });
  const empty = { hidden: false };
  const percent = { hidden: true, textContent: "", className: "" };
  const root = { querySelector: (selector: string) => selector === "[data-ohlc-percent]" ? withPercent ? percent : null : selector === "[data-ohlc-empty]" ? empty : fields[["open", "high", "low", "close"].findIndex(key => selector.includes(key))] };
  return { controller: createOhlcLegend(root as unknown as HTMLElement), fields, empty, writes, percent,
    values: () => fields.map(field => field.textContent) };
}

describe("OHLC legend", () => {
  it("uses the previous loaded close, including gaps and corrected history, without future replay values", () => {
    const l = legend(true);
    l.controller.reconcile([candle(300, 100), candle(900, 110)]);
    expect(l.percent.textContent).toBe("+10.00%"); expect(l.percent.className).toBe("positive");
    l.controller.inspect(candle(300, 100)); expect(l.percent.textContent).toBe("—");
    l.controller.inspect(candle(900, 110));
    l.controller.reconcile([candle(300, 200), candle(900, 110)]);
    expect(l.percent.textContent).toBe("-45.00%"); expect(l.percent.className).toBe("negative");
    l.controller.reconcile([candle(300, 0), candle(900, 110)]); expect(l.percent.textContent).toBe("—");
    for (const invalid of [NaN, Infinity, -100]) {
      l.controller.reconcile([candle(300, invalid), candle(900, 110)]); expect(l.percent.textContent).toBe("—");
    }
    l.controller.reconcile([candle(300, 110), candle(900, 110)]); expect(l.percent.textContent).toBe("+0.00%"); expect(l.percent.className).toBe("");
    l.controller.reconcile([candle(300, 100)]); expect(l.percent.textContent).toBe("—");
    l.controller.reset(); expect(l.percent.hidden).toBe(true);
  });
  it("formats zero and negative prices, colors the close and switches the empty display", () => {
    const l = legend();
    expect(l.empty.hidden).toBe(false);
    l.controller.inspect({ time: 0, open: 0, high: 1.125, low: -2, close: -1 });
    expect(l.values()).toEqual(["0.00", "1.13", "-2.00", "-1.00"]);
    expect(l.fields[3].className).toBe("negative");
    expect(l.fields.every(field => !field.parentElement.hidden)).toBe(true);
    expect(l.empty.hidden).toBe(true);
    l.controller.inspect(candle(300, 10));
    expect(l.fields[3].className).toBe("positive");
    l.controller.reset();
    expect(l.empty.hidden).toBe(false);
    expect(l.fields.every(field => field.parentElement.hidden)).toBe(true);
  });

  it("retains the inspected candle on exits, missing series data and invalid prices", () => {
    const l = legend(); l.controller.inspect(candle(300));
    for (const value of [undefined, null, { time: 400 }, { time: 400, value: 99 }, { ...candle(400), high: NaN }]) l.controller.inspect(value);
    expect(l.values()).toEqual(["10.00", "15.00", "5.00", "12.00"]);
    expect(l.writes).toHaveBeenCalledTimes(4);
  });

  it("skips writes within an unchanged candle but refreshes a correction at the same timestamp", () => {
    const l = legend(); l.controller.inspect(candle(300)); l.writes.mockClear();
    for (let i = 0; i < 100; i++) l.controller.inspect(candle(300));
    expect(l.writes).not.toHaveBeenCalled();
    l.controller.inspect(candle(300, 8));
    expect(l.writes).toHaveBeenCalledExactlyOnceWith("8.00");
    expect(l.fields[3].className).toBe("negative");
  });

  it("starts with the last candle at/before the viewport end, including fractional/gap boundaries", () => {
    const l = legend(), bars = [candle(300, 6), candle(600, 7), candle(900, 8)];
    l.controller.reconcile(bars, 750.5); expect(l.values()[3]).toBe("7.00");
    l.controller.reconcile(bars, 600); expect(l.values()[3]).toBe("7.00");
    l.controller.reconcile(bars, 100); expect(l.values()[3]).toBe("8.00");
    l.controller.reconcile(bars); expect(l.values()[3]).toBe("8.00");
  });

  it("retains the inspected time through viewport/history changes and uses corrected loaded values", () => {
    const l = legend(); l.controller.inspect(candle(600, 7));
    l.controller.reconcile([candle(0), candle(300), candle(600, 9), candle(900)], 300);
    expect(l.values()[3]).toBe("9.00");
    l.controller.reconcile([candle(600, 9), candle(900)], 900);
    expect(l.values()[3]).toBe("9.00");
  });

  it("drops replay-excluded selections using exact timestamps and never restores them automatically", () => {
    const l = legend(); l.controller.inspect(candle(900, 9));
    l.controller.reconcile([candle(300, 6), candle(600, 7)], 300);
    expect(l.values()[3]).toBe("6.00");
    l.controller.reconcile([candle(300, 6), candle(600, 7), candle(900, 9)], 600);
    expect(l.values()[3]).toBe("7.00");
    l.controller.reconcile([]); expect(l.empty.hidden).toBe(false);
  });

  it("reset clears the retained selection for a new trade, interval or session", () => {
    const l = legend(); l.controller.inspect(candle(300, 6)); l.controller.reset();
    l.controller.reconcile([candle(300, 6), candle(600, 7)]);
    expect(l.values()[3]).toBe("7.00");
  });

  it("hides values during a same-context reload without forgetting the inspected timestamp", () => {
    const l = legend(); l.controller.inspect(candle(300, 6));
    l.controller.update(null); expect(l.empty.hidden).toBe(false);
    l.controller.reconcile([candle(300, 8), candle(600, 7)]);
    expect(l.values()[3]).toBe("8.00");
  });
});
