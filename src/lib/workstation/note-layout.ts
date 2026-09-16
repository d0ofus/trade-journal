export type PixelPoint = { x: number; y: number };

export const defaultNoteEnd = (tip: PixelPoint): PixelPoint => ({ x: tip.x + 12, y: tip.y - 25 });

/** The second anchor locates the near edge of the box; crossing the tip flips its side. */
export function noteLayout(tip: PixelPoint, end: PixelPoint, textWidth: number, plotWidth: number, plotHeight: number, topInset: number) {
  const width = Math.max(18, Math.min(textWidth + 18, 320, plotWidth - 6));
  const right = end.x >= tip.x;
  const x = Math.max(3, Math.min(plotWidth - width - 3, right ? end.x + 8 : end.x - width - 8));
  const y = Math.max(topInset, Math.min(plotHeight - 25, end.y - 12));
  const join = { x: right ? x : x + width, y: y + 12 };
  return { box: { x, y, w: width, h: 24 }, join, end: { x: join.x + (right ? -8 : 8), y: join.y } };
}
