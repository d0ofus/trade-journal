import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ id: string }>;

const snapshotSchema = z.object({
  provider: z.string().min(1).max(80),
  kind: z.string().min(1).max(80),
  payloadJson: z.string().max(500000).default("{}"),
});

export async function POST(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await prisma.journalEntry.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const snapshot = await prisma.journalContextSnapshot.create({
    data: {
      journalEntryId: id,
      provider: parsed.data.provider,
      kind: parsed.data.kind,
      payloadJson: parsed.data.payloadJson,
    },
  });

  return NextResponse.json({
    snapshot: {
      ...snapshot,
      createdAt: snapshot.createdAt.toISOString(),
    },
  }, { status: 201 });
}
