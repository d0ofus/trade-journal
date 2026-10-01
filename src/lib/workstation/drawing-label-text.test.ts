import { describe, expect, it, vi } from "vitest";
import { createDrawingTextCache, wrapDrawingText } from "./drawing-label-text";

describe("bounded annotation text layouts", () => {
  it("reuses identical layouts, separates geometry/fonts, and never shares mutable lines", () => {
    const cache = createDrawingTextCache(2), measure = vi.fn((s: string) => s.length * 6);
    const text = "Long note\nSecond paragraph";
    const expected = wrapDrawingText(text, 48, measure);
    const first = cache(text, 48, "11px system-ui", measure); first.pop(); measure.mockClear();
    expect(cache(text, 48, "11px system-ui", measure)).toEqual(expected); expect(measure).not.toHaveBeenCalled();
    cache(text, 90, "11px system-ui", measure); expect(measure).toHaveBeenCalled(); measure.mockClear();
    cache(text, 90, "12px system-ui", measure); expect(measure).toHaveBeenCalled(); measure.mockClear();
    cache(text, 48, "11px system-ui", measure); expect(measure).toHaveBeenCalled();
  });
});
