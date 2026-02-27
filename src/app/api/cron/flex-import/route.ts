import { NextRequest, NextResponse } from "next/server";
import { runFlexImport } from "@/lib/server/flex-service";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (secret && token !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFlexImport();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flex import failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
