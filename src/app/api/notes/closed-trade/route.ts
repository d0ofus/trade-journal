import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const closedNoteSchema = z.object({
  groupKey: z.string().min(1),
  content: z.string(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = closedNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.closedTradeNote.upsert({
    where: { groupKey: parsed.data.groupKey },
    update: { content: parsed.data.content },
    create: { groupKey: parsed.data.groupKey, content: parsed.data.content },
  });

  return NextResponse.json({ ok: true });
}
