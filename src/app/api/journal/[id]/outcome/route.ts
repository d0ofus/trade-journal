import { NextRequest, NextResponse } from "next/server";
import { journalOutcomePatchSchema } from "@/lib/journal/schema";
import { mapJournalPayloadToData, updateJournalEntry } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalOutcomePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const entry = await updateJournalEntry(id, mapJournalPayloadToData(parsed.data));
  return NextResponse.json({ entry });
}
