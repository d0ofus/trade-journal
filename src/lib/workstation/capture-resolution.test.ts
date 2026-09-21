import { describe, expect, it } from "vitest";
import { assertCaptureSize, captureRenderFrame, captureResolution, chartBitmapRatio } from "./capture-resolution";

describe("lossless capture sizing", () => {
  it("measures actual chart backing density instead of assuming browser DPR", () => {
    const host = { querySelector: () => ({ clientWidth: 600, width: 600 }) } as unknown as HTMLElement;
    expect(chartBitmapRatio(host, 1.25)).toBe(1);
    expect(captureRenderFrame({ width: 600, height: 400 }, 3.2, chartBitmapRatio(host, 1.25)).width).toBe(1920);
    expect(chartBitmapRatio(null, 2)).toBe(2);
  });
  for (const ratio of [1, 1.25, 2, 3]) it(`keeps high-quality and native pixel guarantees at DPR ${ratio}`, () => {
    for (const frame of [{ width: 509, height: 268 }, { width: 737, height: 521 }, { width: 1800, height: 950 }]) {
      const high = captureResolution(frame, "high", ratio);
      expect(high.width).toBeGreaterThanOrEqual(1920); expect(high.scale).toBeGreaterThanOrEqual(Math.max(2, ratio));
      const render = captureRenderFrame(frame, high.scale, ratio);
      expect(render.width % 2).toBe(0); expect(render.height % 2).toBe(0);
      expect(render.width * ratio).toBeGreaterThanOrEqual(high.width - 1);
      expect(render.width * ratio - high.width).toBeLessThan(2 * ratio);
      expect(captureResolution(frame, "standard", ratio).width).toBe(Math.ceil(frame.width * ratio));
    }
  });
  it("uses the complete layout's width instead of a minimum on every tile", () => {
    const size = captureResolution({ width: 1200, height: 500 }, "high", 1);
    expect(size.width).toBe(2400); expect(size.scale).toBe(2);
  });
  it("rejects invalid and oversized frames rather than degrading quality", () => {
    for (const width of [0, -1, NaN, Infinity]) expect(() => captureResolution({ width, height: 500 }, "high")).toThrow();
    expect(() => captureResolution({ width: 3840, height: 2160 }, "high")).toThrow(/16 megapixels/);
    expect(() => assertCaptureSize(4000, 4000)).not.toThrow();
    expect(() => assertCaptureSize(4001, 4000)).toThrow();
  });
});
