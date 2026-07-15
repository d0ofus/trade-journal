import { NextRequest, NextResponse } from "next/server";
import { requireBearerSecret } from "@/lib/server/api-auth";
import { runFlexImport } from "@/lib/server/flex-service";

export async function GET(req: NextRequest) {
  const authError = requireBearerSecret(req, "CRON_SECRET");
  if (authError) return authError;

  try {
    const result = await runFlexImport();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flex import failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
