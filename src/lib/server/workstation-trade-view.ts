import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emptyTradeView, tradeViewSchema, type TradeView, type SavedTradeView } from "@/lib/workstation/trade-view";
import { WorkstationError } from "./trade-workstation";

export async function readTradeView(groupKey: string): Promise<SavedTradeView> {
  const record = await prisma.workstationTradeView.findUnique({ where: { groupKey } });
  if (!record) return emptyTradeView();
  return { revision: record.revision, updatedAt: record.updatedAt.toISOString(), view: tradeViewSchema.parse(record.view) };
}
export async function saveTradeView(groupKey: string, view: TradeView, revision: number): Promise<SavedTradeView> {
  const data = tradeViewSchema.parse(view);
  try {
    return await prisma.$transaction(async tx => {
      if (revision === 0) await tx.workstationTradeView.create({ data: { groupKey, view: data, revision: 1 } });
      else {
        const result = await tx.workstationTradeView.updateMany({ where: { groupKey, revision }, data: { view: data, revision: { increment: 1 } } });
        if (!result.count) throw new WorkstationError("Chart view changed in another tab. Your local view is preserved; reload to resolve it.", 409);
      }
      const record = await tx.workstationTradeView.findUniqueOrThrow({ where: { groupKey } });
      return { view: data, revision: record.revision, updatedAt: record.updatedAt.toISOString() };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new WorkstationError("Chart view changed in another tab. Your local view is preserved; reload to resolve it.", 409);
    throw error;
  }
}
