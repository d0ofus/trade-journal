import { z } from "zod";

export const CLOSED_TRADE_LAYOUT_MODES = [
  "single",
  "two-vertical",
  "two-horizontal",
  "three-vertical",
  "three-horizontal",
  "one-plus-two",
] as const;

export const CLOSED_TRADE_CHART_TIMEFRAMES = ["5m", "10m", "15m", "1h", "1d", "1wk"] as const;
export const CLOSED_TRADE_RANGE_PRESETS = ["post", "trade", "1m", "3m", "1y", "ytd", "all"] as const;
export const CLOSED_TRADE_SYMBOL_PATTERN = /^[A-Z0-9.^=_-]{1,20}$/;

function panelCountForLayout(layoutMode: (typeof CLOSED_TRADE_LAYOUT_MODES)[number]) {
  if (layoutMode === "single") return 1;
  if (layoutMode === "two-vertical" || layoutMode === "two-horizontal") return 2;
  return 3;
}

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((value) => value.toUpperCase())
  .refine((value) => CLOSED_TRADE_SYMBOL_PATTERN.test(value), "Invalid symbol.");

const compareSymbolSchema = z
  .union([symbolSchema, z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

const panelSchema = z
  .object({
    id: z.string().min(1).max(80),
    symbol: symbolSchema,
    timeframe: z.enum(CLOSED_TRADE_CHART_TIMEFRAMES),
    compareSymbol: compareSymbolSchema,
    rangePreset: z.enum(CLOSED_TRADE_RANGE_PRESETS),
    visibleFrom: z.number().int().nonnegative().nullable().optional(),
    visibleTo: z.number().int().nonnegative().nullable().optional(),
  })
  .superRefine((panel, context) => {
    const visibleFrom = panel.visibleFrom;
    const visibleTo = panel.visibleTo;
    const hasVisibleFrom = typeof visibleFrom === "number";
    const hasVisibleTo = typeof visibleTo === "number";
    if (hasVisibleFrom !== hasVisibleTo) {
      context.addIssue({
        code: "custom",
        path: hasVisibleFrom ? ["visibleTo"] : ["visibleFrom"],
        message: "Visible range start and end must be saved together.",
      });
    }
    if (
      hasVisibleFrom &&
      hasVisibleTo &&
      visibleFrom >= visibleTo
    ) {
      context.addIssue({
        code: "custom",
        path: ["visibleTo"],
        message: "Visible range end must be after the start.",
      });
    }
  })
  .transform((panel) => ({
    ...panel,
    compareSymbol: panel.compareSymbol === panel.symbol ? null : panel.compareSymbol,
  }));

export const closedTradeChartLayoutPayloadSchema = z.object({
  layoutMode: z.enum(CLOSED_TRADE_LAYOUT_MODES),
  panels: z.array(panelSchema).min(1).max(3),
  version: z.number().int().positive().optional(),
}).superRefine((layout, context) => {
  const expectedPanelCount = panelCountForLayout(layout.layoutMode);
  if (layout.panels.length !== expectedPanelCount) {
    context.addIssue({
      code: "custom",
      path: ["panels"],
      message: `${layout.layoutMode} requires ${expectedPanelCount} panel(s).`,
    });
  }

  const seenIds = new Set<string>();
  for (const panel of layout.panels) {
    if (seenIds.has(panel.id)) {
      context.addIssue({
        code: "custom",
        path: ["panels"],
        message: "Panel ids must be unique.",
      });
      break;
    }
    seenIds.add(panel.id);
  }
});
