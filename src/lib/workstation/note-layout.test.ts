import { expect, it } from "vitest";
import { defaultNoteEnd, noteLayout } from "./note-layout";

it("places the box on either side of its anchored pointer, with a connected leader", () => {
  const tip = { x: 300, y: 180 };
  const right = noteLayout(tip, defaultNoteEnd(tip), 120, 800, 400, 24);
  const left = noteLayout(tip, { x: 180, y: 240 }, 120, 800, 400, 24);
  expect(right.box.x).toBeGreaterThan(tip.x);
  expect(right.join).toEqual({ x: right.box.x, y: right.box.y + 12 });
  expect(left.box.x + left.box.w).toBeLessThan(tip.x);
  expect(left.join).toEqual({ x: left.box.x + left.box.w, y: left.box.y + 12 });
  expect(tip).toEqual({ x: 300, y: 180 });
});

it("keeps a long note in the plot with its drag target beside the box", () => {
  for (const end of [{ x: -200, y: -100 }, { x: 900, y: 900 }]) {
    const { box, end: handle } = noteLayout({ x: 150, y: 100 }, end, 1000, 300, 250, 24);
    expect(box.x).toBeGreaterThanOrEqual(3);
    expect(box.x + box.w).toBeLessThanOrEqual(297);
    expect(box.y).toBeGreaterThanOrEqual(24);
    expect(box.y + box.h).toBeLessThanOrEqual(250);
    expect(Math.abs(handle.x - (end.x < 150 ? box.x + box.w : box.x))).toBe(8);
  }
});
