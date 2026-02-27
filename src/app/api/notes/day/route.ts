import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const dayNoteSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().min(1),
  content: z.string(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = dayNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  await prisma.dayNote.upsert({
    where: { accountId_date: { accountId: parsed.data.accountId, date } },
    update: { content: parsed.data.content },
    create: { accountId: parsed.data.accountId, date, content: parsed.data.content },
  });

  return NextResponse.json({ ok: true });
}
