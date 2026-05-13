import { NextResponse } from "next/server";
import { deleteJournalPlaybookExample } from "@/lib/server/journal";

type Params = Promise<{ id: string; exampleId: string }>;

export async function DELETE(_req: Request, props: { params: Params }) {
  const { id, exampleId } = await props.params;
  await deleteJournalPlaybookExample(id, exampleId);
  return NextResponse.json({ ok: true });
}
