import { NextResponse } from "next/server";
import { runFlexImport } from "@/lib/server/flex-service";

export async function POST() {
  try {
    const result = await runFlexImport();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Flex import failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
