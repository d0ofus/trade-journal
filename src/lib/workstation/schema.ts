import { z } from "zod";
import { drawingTools } from "./types";
const text = z.string().max(10000);
const point = z.object({ time: z.number().finite().nonnegative(), price: z.number().finite() });
export const workstationDocumentSchema = z.object({
  journalUpdatedAt: z.string().datetime().nullable().optional(),
  schema: z.literal(1), revision: z.number().int().min(0), updatedAt: z.string().datetime().nullable(), noteUpdatedAt: z.string().datetime().nullable().optional(), journalEntryId: z.string().nullable().optional(),
  review: z.object({ setup: text, execution: text, takeaway: text, notes: z.string().max(20000), thesis: text, exit: text, mistake: text, followUp: text, tags: z.array(z.string().trim().min(1).max(60)).max(30), status: z.enum(["Not reviewed", "In progress", "Reviewed"]), template: z.string().max(100), custom: z.record(z.string().min(1).max(60), text).refine(value => Object.keys(value).length <= 50) }),
  drawings: z.array(z.object({ id: z.string().min(1).max(200), tool: z.enum(drawingTools).exclude(["cursor"]), points: z.array(point).min(1).max(4), text: z.string().max(500), color: z.string().regex(/^#[a-fA-F0-9]{6}$/), width: z.number().min(.5).max(4), dashed: z.boolean(), locked: z.boolean(), hidden: z.boolean(), panel: z.string().max(100).nullable(), createdAt: z.number().finite().nonnegative() }).superRefine((d, ctx) => { if (["trend", "arrow", "zone", "measure", "long", "short"].includes(d.tool) && d.points.length < 2) ctx.addIssue({ code: "custom", message: "This drawing needs two anchors" }); })).max(500),
  evidence: z.array(z.object({ timeInterpretationVersion: z.string().max(160).optional(), id: z.string().min(1).max(200), name: z.string().max(240), image: z.string().max(6000000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/), time: z.number().finite().nonnegative(), revision: z.number().int().nonnegative(), timeframe: z.string().max(40) })).max(30),
  // Historical material is server-owned; never trust a client replacement.
  legacy: z.unknown().optional(),
});
