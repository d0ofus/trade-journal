import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/server/api-auth";

const dayNoteSchema = z.object({
  accountId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().max(20000),
  updatedAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const authError = await requireApiSession();
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = dayNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid day note date." }, { status: 400 });
  }

  const account = await prisma.account.findUnique({ where: { id: parsed.data.accountId }, select: { id: true } });
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const expectedUpdatedAt = parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null;
  const existing = await prisma.dayNote.findUnique({
    where: { accountId_date: { accountId: parsed.data.accountId, date } },
    select: { updatedAt: true },
  });

  let note: { updatedAt: Date };
  if (existing) {
    if (!expectedUpdatedAt) {
      return NextResponse.json(
        {
          code: "DAY_NOTE_CONFLICT",
          error: "Day note changed in another tab.",
          currentUpdatedAt: existing.updatedAt.toISOString(),
        },
        { status: 409 },
      );
    }

    const claimed = await prisma.dayNote.updateMany({
      where: { accountId: parsed.data.accountId, date, updatedAt: expectedUpdatedAt },
      data: { content: parsed.data.content },
    });
    if (claimed.count === 0) {
      const current = await prisma.dayNote.findUnique({
        where: { accountId_date: { accountId: parsed.data.accountId, date } },
        select: { updatedAt: true },
      });
      return NextResponse.json(
        {
          code: "DAY_NOTE_CONFLICT",
          error: "Day note changed in another tab.",
          currentUpdatedAt: current?.updatedAt.toISOString() ?? existing.updatedAt.toISOString(),
        },
        { status: 409 },
      );
    }

    note = await prisma.dayNote.findUniqueOrThrow({
      where: { accountId_date: { accountId: parsed.data.accountId, date } },
      select: { updatedAt: true },
    });
  } else {
    if (expectedUpdatedAt) {
      return NextResponse.json(
        {
          code: "DAY_NOTE_CONFLICT",
          error: "Day note changed in another tab.",
          currentUpdatedAt: null,
        },
        { status: 409 },
      );
    }

    note = await prisma.dayNote.create({
      data: { accountId: parsed.data.accountId, date, content: parsed.data.content },
      select: { updatedAt: true },
    });
  }

  return NextResponse.json({ ok: true, updatedAt: note.updatedAt.toISOString() });
}
