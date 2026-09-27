import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/server/api-auth";
import { loadReviewStatuses } from "@/lib/server/review-statuses";

const input = z.object({ groupKeys: z.array(z.string().min(1).max(512)).max(500) }).strict();
export async function POST(request: NextRequest) {
  const auth = await requireApiSession(); if (auth) return auth;
  if (process.env.TRADES_WORKSTATION_ENABLED !== "1") return NextResponse.json({ error: "Workstation is not enabled." }, { status: 404 });
  let raw: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 300_000) return NextResponse.json({ error: "Status request is too large." }, { status: 413 });
    raw = JSON.parse(body);
  } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = input.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Provide up to 500 trade keys." }, { status: 400 });
  return NextResponse.json({ statuses: await loadReviewStatuses(parsed.data.groupKeys) }, { headers: { "Cache-Control": "no-store" } });
}
