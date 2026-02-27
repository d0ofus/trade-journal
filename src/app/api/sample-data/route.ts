import { NextResponse } from "next/server";
import { seedSampleData } from "@/lib/server/sample-data";

export async function POST() {
  await seedSampleData();
  return NextResponse.json({ ok: true });
}
