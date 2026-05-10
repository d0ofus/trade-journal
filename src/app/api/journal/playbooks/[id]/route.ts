import { NextRequest, NextResponse } from "next/server";
import { journalPlaybookPatchSchema } from "@/lib/journal/schema";
import { deleteJournalPlaybook, updateJournalPlaybook } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function PATCH(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalPlaybookPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const playbook = await updateJournalPlaybook(id, parsed.data);
  return NextResponse.json({ playbook });
}

export async function DELETE(_req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  await deleteJournalPlaybook(id);
  return NextResponse.json({ ok: true });
}
