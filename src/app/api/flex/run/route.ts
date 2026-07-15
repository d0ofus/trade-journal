import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrBearerSecret } from "@/lib/server/api-auth";
import { rejectE2eBlockedMutation } from "@/lib/server/e2e-demo-write-guard";
import { runFlexImport } from "@/lib/server/flex-service";

export async function POST(req: NextRequest) {
  const authError = await requireApiSessionOrBearerSecret(req, "IBKR_FLEX_RUN_SECRET");
  if (authError) return authError;
  const demoWriteError = rejectE2eBlockedMutation("Flex imports");
  if (demoWriteError) return demoWriteError;

  try {
    const result = await runFlexImport();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flex import failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
