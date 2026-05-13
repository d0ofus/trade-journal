import { NextRequest, NextResponse } from "next/server";
import { journalPlaybookExamplePayloadSchema } from "@/lib/journal/schema";
import { addJournalPlaybookExample } from "@/lib/server/journal";

type Params = Promise<{ id: string }>;

export async function POST(req: NextRequest, props: { params: Params }) {
  const { id } = await props.params;
  const body = await req.json();
  const parsed = journalPlaybookExamplePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const example = await addJournalPlaybookExample(id, parsed.data);
  return NextResponse.json({ example }, { status: 201 });
}
