import { z } from "zod";

export const sideSchema = z.enum(["BUY", "SELL"]);
export const assetTypeSchema = z.enum(["STOCK", "OPTION", "FUTURE", "FOREX", "CRYPTO", "ETF", "OTHER"]);

export const executionImportSchema = z.object({
  account: z.string().min(1),
  executedAt: z.date(),
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  assetType: assetTypeSchema.default("STOCK"),
  side: sideSchema,
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  commission: z.number().default(0),
  fees: z.number().default(0),
  currency: z.string().default("USD"),
  orderId: z.string().optional(),
  strategy: z.string().optional(),
});

export const positionImportSchema = z.object({
  account: z.string().min(1),
  symbol: z.string().min(1),
  exchange: z.string().optional(),
  assetType: assetTypeSchema.default("STOCK"),
  reportDate: z.date().optional(),
  quantity: z.number(),
  avgCost: z.number().nonnegative(),
  unrealizedPnl: z.number().optional(),
  currency: z.string().default("USD"),
});

export const snapshotImportSchema = z.object({
  account: z.string().min(1),
  date: z.date(),
  equity: z.number().optional(),
  realizedPnl: z.number().optional(),
  unrealizedPnl: z.number().optional(),
  currency: z.string().default("USD"),
});

export type ExecutionImport = z.infer<typeof executionImportSchema>;
export type PositionImport = z.infer<typeof positionImportSchema>;
export type SnapshotImport = z.infer<typeof snapshotImportSchema>;
