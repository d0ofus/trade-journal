import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createEvidenceBackup, evidenceBackupPage } from "@/lib/server/evidence-backup";
import { EvidenceStorageError } from "@/lib/server/evidence-r2";
export const maxDuration = 120;
async function handle(request: NextRequest, create: boolean) {
  const session = await getServerSession(authOptions); if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (create && request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Cross-origin writes are not permitted." }, { status: 403 });
  try {
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");
    if (!Number.isInteger(offset) || offset < 0) throw new EvidenceStorageError("Invalid backup offset.", 400);
    return NextResponse.json(create ? await createEvidenceBackup(session.user.id) : await evidenceBackupPage(request.nextUrl.searchParams.get("id") ?? "", session.user.id, offset), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof EvidenceStorageError ? error.message : "Complete backup could not be prepared. Existing data was not changed." }, { status: error instanceof EvidenceStorageError ? error.status : 503 }); }
}
export const POST = (request: NextRequest) => handle(request, true);
export const GET = (request: NextRequest) => handle(request, false);
